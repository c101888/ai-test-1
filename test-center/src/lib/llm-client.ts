// LLM 调用客户端：基于 OpenAI 兼容格式（/v1/chat/completions）
// 大多数国内外模型（OpenAI / 通义千问 / 智谱 / 月之暗面等）均兼容此格式
// 使用 Node.js 原生 fetch（Next.js 16 支持）

import {
  getLLMConfig,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  type LLMConfig,
} from "./llm-config";

// LLM 消息接口（OpenAI 兼容格式）
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// 调用选项
export interface LLMCallOptions {
  temperature?: number; // 温度，覆盖配置默认值
  maxTokens?: number; // 最大输出 token，覆盖配置默认值
  timeout?: number; // 超时毫秒，默认 60000
  retries?: number; // 网络错误重试次数，默认 1
}

// 默认超时：60 秒
const DEFAULT_TIMEOUT = 60000;
// 分析类调用建议超时：120 秒
export const ANALYSIS_TIMEOUT = 120000;

// 自定义错误类型，便于上层区分处理
export class LLMError extends Error {
  code: "network" | "auth" | "quota" | "timeout" | "server" | "config" | "parse";
  status?: number;
  constructor(
    code: LLMError["code"],
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.status = status;
  }
}

// 规范化 API URL：自动补全 /chat/completions 后缀
// 用户可能填写基础 URL（如 https://ark.cn-beijing.volces.com/api/v3），
// 而实际请求需要完整的 endpoint（.../chat/completions）
export function normalizeApiUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  // 已包含 /chat/completions，直接返回
  if (/\/chat\/completions\/?$/i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  // 移除末尾斜杠
  let base = trimmed.replace(/\/+$/, "");
  // 如果以 /v1 /v2 /v3 /v4 等版本号结尾，直接补全 /chat/completions
  if (/\/v\d+$/i.test(base)) {
    return `${base}/chat/completions`;
  }
  // 其他情况补全 /v1/chat/completions（OpenAI 默认格式）
  return `${base}/v1/chat/completions`;
}

// 单次请求：构造请求体并发送，处理 HTTP 错误
async function singleRequest(
  config: LLMConfig,
  messages: LLMMessage[],
  options: LLMCallOptions,
  signal: AbortSignal,
): Promise<string> {
  const body = {
    model: config.modelId,
    messages,
    temperature: options.temperature ?? config.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.maxTokens ?? config.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  // 规范化 API URL
  const apiUrl = normalizeApiUrl(config.apiUrl);

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    // 区分超时与网络错误
    if (err instanceof Error && err.name === "AbortError") {
      throw new LLMError("timeout", "请求超时，请检查网络或增大超时时间");
    }
    throw new LLMError(
      "network",
      `网络错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 非 2xx 响应处理
  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      detail =
        (errBody?.error?.message as string) ||
        (errBody?.message as string) ||
        JSON.stringify(errBody);
    } catch {
      try {
        detail = await res.text();
      } catch {
        // 忽略读取失败
      }
    }
    switch (res.status) {
      case 401:
        throw new LLMError("auth", `API Key 无效：${detail}`, 401);
      case 429:
        throw new LLMError("quota", `配额超限或请求过于频繁：${detail}`, 429);
      default:
        if (res.status >= 500) {
          throw new LLMError(
            "server",
            `服务端错误（${res.status}）：${detail}`,
            res.status,
          );
        }
        throw new LLMError(
          "server",
          `请求失败（${res.status}）：${detail}`,
          res.status,
        );
    }
  }

  // 解析响应：OpenAI 兼容格式 choices[0].message.content
  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    throw new LLMError(
      "parse",
      `响应解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const content: string | undefined =
    data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text;
  if (!content) {
    throw new LLMError(
      "parse",
      `响应格式异常，未找到 choices[0].message.content：${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return content;
}

// 主函数：调用 LLM 并返回响应文本
// 网络错误自动重试 1 次（默认），其他错误直接抛出
export async function chatCompletion(
  messages: LLMMessage[],
  options?: LLMCallOptions,
): Promise<string> {
  const config = getLLMConfig();
  if (!config) {
    throw new LLMError("config", "未配置 LLM，请先在设置页配置");
  }
  return chatCompletionWithConfig(config, messages, options);
}

// 使用指定配置调用（供 testLLMConnection 等场景使用）
export async function chatCompletionWithConfig(
  config: LLMConfig,
  messages: LLMMessage[],
  options?: LLMCallOptions,
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const retries = options?.retries ?? 1;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // 每次重试使用独立的 AbortController
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const result = await singleRequest(
        config,
        messages,
        options ?? {},
        controller.signal,
      );
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      // 仅网络错误重试；超时 / 鉴权 / 配额 / 解析错误不重试
      if (err instanceof LLMError && err.code === "network" && attempt < retries) {
        continue;
      }
      throw err;
    }
  }
  // 理论不可达，兜底抛出最后一次错误
  throw lastErr instanceof Error
    ? lastErr
    : new LLMError("network", "未知错误");
}

// 要求 JSON 输出并解析
// 在 system prompt 中追加 JSON 输出要求，解析时提取 JSON 部分（处理 markdown 代码块包裹）
export async function chatCompletionJSON<T = any>(
  messages: LLMMessage[],
  options?: LLMCallOptions,
): Promise<T> {
  const config = getLLMConfig();
  if (!config) {
    throw new LLMError("config", "未配置 LLM，请先在设置页配置");
  }
  return chatCompletionJSONWithConfig<T>(config, messages, options);
}

// 使用指定配置调用并要求 JSON 输出
export async function chatCompletionJSONWithConfig<T = any>(
  config: LLMConfig,
  messages: LLMMessage[],
  options?: LLMCallOptions,
): Promise<T> {
  // 在首条 system 消息中追加 JSON 输出要求；若无 system 消息则前置一条
  const augmented: LLMMessage[] = [...messages];
  const jsonInstruction =
    "请严格输出合法 JSON（不要包含任何解释性文字，不要使用 markdown 代码块包裹）。";
  if (augmented.length > 0 && augmented[0].role === "system") {
    augmented[0] = {
      ...augmented[0],
      content: `${augmented[0].content}\n\n${jsonInstruction}`,
    };
  } else {
    augmented.unshift({ role: "system", content: jsonInstruction });
  }

  const raw = await chatCompletionWithConfig(config, augmented, options);
  return parseJSONResponse<T>(raw);
}

// 解析 LLM 返回的 JSON：处理 markdown 代码块包裹、多余文本、截断
export function parseJSONResponse<T = any>(raw: string): T {
  if (!raw || typeof raw !== "string") {
    throw new LLMError("parse", "响应为空，无法解析为 JSON");
  }
  let text = raw.trim();

  // 处理 markdown 代码块包裹：```json ... ``` 或 ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // 尝试直接解析
  try {
    return JSON.parse(text) as T;
  } catch {
    // 忽略，继续尝试提取
  }

  // 提取首个 { 或 [ 到最后一个 } 或 ] 的内容
  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");

  let candidate = "";
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    candidate = text.slice(firstObj, lastObj + 1);
  }
  if (
    firstArr !== -1 &&
    lastArr !== -1 &&
    lastArr > firstArr &&
    (firstObj === -1 || firstArr < firstObj)
  ) {
    candidate = text.slice(firstArr, lastArr + 1);
  }

  if (candidate) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 直接解析失败，尝试修复截断的 JSON
    }

    // 尝试修复截断的 JSON：补全缺失的闭合括号
    const repaired = repairTruncatedJSON(candidate);
    if (repaired !== candidate) {
      try {
        return JSON.parse(repaired) as T;
      } catch (err) {
        throw new LLMError(
          "parse",
          `JSON 解析失败（已尝试修复截断）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 最后尝试：从首个 { 或 [ 开始到末尾，按截断处理
  const start = firstObj !== -1 ? firstObj : firstArr;
  if (start !== -1) {
    const tail = text.slice(start);
    const repaired = repairTruncatedJSON(tail);
    try {
      return JSON.parse(repaired) as T;
    } catch (err) {
      throw new LLMError(
        "parse",
        `JSON 解析失败（响应可能被 maxTokens 截断）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new LLMError(
    "parse",
    `无法从响应中提取 JSON，原始内容：${raw.slice(0, 200)}`,
  );
}

// 修复被截断的 JSON：补全缺失的闭合括号与引号
// 当 LLM 输出因 maxTokens 不足被截断时，JSON 可能不完整
function repairTruncatedJSON(text: string): string {
  let s = text;

  // 如果末尾在字符串中间被截断，补上闭合引号
  // 统计未闭合的字符串引号数量（简化处理：只看是否在字符串内）
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
    }
  }
  // 如果仍在字符串内，补上闭合引号
  if (inString) {
    s += '"';
  }

  // 移除末尾可能的不完整片段（如逗号、冒号后无值）
  // 从末尾向前找到最后一个完整的结构
  s = s.replace(/[,\s]+$/, "");

  // 统计未闭合的括号
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}") {
      if (stack[stack.length - 1] === "{") stack.pop();
    } else if (ch === "]") {
      if (stack[stack.length - 1] === "[") stack.pop();
    }
  }

  // 按栈逆序补全闭合括号
  while (stack.length > 0) {
    const open = stack.pop();
    s += open === "{" ? "}" : "]";
  }

  return s;
}

// 测试连接：发送简单消息"你好"，检查是否返回
export async function testLLMConnection(
  config: LLMConfig,
): Promise<{ success: boolean; message: string; latency?: number }> {
  const start = Date.now();
  try {
    const reply = await chatCompletionWithConfig(
      config,
      [{ role: "user", content: "你好" }],
      {
        timeout: 30000, // 测试连接使用较短超时
        retries: 0, // 测试不重试
        maxTokens: 64, // 测试仅需少量 token
      },
    );
    const latency = Date.now() - start;
    if (!reply || !reply.trim()) {
      return {
        success: false,
        message: "连接成功但返回空响应，请检查模型 ID 是否正确",
        latency,
      };
    }
    return {
      success: true,
      message: `连接成功，模型响应：${reply.trim().slice(0, 50)}`,
      latency,
    };
  } catch (err) {
    const latency = Date.now() - start;
    if (err instanceof LLMError) {
      // 友好的中文错误信息
      const msgMap: Record<LLMError["code"], string> = {
        network: `网络错误：${err.message}`,
        auth: "API Key 无效或未授权，请检查 Key 是否正确",
        quota: "配额超限或请求过于频繁，请稍后重试或检查额度",
        timeout: "请求超时，请检查网络或 API 地址是否可达",
        server: `服务端错误：${err.message}`,
        config: `配置缺失：${err.message}`,
        parse: `响应解析失败：${err.message}`,
      };
      return {
        success: false,
        message: msgMap[err.code] ?? err.message,
        latency,
      };
    }
    return {
      success: false,
      message: `未知错误：${err instanceof Error ? err.message : String(err)}`,
      latency,
    };
  }
}
