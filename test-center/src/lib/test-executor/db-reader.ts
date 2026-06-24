// SQLite 数据库只读器
// 用于前后状态对比（签到前积分 vs 签到后积分），验证数据持久化
// 仅支持 SELECT 查询，禁止任何写操作
// 仅在服务端使用

import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { IDbReader } from "./types";

// 校验 SQL 是否为纯 SELECT（防止写操作）
export function validateSelectOnly(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();

  // 必须以 SELECT 或 WITH 开头
  if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
    return false;
  }

  // 禁止包含写操作关键字（简单校验，可能误判但安全优先）
  const forbidden = [
    /\binsert\b/i,
    /\bupdate\b/i,
    /\bdelete\b/i,
    /\bdrop\b/i,
    /\bcreate\b/i,
    /\balter\b/i,
    /\btruncate\b/i,
    /\breplace\b/i,
    /\battach\b/i,
    /\bdetach\b/i,
    /\bpragma\b/i,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }

  return true;
}

// 解析 .env / .env.local 中的 DATABASE_URL
// Prisma 的 DATABASE_URL 通常是 file:./dev.db 或 file:./prisma/dev.db
// file: 前缀后的路径相对于 prisma schema 所在目录（通常是 prisma/）或项目根目录
export function parseEnvDatabaseUrl(localPath: string): string | null {
  const envFiles = [".env.local", ".env"];

  let databaseUrl: string | null = null;

  for (const fileName of envFiles) {
    const envPath = path.join(localPath, fileName);
    try {
      if (!fs.existsSync(envPath)) continue;
      const content = fs.readFileSync(envPath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        // 忽略空行和注释
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed
          .slice(eqIndex + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key === "DATABASE_URL") {
          databaseUrl = value;
          break;
        }
      }
      if (databaseUrl) break;
    } catch {
      // 忽略读取错误
    }
  }

  if (!databaseUrl) return null;

  // 仅处理 file: 前缀的 SQLite 路径
  if (!databaseUrl.startsWith("file:")) {
    return null;
  }

  const filePath = databaseUrl.slice("file:".length);

  // file: 路径相对于 prisma schema 所在目录（通常是 prisma/）或项目根目录
  const bases = [path.join(localPath, "prisma"), localPath];

  for (const base of bases) {
    const resolved = path.resolve(base, filePath);
    try {
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // 忽略
    }
  }

  return null;
}

// 推导 SQLite 文件路径
// 优先解析 .env / .env.local 中的 DATABASE_URL，再回退到常见 Prisma 结构
export function resolveDbPath(localPath: string): string | null {
  const candidates: string[] = [];

  // 优先使用 .env / .env.local 中 DATABASE_URL 解析出的路径
  const envPath = parseEnvDatabaseUrl(localPath);
  if (envPath) {
    candidates.push(envPath);
  }

  // 兜底：常见 Prisma 结构硬编码路径
  candidates.push(
    path.join(localPath, "prisma", "dev.db"),
    path.join(localPath, "prisma", "prod.db"),
    path.join(localPath, "prisma", "test.db"),
    path.join(localPath, "dev.db"),
    path.join(localPath, "data.db"),
    path.join(localPath, "app.db"),
  );

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // 忽略
    }
  }

  return null;
}

// SQLite 只读器实现
// 使用 better-sqlite3（演示项目已安装），以只读模式打开
// 注意：better-sqlite3 是原生模块，需要动态导入以避免构建时类型检查
export class SqliteReader implements IDbReader {
  private dbPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getDb(): Promise<any> {
    if (this.db) return this.db;

    try {
      // 动态导入 better-sqlite3（避免在客户端构建时加载）
      const Database = (await import("better-sqlite3")).default;
      // 以只读模式打开
      this.db = new Database(this.dbPath, {
        readonly: true,
        fileMustExist: true,
      });
      return this.db;
    } catch (err) {
      throw new Error(
        `无法打开 SQLite 数据库 ${this.dbPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (!validateSelectOnly(sql)) {
      throw new Error(
        `安全限制：仅支持 SELECT 查询。拒绝执行: ${sql.slice(0, 100)}`,
      );
    }

    const db = await this.getDb();
    try {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (err) {
      throw new Error(
        `SQL 查询失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async count(
    table: string,
    whereClause?: string,
    whereParams?: unknown[],
  ): Promise<number> {
    // 表名校验（只允许字母数字下划线）
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
      throw new Error(`非法表名: ${table}`);
    }

    const sql = whereClause
      ? `SELECT COUNT(*) as cnt FROM ${table} WHERE ${whereClause}`
      : `SELECT COUNT(*) as cnt FROM ${table}`;

    const result = await this.query<{ cnt: number }>(sql, whereParams || []);
    return result[0]?.cnt ?? 0;
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // 忽略关闭错误
      }
      this.db = null;
    }
  }
}

// 便捷函数：从项目路径创建 DB 读取器
export async function createDbReader(
  localPath: string,
): Promise<SqliteReader | null> {
  const dbPath = resolveDbPath(localPath);
  if (!dbPath) {
    return null;
  }

  try {
    const reader = new SqliteReader(dbPath);
    // 测试连接
    await reader.query("SELECT 1 as test");
    return reader;
  } catch {
    return null;
  }
}
