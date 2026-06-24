import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  parseZipProject,
  type ParsedProjectInfo,
} from "@/lib/project-parser";

// 文件上传 API
// - POST：接收 multipart/form-data，保存文件到 .data/uploads/
// - 支持代码包（.zip/.tar.gz）和文档（.md/.txt/.pdf 等）
// - 代码包会自动解析并返回 ParsedProjectInfo
// - 文档会保存到本地并返回文件路径，供后续分析使用

// 允许的代码包扩展名
const CODE_EXTENSIONS = [".zip", ".tar.gz", ".tgz"];
// 允许的文档扩展名
const DOC_EXTENSIONS = [
  ".md",
  ".txt",
  ".markdown",
  ".pdf",
  ".doc",
  ".docx",
  ".json",
  ".yaml",
  ".yml",
];
// 最大文件大小：100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

function getUploadDir(): string {
  const dir = path.join(process.cwd(), ".data", "uploads");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function safeFileName(name: string): string {
  // 移除路径分隔符，仅保留文件名
  const base = path.basename(name);
  // 替换危险字符
  return base.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "请使用 multipart/form-data 上传文件" },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const kind = (formData.get("kind") as string) || "code"; // code | doc

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "未提供文件" },
        { status: 400 },
      );
    }

    // 文件大小校验
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `文件大小超过限制（最大 ${Math.floor(MAX_FILE_SIZE / 1024 / 1024)}MB）`,
        },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "文件为空" },
        { status: 400 },
      );
    }

    const originalName = file.name;
    const lowerName = originalName.toLowerCase();

    // 扩展名校验
    const allowedExt =
      kind === "doc" ? DOC_EXTENSIONS : CODE_EXTENSIONS;
    const extOk = allowedExt.some((ext) => lowerName.endsWith(ext));
    if (!extOk) {
      return NextResponse.json(
        {
          error: `不支持的文件类型，允许：${allowedExt.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // 读取文件内容
    const buffer = Buffer.from(await file.arrayBuffer());

    // 生成唯一文件名：时间戳 + 随机串 + 原始名
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString("hex");
    const safeName = safeFileName(originalName);
    const savedName = `${timestamp}-${random}-${safeName}`;
    const uploadDir = getUploadDir();
    const savedPath = path.join(uploadDir, savedName);

    // 保存文件
    fs.writeFileSync(savedPath, buffer);

    // 相对路径（用于后续 API 引用）
    const relativePath = path
      .join(".data", "uploads", savedName)
      .split(path.sep)
      .join("/");

    // 代码包：自动解析
    let parsedInfo: ParsedProjectInfo | null = null;
    if (kind === "code") {
      try {
        if (lowerName.endsWith(".zip")) {
          parsedInfo = await parseZipProject(buffer, originalName);
        } else if (
          lowerName.endsWith(".tar.gz") ||
          lowerName.endsWith(".tgz")
        ) {
          // tar.gz 暂不支持解析，仅保存
          // 如需支持，可引入 tar 库
        }
      } catch (err) {
        // 解析失败不阻断上传，但返回警告
        console.error("解析上传的代码包失败:", err);
      }
    }

    // 文档：尝试读取文本内容（用于后续分析）
    let textContent: string | null = null;
    if (kind === "doc") {
      try {
        if (
          lowerName.endsWith(".md") ||
          lowerName.endsWith(".txt") ||
          lowerName.endsWith(".markdown") ||
          lowerName.endsWith(".json") ||
          lowerName.endsWith(".yaml") ||
          lowerName.endsWith(".yml")
        ) {
          textContent = buffer.toString("utf8");
          // 限制文本长度（避免过大）
          if (textContent.length > 50000) {
            textContent = textContent.slice(0, 50000) + "\n\n... (已截断)";
          }
        }
      } catch {
        // 读取失败时忽略
      }
    }

    return NextResponse.json({
      ok: true,
      file: {
        originalName,
        savedName,
        savedPath: relativePath,
        absolutePath: savedPath,
        size: file.size,
        type: file.type || "application/octet-stream",
      },
      parsedInfo,
      textContent,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "文件上传失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
