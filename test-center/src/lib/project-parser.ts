// 项目代码解析器（服务端模块）
// 解析本地项目目录或 ZIP 包，提取结构化信息供 LLM 分析使用
// 注意：本模块使用 fs 模块，只能在服务端使用，不能在客户端组件中直接导入

import "server-only";
import fs from "fs";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";

// 解析结果
export interface ParsedProjectInfo {
  techStack: string[]; // 技术栈：["Next.js", "React", "Prisma", "SQLite"]
  framework: string; // 主框架："Next.js" / "Vue" / "Express" 等
  pageRoutes: string[]; // 页面路由：["/", "/login", "/level/[id]"]
  apiRoutes: string[]; // API 路由：["POST /api/sign", "GET /api/points"]
  dataModels: string[]; // 数据模型：["User", "SignRecord", "Level", "Progress", "Reward", "Exchange"]
  dependencies: Record<string, string>; // 关键依赖：{"next": "16.2.9", "prisma": "7.8.0"}
  readmeSummary: string; // README 摘要（前 500 字符）
  codeSummary: string; // 代码摘要文本（≤6000 token，供 LLM 分析）
  fileCount: number; // 文件总数
  directoryTree: string; // 目录树文本（≤2000 字符）
}

// ============================================================
// 常量配置
// ============================================================

// 系统目录黑名单（禁止读取）
const SYSTEM_DIRS: string[] = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
  "C:\\System Volume Information",
  "C:\\Recovery",
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/var",
  "/sys",
  "/proc",
  "/dev",
  "/boot",
  "/root",
  "/lib",
  "/lib64",
];

// 排除的目录名
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "build",
  ".cache",
  "coverage",
  "tmp",
  "logs",
  ".turbo",
  ".vercel",
  ".svn",
  ".hg",
]);

// 二进制文件扩展名（跳过读取内容）
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".bmp",
  ".webp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".mp3",
  ".wav",
  ".avi",
  ".mov",
  ".webm",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".psd",
  ".ai",
  ".sketch",
  ".lockb",
]);

// 敏感文件名（内容遮蔽）
const SENSITIVE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.test",
  ".env.staging",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "private.key",
  "secret.key",
  "credentials.json",
  "service-account.json",
]);

// 单文件大小上限（100KB）
const MAX_FILE_SIZE = 100 * 1024;

// 目录树最大长度
const MAX_DIRECTORY_TREE_LENGTH = 2000;

// 代码摘要最大长度（约 6000 token ≈ 24000 字符）
const MAX_CODE_SUMMARY_LENGTH = 24000;

// README 摘要最大长度
const MAX_README_LENGTH = 500;

// 最大递归深度（足够覆盖 app/api/level/[id]/answer/route.ts 等深层路由）
const MAX_DEPTH = 8;

// ============================================================
// 路径安全校验
// ============================================================

// 校验路径安全性：禁止读取系统目录
function validatePath(projectPath: string): string {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("路径不能为空");
  }

  // 规范化路径
  const normalized = path.resolve(projectPath);

  // 检查是否为系统目录或位于系统目录下
  for (const sysDir of SYSTEM_DIRS) {
    const sysDirNormalized = path.resolve(sysDir);
    if (
      normalized.toLowerCase() === sysDirNormalized.toLowerCase() ||
      normalized.toLowerCase().startsWith(
        sysDirNormalized.toLowerCase() + path.sep,
      )
    ) {
      throw new Error(`禁止访问系统目录：${sysDir}`);
    }
  }

  // 检查路径是否存在
  if (!fs.existsSync(normalized)) {
    throw new Error(`路径不存在：${normalized}`);
  }

  // 检查是否为目录
  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录：${normalized}`);
  }

  return normalized;
}

// ============================================================
// 文件收集
// ============================================================

// 已收集的文件信息
interface CollectedFile {
  relativePath: string; // 相对于项目根目录的路径（使用 / 分隔）
  absolutePath: string; // 绝对路径
  size: number;
  isSensitive: boolean; // 是否为敏感文件（内容需遮蔽）
}

// 递归收集目录下的文件
function collectFiles(
  dir: string,
  baseDir: string,
  depth: number,
  files: CollectedFile[],
): void {
  if (depth > MAX_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // 读取失败时跳过该目录
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      // 排除指定目录
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectFiles(fullPath, baseDir, depth + 1, files);
    } else if (entry.isFile()) {
      // 排除二进制文件
      const ext = path.extname(entry.name).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      // 敏感文件标记
      const isSensitive = SENSITIVE_FILES.has(entry.name);

      let size = 0;
      try {
        size = fs.statSync(fullPath).size;
      } catch {
        continue;
      }

      // 跳过过大的文件
      if (size > MAX_FILE_SIZE) continue;

      files.push({
        relativePath,
        absolutePath: fullPath,
        size,
        isSensitive,
      });
    }
  }
}

// ============================================================
// 文件内容读取
// ============================================================

// 读取文件内容（敏感文件返回遮蔽文本）
function readFileContent(file: CollectedFile): string {
  if (file.isSensitive) {
    return "[REDACTED: 敏感文件内容已遮蔽]";
  }
  try {
    return fs.readFileSync(file.absolutePath, "utf-8");
  } catch {
    return "[读取失败]";
  }
}

// ============================================================
// 技术栈识别
// ============================================================

// 解析 package.json，识别前端框架与依赖
function parsePackageJson(
  files: CollectedFile[],
): {
  techStack: string[];
  framework: string;
  dependencies: Record<string, string>;
} {
  const pkgFile = files.find((f) => f.relativePath === "package.json");
  if (!pkgFile) {
    return { techStack: [], framework: "", dependencies: {} };
  }

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(readFileContent(pkgFile));
  } catch {
    return { techStack: [], framework: "", dependencies: {} };
  }

  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const techStack: string[] = [];
  let framework = "";

  // 识别主框架
  if (deps["next"]) {
    techStack.push("Next.js");
    framework = "Next.js";
  } else if (deps["nuxt"]) {
    techStack.push("Nuxt.js");
    framework = "Nuxt.js";
  } else if (deps["react"]) {
    techStack.push("React");
    framework = "React";
  } else if (deps["vue"]) {
    techStack.push("Vue");
    framework = "Vue";
  } else if (deps["express"]) {
    techStack.push("Express");
    framework = "Express";
  } else if (deps["koa"]) {
    techStack.push("Koa");
    framework = "Koa";
  } else if (deps["fastify"]) {
    techStack.push("Fastify");
    framework = "Fastify";
  } else if (deps["@nestjs/core"]) {
    techStack.push("NestJS");
    framework = "NestJS";
  }

  // 识别其他技术栈
  if (deps["react"] && !techStack.includes("React")) {
    techStack.push("React");
  }
  if (deps["vue"] && !techStack.includes("Vue")) {
    techStack.push("Vue");
  }
  if (deps["tailwindcss"]) {
    techStack.push("Tailwind CSS");
  }
  if (deps["prisma"] || deps["@prisma/client"]) {
    techStack.push("Prisma");
  }
  if (deps["typeorm"]) {
    techStack.push("TypeORM");
  }
  if (deps["mongoose"]) {
    techStack.push("Mongoose");
  }
  if (deps["sequelize"]) {
    techStack.push("Sequelize");
  }

  // 提取关键依赖版本
  const keyDeps = [
    "next",
    "react",
    "vue",
    "nuxt",
    "express",
    "koa",
    "fastify",
    "@nestjs/core",
    "prisma",
    "@prisma/client",
    "typeorm",
    "mongoose",
    "sequelize",
    "tailwindcss",
    "typescript",
  ];
  const dependencies: Record<string, string> = {};
  for (const key of keyDeps) {
    if (deps[key]) {
      dependencies[key] = deps[key];
    }
  }

  return { techStack, framework, dependencies };
}

// 解析 prisma/schema.prisma，识别数据库类型与数据模型
function parsePrismaSchema(
  files: CollectedFile[],
): { dataModels: string[]; database: string } {
  // 兼容 prisma/schema.prisma 和 src/prisma/schema.prisma 两种位置
  const schemaFile = files.find(
    (f) =>
      f.relativePath === "prisma/schema.prisma" ||
      f.relativePath === "src/prisma/schema.prisma",
  );
  if (!schemaFile) {
    return { dataModels: [], database: "" };
  }

  const content = readFileContent(schemaFile);
  const dataModels: string[] = [];

  // 提取 model 名称
  const modelRegex = /^model\s+(\w+)\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(content)) !== null) {
    dataModels.push(match[1]);
  }

  // 提取数据库类型
  let database = "";
  const providerMatch = content.match(/provider\s*=\s*"(\w+)"/);
  if (providerMatch) {
    const provider = providerMatch[1];
    const dbMap: Record<string, string> = {
      sqlite: "SQLite",
      postgresql: "PostgreSQL",
      mysql: "MySQL",
      mongodb: "MongoDB",
      sqlserver: "SQL Server",
    };
    database = dbMap[provider] || provider;
  }

  return { dataModels, database };
}

// 识别 Python 项目
function detectPythonStack(files: CollectedFile[]): string[] {
  const reqFile = files.find((f) => f.relativePath === "requirements.txt");
  if (!reqFile) return [];

  const content = readFileContent(reqFile);
  const stack: string[] = ["Python"];
  if (/flask/i.test(content)) stack.push("Flask");
  if (/django/i.test(content)) stack.push("Django");
  if (/fastapi/i.test(content)) stack.push("FastAPI");
  return stack;
}

// 识别 Go 项目
function detectGoStack(files: CollectedFile[]): string[] {
  const goMod = files.find((f) => f.relativePath === "go.mod");
  if (!goMod) return [];

  const content = readFileContent(goMod);
  const stack: string[] = ["Go"];
  if (/gin-gonic\/gin/i.test(content)) stack.push("Gin");
  if (/echo\/labstack\/echo/i.test(content)) stack.push("Echo");
  return stack;
}

// ============================================================
// 路由提取
// ============================================================

// 将文件路径转换为路由路径
// app/page.tsx → /
// app/login/page.tsx → /login
// app/level/[id]/page.tsx → /level/[id]
// app/api/sign/route.ts → /api/sign
function filePathToRoute(relativePath: string): string {
  // 统一路径分隔符
  const parts = relativePath.split("/").filter(Boolean);

  // App Router 模式
  if (parts[0] === "app" || parts[0] === "src") {
    // 跳过 src 前缀
    let startIdx = 0;
    if (parts[0] === "src") startIdx = 1;
    if (parts[startIdx] === "app") startIdx += 1;

    const routeParts = parts.slice(startIdx);
    // 移除末尾的 page.tsx / page.ts / route.ts / route.tsx
    const last = routeParts[routeParts.length - 1];
    if (
      last === "page.tsx" ||
      last === "page.ts" ||
      last === "page.jsx" ||
      last === "page.js" ||
      last === "route.ts" ||
      last === "route.tsx" ||
      last === "route.jsx" ||
      last === "route.js" ||
      last === "layout.tsx" ||
      last === "layout.ts"
    ) {
      routeParts.pop();
    }

    if (routeParts.length === 0) return "/";
    return "/" + routeParts.join("/");
  }

  // Pages Router 模式
  if (parts[0] === "pages") {
    const routeParts = parts.slice(1);
    const last = routeParts[routeParts.length - 1];
    if (last === "index.tsx" || last === "index.ts") {
      routeParts.pop();
    } else {
      // 移除扩展名
      routeParts[routeParts.length - 1] = last.replace(/\.(tsx?|jsx?)$/, "");
    }

    if (routeParts.length === 0) return "/";
    return "/" + routeParts.join("/");
  }

  return "/" + parts.join("/");
}

// 提取页面路由
function extractPageRoutes(files: CollectedFile[]): string[] {
  const routes: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    const isAppPage =
      (parts[0] === "app" || (parts[0] === "src" && parts[1] === "app")) &&
      (parts[parts.length - 1] === "page.tsx" ||
        parts[parts.length - 1] === "page.ts" ||
        parts[parts.length - 1] === "page.jsx" ||
        parts[parts.length - 1] === "page.js");

    const isPagesRouter =
      parts[0] === "pages" &&
      (parts[parts.length - 1].endsWith(".tsx") ||
        parts[parts.length - 1].endsWith(".ts"));

    if (isAppPage || isPagesRouter) {
      const route = filePathToRoute(file.relativePath);
      if (!seen.has(route)) {
        seen.add(route);
        routes.push(route);
      }
    }
  }

  return routes.sort();
}

// 从 route.ts 文件内容中提取 HTTP 方法
function extractHttpMethods(content: string): string[] {
  const methods: string[] = [];
  const methodRegex = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\b/g;
  let match: RegExpExecArray | null;
  while ((match = methodRegex.exec(content)) !== null) {
    methods.push(match[1]);
  }
  return methods;
}

// 提取 API 路由
function extractApiRoutes(files: CollectedFile[]): string[] {
  const routes: string[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    const isApiRoute =
      (parts[0] === "app" || (parts[0] === "src" && parts[1] === "app")) &&
      parts.includes("api") &&
      (parts[parts.length - 1] === "route.ts" ||
        parts[parts.length - 1] === "route.tsx" ||
        parts[parts.length - 1] === "route.jsx" ||
        parts[parts.length - 1] === "route.js");

    if (isApiRoute) {
      const routePath = filePathToRoute(file.relativePath);
      const content = readFileContent(file);
      const methods = extractHttpMethods(content);

      if (methods.length > 0) {
        for (const method of methods) {
          const route = `${method} ${routePath}`;
          if (!seen.has(route)) {
            seen.add(route);
            routes.push(route);
          }
        }
      } else {
        // 未识别到方法时仅记录路径
        if (!seen.has(routePath)) {
          seen.add(routePath);
          routes.push(routePath);
        }
      }
    }
  }

  return routes.sort();
}

// ============================================================
// README 摘要
// ============================================================

function extractReadmeSummary(files: CollectedFile[]): string {
  const readmeFile = files.find(
    (f) =>
      f.relativePath.toLowerCase() === "readme.md" ||
      f.relativePath.toLowerCase() === "readme",
  );
  if (!readmeFile) return "";

  const content = readFileContent(readmeFile);
  return content.slice(0, MAX_README_LENGTH);
}

// ============================================================
// 目录树构建
// ============================================================

// 构建简化的目录树文本
function buildDirectoryTree(files: CollectedFile[]): string {
  // 构建树结构
  type TreeNode = {
    name: string;
    children: Map<string, TreeNode>;
    isFile: boolean;
  };

  const root: TreeNode = { name: "", children: new Map(), isFile: false };

  for (const file of files) {
    const parts = file.relativePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          children: new Map(),
          isFile: isLast,
        });
      }
      current = current.children.get(part)!;
    }
  }

  // 渲染为文本
  const lines: string[] = ["."];
  const render = (node: TreeNode, prefix: string) => {
    const entries = Array.from(node.children.values()).sort((a, b) => {
      // 目录在前，文件在后
      if (a.children.size > 0 && b.children.size === 0) return -1;
      if (a.children.size === 0 && b.children.size > 0) return 1;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((child, idx) => {
      const isLast = idx === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      lines.push(`${prefix}${connector}${child.name}`);
      if (child.children.size > 0) {
        render(child, prefix + (isLast ? "    " : "│   "));
      }
    });
  };

  render(root, "");

  let tree = lines.join("\n");
  // 控制长度
  if (tree.length > MAX_DIRECTORY_TREE_LENGTH) {
    tree = tree.slice(0, MAX_DIRECTORY_TREE_LENGTH) + "\n... (已截断)";
  }
  return tree;
}

// ============================================================
// 代码摘要构建
// ============================================================

// 构建代码摘要文本（供 LLM 分析）
function buildCodeSummary(
  files: CollectedFile[],
  techStack: string[],
  framework: string,
  pageRoutes: string[],
  apiRoutes: string[],
  dataModels: string[],
): string {
  const sections: string[] = [];

  // 项目概览
  sections.push(`# 项目概览`);
  sections.push(`主框架: ${framework || "未识别"}`);
  sections.push(`技术栈: ${techStack.join(", ") || "未识别"}`);
  sections.push(`页面路由: ${pageRoutes.length} 个`);
  sections.push(`API 路由: ${apiRoutes.length} 个`);
  sections.push(`数据模型: ${dataModels.length} 个`);
  sections.push("");

  // package.json
  const pkgFile = files.find((f) => f.relativePath === "package.json");
  if (pkgFile) {
    sections.push(`# package.json`);
    sections.push("```json");
    sections.push(readFileContent(pkgFile));
    sections.push("```");
    sections.push("");
  }

  // prisma/schema.prisma（兼容 src/prisma/schema.prisma）
  const schemaFile = files.find(
    (f) =>
      f.relativePath === "prisma/schema.prisma" ||
      f.relativePath === "src/prisma/schema.prisma",
  );
  if (schemaFile) {
    sections.push(`# ${schemaFile.relativePath}`);
    sections.push("```prisma");
    sections.push(readFileContent(schemaFile));
    sections.push("```");
    sections.push("");
  }

  // API 路由文件
  const apiFiles = files.filter((f) => {
    const parts = f.relativePath.split("/");
    return (
      (parts[0] === "app" || (parts[0] === "src" && parts[1] === "app")) &&
      parts.includes("api") &&
      (parts[parts.length - 1] === "route.ts" ||
        parts[parts.length - 1] === "route.tsx")
    );
  });

  if (apiFiles.length > 0) {
    sections.push(`# API 路由文件`);
    for (const file of apiFiles) {
      sections.push(`## ${file.relativePath}`);
      sections.push("```typescript");
      sections.push(readFileContent(file));
      sections.push("```");
      sections.push("");
    }
  }

  // 页面路由文件（仅 app 下的 page.tsx）
  const pageFiles = files.filter((f) => {
    const parts = f.relativePath.split("/");
    return (
      (parts[0] === "app" || (parts[0] === "src" && parts[1] === "app")) &&
      (parts[parts.length - 1] === "page.tsx" ||
        parts[parts.length - 1] === "page.ts")
    );
  });

  if (pageFiles.length > 0) {
    sections.push(`# 页面路由文件`);
    for (const file of pageFiles) {
      sections.push(`## ${file.relativePath}`);
      sections.push("```typescript");
      sections.push(readFileContent(file));
      sections.push("```");
      sections.push("");
    }
  }

  // 其他关键文件（lib 下的核心模块）
  const libFiles = files.filter((f) => {
    const parts = f.relativePath.split("/");
    return (
      parts.length > 1 &&
      (parts[0] === "lib" || (parts[0] === "src" && parts[1] === "lib")) &&
      (parts[parts.length - 1].endsWith(".ts") ||
        parts[parts.length - 1].endsWith(".tsx"))
    );
  });

  if (libFiles.length > 0) {
    sections.push(`# 核心库文件`);
    for (const file of libFiles.slice(0, 10)) {
      // 限制数量
      sections.push(`## ${file.relativePath}`);
      sections.push("```typescript");
      sections.push(readFileContent(file));
      sections.push("```");
      sections.push("");
    }
  }

  let summary = sections.join("\n");
  // 控制长度（约 6000 token ≈ 24000 字符）
  if (summary.length > MAX_CODE_SUMMARY_LENGTH) {
    summary = summary.slice(0, MAX_CODE_SUMMARY_LENGTH) + "\n\n... (已截断)";
  }
  return summary;
}

// ============================================================
// 主函数：解析本地项目目录
// ============================================================

export async function parseLocalProject(
  projectPath: string,
): Promise<ParsedProjectInfo> {
  // 路径安全校验
  const normalizedPath = validatePath(projectPath);

  // 收集文件
  const files: CollectedFile[] = [];
  collectFiles(normalizedPath, normalizedPath, 0, files);

  // 识别技术栈
  const { techStack: pkgStack, framework, dependencies } = parsePackageJson(files);
  const { dataModels, database } = parsePrismaSchema(files);
  const pythonStack = detectPythonStack(files);
  const goStack = detectGoStack(files);

  // 合并技术栈
  const techStack = [...pkgStack];
  if (database && !techStack.includes(database)) {
    techStack.push(database);
  }
  for (const tech of pythonStack) {
    if (!techStack.includes(tech)) techStack.push(tech);
  }
  for (const tech of goStack) {
    if (!techStack.includes(tech)) techStack.push(tech);
  }

  // 提取路由
  const pageRoutes = extractPageRoutes(files);
  const apiRoutes = extractApiRoutes(files);

  // README 摘要
  const readmeSummary = extractReadmeSummary(files);

  // 目录树
  const directoryTree = buildDirectoryTree(files);

  // 代码摘要
  const codeSummary = buildCodeSummary(
    files,
    techStack,
    framework,
    pageRoutes,
    apiRoutes,
    dataModels,
  );

  return {
    techStack,
    framework,
    pageRoutes,
    apiRoutes,
    dataModels,
    dependencies,
    readmeSummary,
    codeSummary,
    fileCount: files.length,
    directoryTree,
  };
}

// ============================================================
// 主函数：解析 ZIP 项目包
// ============================================================

export async function parseZipProject(
  zipBuffer: Buffer,
  _originalName: string,
): Promise<ParsedProjectInfo> {
  // 创建临时目录
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "tc-parse-"),
  );

  try {
    // 解压 ZIP 到临时目录
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(tempDir, true);

    // 检查解压后的根目录：某些 ZIP 会包含一层顶层目录
    const entries = fs.readdirSync(tempDir, { withFileTypes: true });
    let projectRoot = tempDir;

    // 如果只有一个子目录且没有 package.json 在根目录，进入该子目录
    const hasPkgInRoot = fs.existsSync(path.join(tempDir, "package.json"));
    if (!hasPkgInRoot && entries.length === 1 && entries[0].isDirectory()) {
      projectRoot = path.join(tempDir, entries[0].name);
    }

    // 调用本地项目解析
    return await parseLocalProject(projectRoot);
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 清理失败时忽略
    }
  }
}
