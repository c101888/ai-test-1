import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

// 本地目录浏览 API
// - GET：返回默认根目录列表（用户主目录 + 常见盘符）
// - POST：接收 { path: string }，返回该目录下的子目录列表
// 用于接入页的"浏览..."按钮，让用户可视化选择本地项目路径

// 系统目录黑名单（禁止浏览）
const BLOCKED_DIRS = new Set([
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
  "C:\\System Volume Information",
  "C:\\Recovery",
  "C:\\$Recycle.Bin",
]);

function isBlocked(dir: string): boolean {
  const normalized = path.resolve(dir).toLowerCase();
  for (const blocked of BLOCKED_DIRS) {
    if (normalized === blocked.toLowerCase()) return true;
    if (normalized.startsWith(blocked.toLowerCase() + path.sep)) return true;
  }
  return false;
}

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

function listDirectory(dir: string): DirEntry[] {
  const entries: DirEntry[] = [];
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      // 仅显示目录，隐藏文件/目录过滤
      if (!item.isDirectory()) continue;
      if (item.name.startsWith(".") && item.name !== ".") continue;
      // 过滤 node_modules、.git 等大目录
      if (
        item.name === "node_modules" ||
        item.name === ".git" ||
        item.name === ".next" ||
        item.name === "__pycache__"
      )
        continue;
      entries.push({
        name: item.name,
        path: path.join(dir, item.name),
        isDir: true,
      });
    }
  } catch {
    // 无权限或不存在时返回空
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return entries;
}

// 获取默认根目录列表（Windows 盘符 + 用户主目录）
function getDefaultRoots(): DirEntry[] {
  const roots: DirEntry[] = [];
  // 用户主目录
  const home = os.homedir();
  roots.push({ name: `主目录 (${home})`, path: home, isDir: true });
  // Windows 盘符
  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code++) {
      const letter = String.fromCharCode(code);
      const drive = `${letter}:\\`;
      try {
        fs.accessSync(drive, fs.constants.R_OK);
        roots.push({
          name: `${letter}: 盘`,
          path: drive,
          isDir: true,
        });
      } catch {
        // 盘符不存在
      }
    }
  } else {
    roots.push({ name: "根目录 /", path: "/", isDir: true });
  }
  return roots;
}

// GET：返回默认根目录
export async function GET() {
  try {
    const roots = getDefaultRoots();
    return NextResponse.json({
      current: "",
      parent: null,
      entries: roots,
      isRoot: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "获取根目录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST：浏览指定目录
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const targetPath = body.path;

    if (!targetPath || typeof targetPath !== "string") {
      return NextResponse.json(
        { error: "未提供目录路径" },
        { status: 400 },
      );
    }

    // 安全校验
    if (isBlocked(targetPath)) {
      return NextResponse.json(
        { error: "禁止访问系统目录" },
        { status: 403 },
      );
    }

    // 解析路径（支持相对路径）
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(resolved)) {
      return NextResponse.json(
        { error: `目录不存在：${resolved}` },
        { status: 404 },
      );
    }

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return NextResponse.json(
        { error: `不是目录：${resolved}` },
        { status: 400 },
      );
    }

    const entries = listDirectory(resolved);
    // 父目录（用于返回上一级）
    const parent = path.dirname(resolved);

    return NextResponse.json({
      current: resolved,
      parent: parent !== resolved ? parent : null,
      entries,
      isRoot: false,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "浏览目录失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
