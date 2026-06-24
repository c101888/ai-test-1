// API 请求驱动
// 用于高效执行 API 请求（如连续签到 100 次），比 Playwright 点击快 100 倍
// 仅在服务端使用

import "server-only";
import type { IApiDriver, ApiRequestOptions, ApiResponse } from "./types";
import type { RequestFormat } from "../api-contract";

export class ApiDriver implements IApiDriver {
  private baseUrl: string;
  private authToken: string | null = null;
  private defaultHeaders: Record<string, string>;
  // Cookie 认证模式：存储 cookie 字符串
  private cookieJar: string | null = null;

  constructor(baseUrl: string, defaultHeaders: Record<string, string> = {}) {
    // 去除末尾斜杠
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...defaultHeaders,
    };
  }

  setAuth(token: string): void {
    this.authToken = token;
  }

  clearAuth(): void {
    this.authToken = null;
    this.cookieJar = null;
  }

  // 设置 cookie（用于 cookie 认证模式）
  setCookie(cookie: string): void {
    this.cookieJar = cookie;
    this.authToken = null; // cookie 与 bearer 互斥
  }

  // 获取当前 cookie
  getCookie(): string | null {
    return this.cookieJar;
  }

  private buildHeaders(options?: ApiRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options?.headers,
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    if (this.cookieJar) {
      headers["Cookie"] = this.cookieJar;
    }
    return headers;
  }

  private buildUrl(url: string): string {
    // 如果是完整 URL 直接返回，否则拼接 baseUrl
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  // 根据请求格式构建 body 和 Content-Type
  private buildBody(
    data: Record<string, unknown> | undefined,
    format: RequestFormat = "json",
  ): { body: string | FormData | undefined; contentType: string } {
    if (!data) return { body: undefined, contentType: "application/json" };

    if (format === "formdata") {
      // FormData 模式：构建 multipart/form-data
      const formData = new FormData();
      for (const [key, value] of Object.entries(data)) {
        formData.append(key, String(value));
      }
      // FormData 不需要设置 Content-Type，浏览器/fetch 会自动设置 boundary
      return { body: formData, contentType: "" };
    }

    if (format === "urlencoded") {
      // URL-encoded 模式
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(data)) {
        params.append(key, String(value));
      }
      return {
        body: params.toString(),
        contentType: "application/x-www-form-urlencoded",
      };
    }

    // JSON 模式（默认）
    return { body: JSON.stringify(data), contentType: "application/json" };
  }

  // 按指定格式发送请求（支持 json/formdata/urlencoded）
  async requestWithFormat(
    method: string,
    url: string,
    data: Record<string, unknown> | undefined,
    format: RequestFormat = "json",
    options?: ApiRequestOptions,
  ): Promise<ApiResponse> {
    const fullUrl = this.buildUrl(url);
    const { body, contentType } = this.buildBody(data, format);

    // 构建请求头：FormData 模式不设置 Content-Type（让 fetch 自动设置 boundary）
    const headers = this.buildHeaders(options);
    if (format === "formdata") {
      // 删除默认的 Content-Type，让 fetch 自动设置 multipart boundary
      delete headers["Content-Type"];
    } else if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const startMs = Date.now();
    let response: Response;
    try {
      // FormData 模式：使用 follow 跟随重定向（manual 模式在 Next.js 中会返回 500）
      //   - 通过最终 URL 判断成功/失败（含 error 参数 = 失败）
      // JSON 模式：使用 manual 保留 303 响应和 Set-Cookie 头
      response = await fetch(fullUrl, {
        method: method.toUpperCase(),
        headers,
        body,
        redirect: format === "formdata" ? "follow" : "manual",
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      throw new Error(
        `API 请求失败: ${method.toUpperCase()} ${url} - ${err instanceof Error ? err.message : String(err)} (${durationMs}ms)`,
      );
    }

    return this.parseResponse(response, url, method, startMs);
  }

  // 解析响应（提取为公共方法）
  private async parseResponse(
    response: Response,
    url: string,
    method: string,
    startMs: number,
  ): Promise<ApiResponse> {
    const durationMs = Date.now() - startMs;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // 提取 Set-Cookie（用于 cookie 认证模式）
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      responseHeaders["set-cookie"] = setCookie;
    }

    let responseBody: unknown = undefined;
    const contentType = responseHeaders["content-type"] || "";
    if (contentType.includes("application/json")) {
      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }
    } else {
      try {
        responseBody = await response.text();
      } catch {
        // 忽略
      }
    }

    // 判断 ok：200-299 或 303 重定向（表单提交成功）
    const isRedirect = response.status >= 300 && response.status < 400;
    const ok = response.ok || isRedirect;

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: responseBody,
      durationMs,
      ok,
      url: response.url || undefined, // 最终 URL（follow 模式下可能不同于请求 URL）
    };
  }

  async request(
    method: string,
    url: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse> {
    const fullUrl = this.buildUrl(url);
    const headers = this.buildHeaders(options);
    const body =
      options?.body !== undefined ? JSON.stringify(options.body) : undefined;

    const startMs = Date.now();
    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method: method.toUpperCase(),
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      throw new Error(
        `API 请求失败: ${method.toUpperCase()} ${url} - ${err instanceof Error ? err.message : String(err)} (${durationMs}ms)`,
      );
    }

    return this.parseResponse(response, url, method, startMs);
  }

  async get(url: string, options?: ApiRequestOptions): Promise<ApiResponse> {
    return this.request("GET", url, options);
  }

  async post(
    url: string,
    body?: unknown,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse> {
    return this.request("POST", url, { ...options, body });
  }

  // 便捷函数：登录并保存 token 或 cookie
  // 根据契约自动选择认证方式和请求格式
  async loginWithContract(
    loginUrl: string,
    credentials: { username: string; password: string },
    contract: {
      requestFormat?: RequestFormat;
      fields?: Record<string, string>;
      authScheme?: string;
      tokenField?: string;
      successStatus?: number[];
      successRedirect?: string;
    },
  ): Promise<{ success: boolean; token?: string; cookie?: string; error?: string }> {
    const format = contract.requestFormat || "json";
    const fields = contract.fields || { username: "username", password: "password" };

    // 构建请求体：按契约的字段名映射
    const data: Record<string, unknown> = {
      [fields.username]: credentials.username,
      [fields.password]: credentials.password,
    };

    const response = await this.requestWithFormat(
      "POST",
      loginUrl,
      data,
      format,
    );

    // 判断成功：状态码匹配 或 重定向到成功路径
    const successStatuses = contract.successStatus || [200];
    const isSuccess = successStatuses.includes(response.status);

    if (!isSuccess) {
      return {
        success: false,
        error: `登录失败: ${response.status} ${JSON.stringify(response.body).slice(0, 100)}`,
      };
    }

    // 提取认证信息
    if (contract.authScheme === "cookie") {
      // Cookie 模式：从 Set-Cookie 提取
      const setCookie = response.headers["set-cookie"];
      if (setCookie) {
        // 提取 cookie 名=值 部分
        const cookiePart = setCookie.split(";")[0];
        this.setCookie(cookiePart);
        return { success: true, cookie: cookiePart };
      }
      return { success: false, error: "登录成功但未返回 Cookie" };
    }

    // Bearer 模式：从响应体提取 token
    const tokenField = contract.tokenField || "token";
    const body = response.body as Record<string, unknown> | null;
    const token = body?.[tokenField] as string | undefined;
    if (token) {
      this.setAuth(token);
      return { success: true, token };
    }

    return { success: false, error: "登录成功但未返回 token" };
  }
}

// 便捷函数：批量执行请求（用于签到 100 次等场景）
export async function batchRequests(
  driver: IApiDriver,
  method: string,
  url: string,
  count: number,
  options?: ApiRequestOptions,
  onProgress?: (current: number, response: ApiResponse) => void,
): Promise<ApiResponse[]> {
  const results: ApiResponse[] = [];
  for (let i = 0; i < count; i++) {
    const response = await driver.request(method, url, options);
    results.push(response);
    onProgress?.(i + 1, response);
  }
  return results;
}

// 便捷函数：并发执行请求（用于双击测试等场景）
export async function concurrentRequests(
  driver: IApiDriver,
  method: string,
  url: string,
  count: number,
  options?: ApiRequestOptions,
): Promise<ApiResponse[]> {
  const promises: Promise<ApiResponse>[] = [];
  for (let i = 0; i < count; i++) {
    promises.push(driver.request(method, url, options));
  }
  return Promise.all(promises);
}
