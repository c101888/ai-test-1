// Playwright 浏览器驱动封装
// 提供 headless Chromium 操作能力，用于真实执行基础测试和高级测试
// 仅在服务端使用（API 路由层调用）

import "server-only";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type {
  IBrowserDriver,
  IBrowserContext,
  IPage,
  NetworkRequest,
} from "./types";

// Playwright Page 适配器，实现 IPage 接口
class PlaywrightPageAdapter implements IPage {
  private page: Page;
  private consoleLogs: string[] = [];
  private networkRequests: NetworkRequest[] = [];

  constructor(page: Page) {
    this.page = page;

    // 收集 console 日志
    this.page.on("console", (msg) => {
      this.consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // 收集网络请求
    this.page.on("response", async (response) => {
      try {
        const request = response.request();
        let requestBody: unknown = undefined;
        let responseBody: unknown = undefined;

        try {
          const postData = request.postData();
          if (postData) {
            requestBody = JSON.parse(postData);
          }
        } catch {
          // 非 JSON body，忽略
        }

        try {
          const contentType = response.headers()["content-type"] || "";
          if (contentType.includes("application/json")) {
            responseBody = await response.json();
          }
        } catch {
          // 无法解析为 JSON，忽略
        }

        this.networkRequests.push({
          method: request.method(),
          url: response.url(),
          status: response.status(),
          method_text: request.method(),
          requestHeaders: request.headers(),
          requestBody,
          responseHeaders: response.headers(),
          responseBody,
        });
      } catch {
        // 忽略收集错误
      }
    });
  }

  async goto(url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<void> {
    await this.page.goto(url, {
      timeout: options?.timeout ?? 30000,
      waitUntil: options?.waitUntil ?? "networkidle",
    });
  }

  async waitForLoadState(state: "load" | "domcontentloaded" | "networkidle" = "load", options?: { timeout?: number }): Promise<void> {
    await this.page.waitForLoadState(state, {
      timeout: options?.timeout ?? 30000,
    });
  }

  async click(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.page.click(selector, {
      timeout: options?.timeout ?? 10000,
    });
  }

  async fill(
    selector: string,
    value: string,
    options?: { timeout?: number },
  ): Promise<void> {
    await this.page.fill(selector, value, {
      timeout: options?.timeout ?? 10000,
    });
  }

  async text(selector: string, options?: { timeout?: number }): Promise<string> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 10000,
    });
    return (await this.page.textContent(selector)) ?? "";
  }

  async isVisible(
    selector: string,
    options?: { timeout?: number },
  ): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, {
        timeout: options?.timeout ?? 5000,
        state: "visible",
      });
      return true;
    } catch {
      return false;
    }
  }

  async waitForSelector(
    selector: string,
    options?: { timeout?: number },
  ): Promise<void> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout ?? 10000,
    });
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async evaluate(fn: (() => unknown) | ((arg: unknown) => unknown), arg?: unknown): Promise<unknown> {
    if (arg !== undefined) {
      return await this.page.evaluate(fn as (arg: unknown) => unknown, arg);
    }
    return await this.page.evaluate(fn as () => unknown);
  }

  async screenshot(): Promise<string> {
    const buffer = await this.page.screenshot({ fullPage: false });
    return buffer.toString("base64");
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 8000 });
  }

  url(): string {
    return this.page.url();
  }

  async close(): Promise<void> {
    await Promise.race([
      this.page.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("page.close 超时")), 5000)),
    ]).catch(() => {});
  }

  async clearCookies(): Promise<void> {
    await this.page.context().clearCookies();
  }

  // 获取浏览器上下文的所有 cookie（用于同步到 API 驱动）
  async getCookies(): Promise<Array<{ name: string; value: string; domain: string; path: string }>> {
    return await this.page.context().cookies();
  }

  getConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }

  getNetworkRequests(): NetworkRequest[] {
    return [...this.networkRequests];
  }

  // 暴露原始 page（供高级测试使用）
  getRawPage(): Page {
    return this.page;
  }
}

// Playwright Context 适配器
class PlaywrightContextAdapter implements IBrowserContext {
  private context: BrowserContext;

  constructor(context: BrowserContext) {
    this.context = context;
  }

  async newPage(): Promise<IPage> {
    const page = await this.context.newPage();
    return new PlaywrightPageAdapter(page);
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

// Playwright 驱动实现
export class PlaywrightDriver implements IBrowserDriver {
  private browser: Browser | null = null;
  private headless: boolean;

  constructor(headless?: boolean) {
    // 优先使用传入参数，其次读取环境变量 PLAYWRIGHT_HEADLESS
    // 默认 headless=true（生产环境），可设为 false 以便调试观察
    if (typeof headless === "boolean") {
      this.headless = headless;
    } else {
      const env = process.env.PLAYWRIGHT_HEADLESS;
      this.headless = env ? env !== "false" && env !== "0" : true;
    }
  }

  async launch(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: this.headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      timeout: 15000,
    });
  }

  async newContext(): Promise<IBrowserContext> {
    if (!this.browser) {
      await this.launch();
    }
    const context = await Promise.race([
      this.browser!.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("newContext 超时")), 10000),
      ),
    ]);
    return new PlaywrightContextAdapter(context);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await Promise.race([
        this.browser.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("browser.close 超时")), 5000)),
      ]).catch(() => {});
      this.browser = null;
    }
  }
}

// 便捷函数：创建并启动浏览器
export async function createBrowser(): Promise<PlaywrightDriver> {
  const driver = new PlaywrightDriver();
  await driver.launch();
  return driver;
}

// 便捷函数：创建一个新页面
export async function createPage(
  driver: PlaywrightDriver,
): Promise<{ context: IBrowserContext; page: IPage }> {
  const context = await driver.newContext();
  const page = await context.newPage();
  return { context, page };
}
