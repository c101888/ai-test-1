// 测试执行器类型定义
// 定义真实执行模式下的统一接口和证据类型

import type { Evidence } from "../store";

// 执行步骤记录（用于高级测试路径）
export interface ExecutionStep {
  index: number;
  action: string;
  screenshotDesc?: string;
  consoleLog?: string;
  networkRequest?: string;
  apiResponse?: string;
  dataChange?: string;
  stateBefore?: string;
  stateAfter?: string;
}

// Playwright 驱动接口（预留扩展，未来可替换为 Puppeteer/Cypress）
export interface IBrowserDriver {
  launch(): Promise<void>;
  newContext(): Promise<IBrowserContext>;
  close(): Promise<void>;
}

export interface IBrowserContext {
  newPage(): Promise<IPage>;
  close(): Promise<void>;
}

export interface IPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: "load" | "domcontentloaded" | "networkidle" }): Promise<void>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  text(selector: string, options?: { timeout?: number }): Promise<string>;
  isVisible(selector: string, options?: { timeout?: number }): Promise<boolean>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle", options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(fn: () => unknown): Promise<unknown>;
  evaluate<T>(fn: (arg: T) => unknown, arg: T): Promise<unknown>;
  screenshot(): Promise<string>; // 返回 base64
  reload(): Promise<void>;
  url(): string;
  close(): Promise<void>;
  clearCookies(): Promise<void>; // 清除浏览器上下文的 cookie
  getCookies(): Promise<Array<{ name: string; value: string; domain: string; path: string }>>; // 获取浏览器 cookie
  getConsoleLogs(): string[];
  getNetworkRequests(): NetworkRequest[];
}

// API 驱动接口
export interface IApiDriver {
  request(
    method: string,
    url: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse>;
  setAuth(token: string): void;
  clearAuth(): void;
  setCookie(cookie: string): void; // 设置 cookie（用于 cookie 认证模式）
  get(url: string, options?: ApiRequestOptions): Promise<ApiResponse>;
  post(url: string, body?: unknown, options?: ApiRequestOptions): Promise<ApiResponse>;
  // 按指定格式发送请求（支持 json/formdata/urlencoded）
  requestWithFormat(
    method: string,
    url: string,
    data: Record<string, unknown> | undefined,
    format: "json" | "formdata" | "urlencoded",
    options?: ApiRequestOptions,
  ): Promise<ApiResponse>;
}

export interface ApiRequestOptions {
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  ok: boolean;
  url?: string; // 最终 URL（redirect:follow 模式下可能不同于请求 URL）
}

export interface NetworkRequest {
  method: string;
  url: string;
  status: number;
  method_text: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  durationMs?: number;
}

// DB 驱动接口（只读）
export interface IDbReader {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  count(table: string, whereClause?: string, whereParams?: unknown[]): Promise<number>;
  close(): Promise<void>;
}

// 执行器统一接口
export interface ITestExecutor {
  browser?: IPage;
  api: IApiDriver;
  db?: IDbReader;
  baseUrl: string;
  collectEvidence(): Promise<Evidence[]>;
  close(): Promise<void>;
}

// 执行上下文
export interface ExecutionContext {
  projectId: string;
  baseUrl: string;
  testAccount?: { username: string; password: string };
  dbPath?: string;
  authToken?: string;
}

// 执行结果
export interface StepResult {
  success: boolean;
  message: string;
  evidences: Evidence[];
  data?: Record<string, unknown>;
}
