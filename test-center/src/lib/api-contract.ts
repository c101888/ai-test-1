// API 契约识别模块
// 用于自动识别被测项目的认证 API 契约（登录/注册/退出路径、字段名、请求格式、响应格式）
// 三层识别策略：
//   1. 从项目本地代码扫描识别（app/auth/*/route.ts 等）
//   2. 从 AnalysisModel.overview.apis 中提取（AI 分析结果）
//   3. 运行时探测（尝试常见路径，根据响应判断）
// 识别失败时返回 null，调用方降级到 Playwright UI 驱动

import "server-only";
import type { AnalysisModel, Project } from "./store";

// ============================================================
// API 契约类型定义
// ============================================================

// 请求体格式
export type RequestFormat = "json" | "formdata" | "urlencoded";

// 认证方式
export type AuthScheme = "bearer" | "cookie" | "none";

// 单个 API 端点契约
export interface ApiEndpointContract {
  path: string; // API 路径，如 "/auth/login"
  method: "POST" | "GET" | "DELETE";
  requestFormat: RequestFormat; // 请求体格式
  fields: Record<string, string>; // 字段映射，如 { username: "loginId", password: "password" }
  // 成功响应判断
  successStatus: number[]; // 成功状态码，如 [200, 303]
  successRedirect?: string; // 成功重定向路径（如 "/"），303 重定向时判断
  // 失败响应判断
  failureStatus: number[]; // 失败状态码，如 [400, 303]
  failureRedirect?: string; // 失败重定向路径（如 "/login?error=invalid"）
  // 认证信息提取
  authScheme: AuthScheme; // 认证方式
  tokenField?: string; // token 字段名（bearer 模式），如 "token"
  cookieName?: string; // cookie 名（cookie 模式），如 "session"
}

// 完整认证契约
export interface AuthContract {
  login?: ApiEndpointContract;
  register?: ApiEndpointContract;
  logout?: ApiEndpointContract;
  // 受保护资源路径（用于验证登录态）
  protectedResource?: string;
  // 来源标记
  source: "ai-analysis" | "code-scan" | "probe" | "unknown";
}

// ============================================================
// 第1层：从 AnalysisModel 提取 API 契约
// ============================================================

// 从 AI 分析结果的 apis 列表中识别认证相关 API
// apis 格式示例：["POST /api/auth/login", "POST /api/auth/register", "/api/level"]
export function extractContractFromAnalysis(
  analysisModel: AnalysisModel | undefined,
): AuthContract | null {
  if (!analysisModel?.overview?.apis) return null;

  const apis = analysisModel.overview.apis;
  const authMethod = analysisModel.overview.authMethod || "";

  const login = findAuthEndpoint(apis, ["login", "signin"], "POST");
  const register = findAuthEndpoint(apis, ["register", "signup"], "POST");
  const logout = findAuthEndpoint(apis, ["logout", "signout"], "POST");

  if (!login && !register) return null;

  // 根据登录方式推断认证方案
  const authScheme = inferAuthScheme(authMethod);

  return {
    login: login
      ? buildEndpointContract(login, "login", authScheme)
      : undefined,
    register: register
      ? buildEndpointContract(register, "register", authScheme)
      : undefined,
    logout: logout
      ? buildEndpointContract(logout, "logout", authScheme)
      : undefined,
    protectedResource: findProtectedResource(apis),
    source: "ai-analysis",
  };
}

// 从 API 列表中查找认证端点
function findAuthEndpoint(
  apis: string[],
  keywords: string[],
  method: string,
): { path: string; method: string } | null {
  for (const api of apis) {
    const apiLower = api.toLowerCase();
    // 解析 "METHOD /path" 或 "/path" 格式
    const parts = apiLower.trim().split(/\s+/);
    const apiMethod = parts.length > 1 ? parts[0] : method;
    const apiPath = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];

    if (apiMethod === method.toLowerCase()) {
      for (const kw of keywords) {
        if (apiPath.includes(kw)) {
          return { path: apiPath, method: apiMethod.toUpperCase() };
        }
      }
    }
  }
  return null;
}

// 推断认证方案
function inferAuthScheme(authMethod: string): AuthScheme {
  const lower = authMethod.toLowerCase();
  if (lower.includes("cookie") || lower.includes("session")) {
    return "cookie";
  }
  if (lower.includes("jwt") || lower.includes("bearer") || lower.includes("token")) {
    return "bearer";
  }
  return "bearer"; // 默认 bearer
}

// 构建端点契约
function buildEndpointContract(
  endpoint: { path: string; method: string },
  type: "login" | "register" | "logout",
  authScheme: AuthScheme,
): ApiEndpointContract {
  return {
    path: endpoint.path,
    method: endpoint.method as "POST" | "GET" | "DELETE",
    requestFormat: "json", // AI 分析默认 json，运行时探测会修正
    fields:
      type === "register"
        ? { username: "username", password: "password" }
        : { username: "username", password: "password" },
    successStatus: [200],
    failureStatus: [400, 401],
    authScheme,
    tokenField: authScheme === "bearer" ? "token" : undefined,
  };
}

// 查找受保护资源路径
function findProtectedResource(apis: string[]): string | undefined {
  // 优先返回非 auth 相关的 API 路径
  for (const api of apis) {
    const parts = api.trim().split(/\s+/);
    const path = parts.length > 1 ? parts.slice(1).join(" ") : parts[0];
    const lower = path.toLowerCase();
    if (
      !lower.includes("login") &&
      !lower.includes("register") &&
      !lower.includes("logout") &&
      !lower.includes("auth")
    ) {
      return path;
    }
  }
  return undefined;
}

// ============================================================
// 第2层：扫描项目本地代码识别 API 契约
// ============================================================

// 扫描项目本地代码，识别认证 API 契约
// 针对 Next.js App Router 项目：扫描 app/auth/*/route.ts
// 针对 Pages Router 项目：扫描 pages/api/auth/*.ts
export async function scanProjectForContract(
  localPath: string,
): Promise<AuthContract | null> {
  try {
    const fs = eval("require")("fs") as typeof import("fs");
    const path = eval("require")("path") as typeof import("path");

    // 候选目录：Next.js App Router / Pages Router
    const candidates = [
      path.join(localPath, "app", "auth"), // Next.js App Router: app/auth/login/route.ts
      path.join(localPath, "app", "api", "auth"), // Next.js App Router: app/api/auth/login/route.ts
      path.join(localPath, "src", "app", "auth"),
      path.join(localPath, "src", "app", "api", "auth"),
      path.join(localPath, "pages", "api", "auth"), // Pages Router
    ];

    for (const dir of candidates) {
      if (!fs.existsSync(dir)) continue;
      const contract = scanAuthDirectory(fs, path, dir, localPath);
      if (contract) return contract;
    }

    return null;
  } catch (err) {
    console.error("[api-contract] 扫描项目代码失败:", err);
    return null;
  }
}

// 扫描认证目录
function scanAuthDirectory(
  fs: typeof import("fs"),
  path: typeof import("path"),
  dir: string,
  projectRoot: string,
): AuthContract | null {
  let login: ApiEndpointContract | undefined;
  let register: ApiEndpointContract | undefined;
  let logout: ApiEndpointContract | undefined;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const routeFile = path.join(dir, entry.name, "route.ts");
      const routeJsFile = path.join(dir, entry.name, "route.js");
      const filePath = fs.existsSync(routeFile)
        ? routeFile
        : fs.existsSync(routeJsFile)
          ? routeJsFile
          : null;
      if (!filePath) continue;

      const content = fs.readFileSync(filePath, "utf8");
      const name = entry.name.toLowerCase();

      // 推断 API 路径（去除 projectRoot，转为 URL 路径）
      // 注意：Next.js App Router 中 app/ 目录是根，不包含在 URL 中
      // 例如：app/auth/login/route.ts → /auth/login
      let relPath = path.relative(projectRoot, dir).replace(/\\/g, "/");
      // 去除常见的前缀目录：app/、src/app/、pages/api/（Pages Router 保留 api/）
      relPath = relPath
        .replace(/^src\/app\//, "")
        .replace(/^app\//, "");
      const apiPath = `/${relPath}/${entry.name}`;

      if (name === "login" || name === "signin") {
        login = parseRouteFile(content, apiPath, "login");
      } else if (name === "register" || name === "signup") {
        register = parseRouteFile(content, apiPath, "register");
      } else if (name === "logout" || name === "signout") {
        logout = parseRouteFile(content, apiPath, "logout");
      }
    }
  } catch {
    // 忽略
  }

  if (!login && !register) return null;

  return {
    login,
    register,
    logout,
    source: "code-scan",
  };
}

// 解析 route.ts 文件内容，提取契约信息
function parseRouteFile(
  content: string,
  apiPath: string,
  type: "login" | "register" | "logout",
): ApiEndpointContract {
  // 检测请求格式：formData() → formdata，request.json() → json
  const usesFormData = /request\.formData\s*\(\s*\)/.test(content);
  const usesJson = /request\.json\s*\(\s*\)/.test(content);
  const requestFormat: RequestFormat = usesFormData
    ? "formdata"
    : usesJson
      ? "json"
      : "json";

  // 提取字段名：formData.get("xxx") 或 body.xxx
  const fieldRegex = /(?:formData|body|data)\.(?:get\s*\(\s*["']|["']?)(\w+)/g;
  const fields: Record<string, string> = {};
  let match: RegExpExecArray | null;
  const foundFields = new Set<string>();
  while ((match = fieldRegex.exec(content)) !== null) {
    foundFields.add(match[1]);
  }

  // 映射标准字段名
  if (foundFields.has("loginId")) {
    fields.username = "loginId";
  } else if (foundFields.has("username")) {
    fields.username = "username";
  } else if (foundFields.has("email")) {
    fields.username = "email";
  }
  if (foundFields.has("password")) {
    fields.password = "password";
  }
  if (foundFields.has("adminPassword")) {
    fields.adminPassword = "adminPassword";
  }
  if (foundFields.has("displayName")) {
    fields.displayName = "displayName";
  }

  // 检测认证方式：cookies.set → cookie，token → bearer
  const usesCookie = /cookies\.set\s*\(/.test(content);
  const usesToken = /token/i.test(content) && !usesCookie;
  const authScheme: AuthScheme = usesCookie ? "cookie" : usesToken ? "bearer" : "none";

  // 检测重定向：NextResponse.redirect → 303
  const usesRedirect = /redirect\s*\(/.test(content);
  const successStatus = usesRedirect ? [303, 200] : [200];
  const failureStatus = usesRedirect ? [303] : [400, 401];

  // 提取重定向路径
  let successRedirect: string | undefined;
  let failureRedirect: string | undefined;
  if (usesRedirect) {
    const redirectRegex = /redirect\s*\(\s*[^,)]*?["'`]([^"'`]+)["'`]/g;
    while ((match = redirectRegex.exec(content)) !== null) {
      const redirectPath = match[1];
      if (
        redirectPath.includes("error") ||
        redirectPath.includes("login") ||
        redirectPath.includes("register")
      ) {
        failureRedirect = redirectPath;
      } else {
        successRedirect = redirectPath;
      }
    }
  }

  // 提取 cookie 名
  let cookieName: string | undefined;
  if (usesCookie) {
    const cookieRegex = /cookies\.set\s*\(\s*["'`]([^"'`]+)["'`]/;
    const cookieMatch = cookieRegex.exec(content);
    if (cookieMatch) {
      cookieName = cookieMatch[1];
    }
  }

  return {
    path: apiPath,
    method: "POST",
    requestFormat,
    fields,
    successStatus,
    successRedirect,
    failureStatus,
    failureRedirect,
    authScheme,
    tokenField: authScheme === "bearer" ? "token" : undefined,
    cookieName,
  };
}

// ============================================================
// 第3层：运行时探测（尝试常见路径）
// ============================================================

// 运行时探测认证 API 契约
// 尝试常见登录路径，根据响应判断
export async function probeAuthContract(
  baseUrl: string,
): Promise<AuthContract | null> {
  const candidates = [
    "/api/auth/login",
    "/auth/login",
    "/api/login",
    "/login",
    "/api/user/login",
  ];

  for (const path of candidates) {
    try {
      // 用 OPTIONS 或 GET 探测路径是否存在
      const resp = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
        redirect: "manual", // 不跟随重定向，便于判断
      });

      // 405 表示路径存在但不支持 GET（通常是 POST 端点）
      // 303/302 表示重定向（可能是表单提交端点）
      // 200 + HTML 表示是页面不是 API
      if (resp.status === 405 || resp.status === 303 || resp.status === 302) {
        return {
          login: {
            path,
            method: "POST",
            requestFormat: "json",
            fields: { username: "username", password: "password" },
            successStatus: [200, 303],
            failureStatus: [400, 401, 303],
            authScheme: "bearer",
            tokenField: "token",
          },
          source: "probe",
        };
      }
    } catch {
      // 忽略
    }
  }

  return null;
}

// ============================================================
// 统一入口：获取项目的认证契约
// ============================================================

export async function getAuthContract(
  project: Project,
): Promise<AuthContract | null> {
  // 第1层优先：扫描项目本地代码（最准确，能识别 FormData/字段名/cookie）
  // 代码扫描能精确识别 requestFormat（formdata/json）、字段名、认证方式
  if (project.localPath) {
    const contract = await scanProjectForContract(project.localPath);
    if (contract) return contract;
  }

  // 第2层：从 AI 分析结果提取（代码扫描失败时使用，如项目代码不可访问）
  if (project.analysisModel) {
    const contract = extractContractFromAnalysis(project.analysisModel);
    if (contract) return contract;
  }

  // 第3层：运行时探测（前两层都失败时使用）
  if (project.testUrl) {
    const contract = await probeAuthContract(project.testUrl);
    if (contract) return contract;
  }

  return null;
}
