// 测试执行器统一入口
// 根据 mode 创建执行器，提供统一的执行接口
// 仅在服务端使用

import "server-only";
import type { Evidence } from "../store";
import type { ExecutionContext, ITestExecutor, IPage, IApiDriver, IDbReader } from "./types";
import { PlaywrightDriver, createBrowser, createPage } from "./playwright-driver";
import { ApiDriver } from "./api-driver";
import { createDbReader } from "./db-reader";
import { checkPlaywrightInstalled } from "./playwright-check";

// 真实执行器实现
export class RealTestExecutor implements ITestExecutor {
  browser?: IPage;
  api: IApiDriver;
  db?: IDbReader;
  baseUrl: string;
  private driver?: PlaywrightDriver;
  private context?: { close: () => Promise<void> };

  constructor(
    api: IApiDriver,
    baseUrl: string,
    driver?: PlaywrightDriver,
    browser?: IPage,
    context?: { close: () => Promise<void> },
    db?: IDbReader,
  ) {
    this.api = api;
    this.baseUrl = baseUrl;
    this.driver = driver;
    this.browser = browser;
    this.context = context;
    this.db = db;
  }

  async collectEvidence(): Promise<Evidence[]> {
    const evidences: Evidence[] = [];

    // 收集浏览器证据
    if (this.browser) {
      try {
        const screenshot = await this.browser.screenshot();
        evidences.push({
          id: `ev_${Math.random().toString(36).slice(2, 10)}`,
          type: "screenshot",
          content: `截图（base64，前 100 字符）: ${screenshot.slice(0, 100)}...`,
        });
      } catch {
        // 截图失败忽略
      }

      const consoleLogs = this.browser.getConsoleLogs();
      if (consoleLogs.length > 0) {
        evidences.push({
          id: `ev_${Math.random().toString(36).slice(2, 10)}`,
          type: "console",
          content: consoleLogs.slice(-20).join("\n"),
        });
      }

      const networkRequests = this.browser.getNetworkRequests();
      if (networkRequests.length > 0) {
        const networkText = networkRequests
          .slice(-20)
          .map(
            (req) =>
              `${req.method} ${req.url} → ${req.status} (${req.durationMs ?? 0}ms)`,
          )
          .join("\n");
        evidences.push({
          id: `ev_${Math.random().toString(36).slice(2, 10)}`,
          type: "network",
          content: networkText,
        });
      }
    }

    return evidences;
  }

  async close(): Promise<void> {
    // 每个资源关闭都加 5 秒超时，避免浏览器卡死时无限挂起
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error("close 超时")), ms),
        ),
      ]);
    try {
      if (this.browser) {
        await withTimeout(this.browser.close(), 5000);
      }
    } catch {
      // 忽略
    }
    try {
      if (this.context) {
        await withTimeout(this.context.close(), 5000);
      }
    } catch {
      // 忽略
    }
    try {
      if (this.driver) {
        await withTimeout(this.driver.close(), 5000);
      }
    } catch {
      // 忽略
    }
    try {
      if (this.db) {
        await withTimeout(this.db.close(), 5000);
      }
    } catch {
      // 忽略
    }
  }
}

// 创建真实执行器
export async function createRealExecutor(
  ctx: ExecutionContext,
  options?: { useBrowser?: boolean; useDb?: boolean },
): Promise<RealTestExecutor> {
  const { useBrowser = true, useDb = true } = options ?? {};

  // 创建 API 驱动
  const api = new ApiDriver(ctx.baseUrl);
  if (ctx.authToken) {
    api.setAuth(ctx.authToken);
  }

  // 可选：创建浏览器
  let driver: PlaywrightDriver | undefined;
  let browser: IPage | undefined;
  let context: { close: () => Promise<void> } | undefined;

  if (useBrowser) {
    // 先检查 chromium 是否已安装
    const check = await checkPlaywrightInstalled();
    if (!check.ok) {
      throw new Error(
        `${check.error}\n修复建议：${check.fixHint ?? "请运行: npx playwright install chromium"}`,
      );
    }
    driver = await createBrowser();
    if (!driver) {
      throw new Error("浏览器启动失败");
    }
    const pageHandle = await createPage(driver);
    browser = pageHandle.page;
    context = pageHandle.context;
  }

  // 可选：创建 DB 读取器
  let db: IDbReader | undefined;
  if (useDb && ctx.dbPath) {
    try {
      const { SqliteReader } = await import("./db-reader");
      db = new SqliteReader(ctx.dbPath);
      // 测试连接
      await db.query("SELECT 1 as test");
    } catch {
      // DB 连接失败不阻断，继续无 DB 模式
      db = undefined;
    }
  }

  return new RealTestExecutor(api, ctx.baseUrl, driver, browser, context, db);
}

// 便捷函数：登录并返回带认证的执行器
export async function createAuthenticatedExecutor(
  ctx: ExecutionContext,
  loginUrl: string,
  credentials: { username: string; password: string },
  options?: { useBrowser?: boolean; useDb?: boolean },
): Promise<{ executor: RealTestExecutor; token: string }> {
  // 先创建无浏览器执行器用于登录
  const loginExecutor = await createRealExecutor(ctx, {
    useBrowser: false,
    useDb: false,
  });

  const token = await loginExecutor.api.post(loginUrl, credentials).then((res) => {
    if (!res.ok) {
      throw new Error(`登录失败: ${res.status} ${JSON.stringify(res.body)}`);
    }
    const body = res.body as { token?: string } | null;
    if (!body?.token) {
      throw new Error("登录响应缺少 token");
    }
    return body.token;
  });

  await loginExecutor.close();

  // 创建带认证的执行器
  const executor = await createRealExecutor(
    { ...ctx, authToken: token },
    options,
  );

  return { executor, token };
}
