// LLM 配置管理
// - 客户端：localStorage（兼容旧逻辑）
// - 服务端：globalThis 内存 + 文件持久化（.data/llm-config.json）
// - API Key 使用 AES-256-GCM 加密存储，防止泄露
// 注意：此模块同时被客户端和服务端使用，不能 import "server-only"
// 文件持久化和加密逻辑通过 typeof window 判断仅在服务端执行

// LLM 提供商类型
export type LLMProvider = "openai" | "anthropic" | "custom";

// LLM 配置接口
export interface LLMConfig {
  provider: LLMProvider;
  modelId: string;
  apiUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
}

// 存储键
const STORAGE_KEY = "test-center:llm-config";
const GLOBAL_KEY = "__llmConfig";

// 默认值
export const DEFAULT_TEMPERATURE = 0.3;
export const DEFAULT_MAX_TOKENS = 4096;

// 预设配置
export const LLM_PRESETS: Record<
  string,
  Pick<LLMConfig, "provider" | "modelId" | "apiUrl" | "modelName">
> = {
  openai: {
    provider: "openai",
    modelId: "gpt-4o",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    modelName: "GPT-4o",
  },
  qwen: {
    provider: "custom",
    modelId: "qwen-plus",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    modelName: "通义千问",
  },
  zhipu: {
    provider: "custom",
    modelId: "glm-4-plus",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    modelName: "智谱GLM-4-Plus",
  },
};

// ============================================================
// 服务端文件持久化 + Key 加密（仅服务端可用）
// ============================================================

// 动态导入 Node.js 模块（避免客户端构建时引入）
// 使用 eval("require") 避免 Turbopack/Webpack 静态分析
// 这些函数仅在服务端调用（通过 typeof window 判断）
let _fs: typeof import("fs") | null = null;
let _path: typeof import("path") | null = null;
let _crypto: typeof import("crypto") | null = null;
let _os: typeof import("os") | null = null;
let _dynamicRequire: NodeRequire | null = null;

function getDynamicRequire(): NodeRequire {
  if (_dynamicRequire) return _dynamicRequire;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  _dynamicRequire = eval("require") as NodeRequire;
  return _dynamicRequire;
}

async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) _fs = getDynamicRequire()("fs");
  return _fs!;
}
async function getPath(): Promise<typeof import("path")> {
  if (!_path) _path = getDynamicRequire()("path");
  return _path!;
}
async function getCrypto(): Promise<typeof import("crypto")> {
  if (!_crypto) _crypto = getDynamicRequire()("crypto");
  return _crypto!;
}
async function getOs(): Promise<typeof import("os")> {
  if (!_os) _os = getDynamicRequire()("os");
  return _os!;
}

// 配置文件路径
async function getConfigFilePath(): Promise<string> {
  const path = await getPath();
  return path.join(process.cwd(), ".data", "llm-config.json");
}

// 机器特征密钥（同一机器稳定，不同机器不同）
let _machineKey: Buffer | null = null;
async function getMachineKey(): Promise<Buffer> {
  if (_machineKey) return _machineKey;
  const crypto = await getCrypto();
  const os = await getOs();
  const interfaces = os.networkInterfaces();
  let mac = "default-mac";
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface && !iface.internal && iface.mac !== "00:00:00:00:00:00") {
        mac = iface.mac;
        break;
      }
    }
    if (mac !== "default-mac") break;
  }
  const userHome = os.homedir();
  _machineKey = crypto.scryptSync(`${mac}-${userHome}`, "test-center-salt", 32);
  return _machineKey;
}

// 加密 API Key
async function encryptApiKey(
  apiKey: string,
): Promise<{ enc: string; iv: string; tag: string }> {
  const crypto = await getCrypto();
  const key = await getMachineKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    enc: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

// 解密 API Key
async function decryptApiKey(
  enc: string,
  iv: string,
  tag: string,
): Promise<string> {
  const crypto = await getCrypto();
  const key = await getMachineKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(enc, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// 持久化配置到文件（服务端）
async function saveConfigToFile(config: LLMConfig): Promise<void> {
  try {
    const fs = await getFs();
    const path = await getPath();
    const configPath = await getConfigFilePath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const { apiKey, ...rest } = config;
    const { enc, iv, tag } = await encryptApiKey(apiKey);
    const data = {
      ...rest,
      apiKeyEnc: enc,
      apiKeyIv: iv,
      apiKeyTag: tag,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("保存 LLM 配置到文件失败:", err);
  }
}

// 从文件读取配置（服务端）
async function loadConfigFromFile(): Promise<LLMConfig | null> {
  try {
    const fs = await getFs();
    const configPath = await getConfigFilePath();
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf8");
    const data = JSON.parse(raw);
    if (!data.apiKeyEnc) return null;
    const apiKey = await decryptApiKey(
      data.apiKeyEnc,
      data.apiKeyIv,
      data.apiKeyTag,
    );
    return {
      provider: data.provider,
      modelId: data.modelId,
      apiUrl: data.apiUrl,
      apiKey,
      modelName: data.modelName,
      temperature: data.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: data.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  } catch (err) {
    console.error("从文件读取 LLM 配置失败:", err);
    return null;
  }
}

// 删除配置文件（服务端）
async function deleteConfigFile(): Promise<void> {
  try {
    const fs = await getFs();
    const configPath = await getConfigFilePath();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } catch (err) {
    console.error("删除 LLM 配置文件失败:", err);
  }
}

// ============================================================
// 配置读写主函数
// ============================================================

// 同步版本（兼容旧代码，仅读内存）
export function getLLMConfig(): LLMConfig | null {
  if (typeof window !== "undefined") {
    // 客户端：从 localStorage 读取
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw) as LLMConfig;
      }
    } catch {
      // 解析失败时忽略
    }
    return null;
  }
  // 服务端：从 globalThis 读取（内存缓存）
  const g = globalThis as unknown as { __llmConfig?: LLMConfig };
  return g.__llmConfig ?? null;
}

// 异步版本（服务端优先读内存，其次读文件）
export async function getLLMConfigAsync(): Promise<LLMConfig | null> {
  if (typeof window !== "undefined") {
    return getLLMConfig();
  }
  // 服务端：优先读内存
  const g = globalThis as unknown as { __llmConfig?: LLMConfig };
  if (g.__llmConfig) return g.__llmConfig;
  // 其次读文件
  const fileConfig = await loadConfigFromFile();
  if (fileConfig) {
    // 回填内存缓存
    g.__llmConfig = fileConfig;
    return fileConfig;
  }
  return null;
}

// 同步保存（客户端写 localStorage，服务端写内存）
export function setLLMConfig(config: LLMConfig): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // 写入失败时忽略
    }
    return;
  }
  // 服务端：写内存
  const g = globalThis as unknown as { __llmConfig?: LLMConfig };
  g.__llmConfig = config;
}

// 异步保存（服务端同时写内存和文件）
export async function setLLMConfigAsync(config: LLMConfig): Promise<void> {
  if (typeof window !== "undefined") {
    setLLMConfig(config);
    return;
  }
  // 服务端：写内存 + 写文件
  const g = globalThis as unknown as { __llmConfig?: LLMConfig };
  g.__llmConfig = config;
  await saveConfigToFile(config);
}

// 清除配置
export async function clearLLMConfig(): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 忽略
    }
    return;
  }
  // 服务端：清内存 + 删文件
  const g = globalThis as unknown as { __llmConfig?: LLMConfig };
  g.__llmConfig = undefined;
  await deleteConfigFile();
}

// 是否已配置（同步版本，仅检查内存）
export function isLLMConfigured(): boolean {
  const config = getLLMConfig();
  if (!config) return false;
  return Boolean(
    config.apiUrl.trim() &&
      config.apiKey.trim() &&
      config.modelId.trim(),
  );
}

// 是否已配置（异步版本，检查内存+文件）
export async function isLLMConfiguredAsync(): Promise<boolean> {
  const config = await getLLMConfigAsync();
  if (!config) return false;
  return Boolean(
    config.apiUrl.trim() &&
      config.apiKey.trim() &&
      config.modelId.trim(),
  );
}

// 获取配置但 Key 脱敏（用于前端显示）
export function getLLMConfigSafe(): LLMConfig | null {
  const config = getLLMConfig();
  if (!config) return null;
  return {
    ...config,
    apiKey: maskApiKey(config.apiKey),
  };
}

// 异步版本（服务端从文件读取真实配置后脱敏）
export async function getLLMConfigSafeAsync(): Promise<LLMConfig | null> {
  const config = await getLLMConfigAsync();
  if (!config) return null;
  return {
    ...config,
    apiKey: maskApiKey(config.apiKey),
  };
}

// API Key 脱敏：前 4 位 + ****
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 4) return "****";
  return `${key.slice(0, 4)}****`;
}
