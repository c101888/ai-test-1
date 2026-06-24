"use client";

import { useEffect, useState } from "react";
import {
  KeyRound,
  Globe,
  Cpu,
  Thermometer,
  Hash,
  Zap,
  Save,
  CheckCircle2,
  XCircle,
  Loader2,
  Sparkles,
  Info,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  LLM_PRESETS,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  type LLMProvider,
  type LLMConfig,
} from "@/lib/llm-config";

// 输入框样式：与项目接入页保持一致
const inputCls =
  "w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none transition-colors";

// 表单字段布局
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-start">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

// 测试结果状态
type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string; latency?: number }
  | { status: "error"; message: string };

// 保存结果状态
type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function SettingsPage() {
  // 表单状态
  const [provider, setProvider] = useState<LLMProvider>("custom");
  const [modelId, setModelId] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_MAX_TOKENS);

  const [loading, setLoading] = useState(true);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [clearing, setClearing] = useState(false);
  const [persisted, setPersisted] = useState(false);

  // 加载已保存配置
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/llm-config");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const config = data.config as LLMConfig | null;
        if (config) {
          setProvider(config.provider);
          setModelId(config.modelId);
          setApiUrl(config.apiUrl);
          setApiKey(config.apiKey); // 已脱敏
          setModelName(config.modelName);
          setTemperature(config.temperature);
          setMaxTokens(config.maxTokens);
        }
        // 标记是否已持久化保存
        setPersisted(Boolean(data.configured));
      } catch {
        // 加载失败时忽略，使用默认值
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 应用预设配置
  const applyPreset = (key: keyof typeof LLM_PRESETS) => {
    const preset = LLM_PRESETS[key];
    setProvider(preset.provider);
    setModelId(preset.modelId);
    setApiUrl(preset.apiUrl);
    setModelName(preset.modelName);
    // 预设不覆盖 apiKey，保留用户已输入的 Key
    setTestState({ status: "idle" });
    setSaveState({ status: "idle" });
  };

  // 测试连接
  const handleTest = async () => {
    if (!apiUrl.trim() || !apiKey.trim() || !modelId.trim()) {
      setTestState({
        status: "error",
        message: "请先填写 API 地址、API Key 和模型 ID",
      });
      return;
    }
    setTestState({ status: "testing" });
    try {
      const res = await fetch("/api/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          modelId: modelId.trim(),
          apiUrl: apiUrl.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
          temperature,
          maxTokens,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestState({
          status: "success",
          message: data.message ?? "连接成功",
          latency: data.latency,
        });
      } else {
        setTestState({
          status: "error",
          message: data.message ?? "连接失败",
        });
      }
    } catch (err) {
      setTestState({
        status: "error",
        message: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // 保存配置
  const handleSave = async () => {
    if (!modelId.trim()) {
      setSaveState({ status: "error", message: "模型 ID 不能为空" });
      return;
    }
    if (!apiUrl.trim()) {
      setSaveState({ status: "error", message: "API 地址不能为空" });
      return;
    }
    if (!apiKey.trim()) {
      setSaveState({ status: "error", message: "API Key 不能为空" });
      return;
    }
    setSaveState({ status: "saving" });
    try {
      const res = await fetch("/api/llm-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          modelId: modelId.trim(),
          apiUrl: apiUrl.trim(),
          apiKey: apiKey.trim(),
          modelName: modelName.trim(),
          temperature,
          maxTokens,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // 保存成功后，回填脱敏 Key（服务端返回脱敏值）
        if (data.config?.apiKey) {
          setApiKey(data.config.apiKey);
        }
        setPersisted(true);
        setSaveState({
          status: "success",
          message: "配置已加密保存到本地",
        });
      } else {
        setSaveState({
          status: "error",
          message: data.error ?? "保存失败",
        });
      }
    } catch (err) {
      setSaveState({
        status: "error",
        message: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  // 清除配置
  const handleClear = async () => {
    if (!confirm("确认清除已保存的 LLM 配置？此操作不可恢复。")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/llm-config", { method: "DELETE" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setProvider("custom");
        setModelId("");
        setApiUrl("");
        setApiKey("");
        setModelName("");
        setTemperature(DEFAULT_TEMPERATURE);
        setMaxTokens(DEFAULT_MAX_TOKENS);
        setPersisted(false);
        setTestState({ status: "idle" });
        setSaveState({ status: "idle" });
      }
    } catch {
      // 忽略
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader
          eyebrow="设置"
          title="LLM 配置"
          description="配置大语言模型 API，为智能分析与测试能力提供真实推理后端。"
        />
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-text-3" />
          <p className="mt-3 text-sm text-text-3">加载配置中…</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="设置"
        title="LLM 配置"
        description="配置大语言模型 API，为智能分析与测试能力提供真实推理后端。"
      />

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {/* 预设快捷按钮 */}
        <Panel
          title="预设模型"
          description="一键填充常用提供商的默认配置，仍需手动填写 API Key。"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyPreset("openai")}
            >
              <Sparkles className="h-3.5 w-3.5" />
              OpenAI
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyPreset("qwen")}
            >
              <Sparkles className="h-3.5 w-3.5" />
              通义千问
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => applyPreset("zhipu")}
            >
              <Sparkles className="h-3.5 w-3.5" />
              智谱GLM
            </Button>
          </div>
        </Panel>

        {/* 基本配置 */}
        <Panel
          title="模型配置"
          description="填写 API 地址、模型 ID 与密钥，所有调用均使用 OpenAI 兼容格式。"
          action={
            apiKey ? (
              <Badge severity="accent">
                <CheckCircle2 className="h-3 w-3" />
                已配置
              </Badge>
            ) : (
              <Badge severity="warning">未配置</Badge>
            )
          }
        >
          <div className="space-y-5">
            <Field label="提供商" hint="选择 API 提供商类型">
              <select
                className={inputCls}
                value={provider}
                onChange={(e) =>
                  setProvider(e.target.value as LLMProvider)
                }
              >
                <option value="openai">OpenAI 兼容</option>
                <option value="anthropic">Anthropic</option>
                <option value="custom">自定义</option>
              </select>
            </Field>

            <Field label="模型 ID" hint="调用时使用的模型标识">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  className={inputCls}
                  placeholder="gpt-4o"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                />
              </div>
            </Field>

            <Field
              label="API 地址"
              hint="可只填基础地址（如 .../api/v3），系统自动补全 /chat/completions"
            >
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  className={inputCls}
                  placeholder="https://api.openai.com/v1/chat/completions"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                />
              </div>
            </Field>

            <Field
              label="API Key"
              hint="前端显示时自动脱敏，仅保留前 4 位"
            >
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  type="password"
                  className={`${inputCls} font-mono`}
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </Field>

            <Field label="模型名称" hint="用于报告与界面展示">
              <input
                className={inputCls}
                placeholder="GPT-4o"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
            </Field>
          </div>
        </Panel>

        {/* 调用参数 */}
        <Panel
          title="调用参数"
          description="调整生成行为，分析类任务建议较低温度以保证稳定性。"
        >
          <div className="space-y-5">
            <Field
              label="温度"
              hint={`控制随机性，0 更确定，1 更发散（当前 ${temperature.toFixed(2)}）`}
            >
              <div className="flex items-center gap-3">
                <Thermometer className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) =>
                    setTemperature(parseFloat(e.target.value))
                  }
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
                />
                <span className="w-12 shrink-0 text-right font-mono text-xs text-text-2">
                  {temperature.toFixed(2)}
                </span>
              </div>
            </Field>

            <Field
              label="最大输出 Token"
              hint="单次响应的最大长度"
            >
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  type="number"
                  min={1}
                  step={256}
                  className={inputCls}
                  value={maxTokens}
                  onChange={(e) =>
                    setMaxTokens(
                      Math.max(1, parseInt(e.target.value, 10) || 0),
                    )
                  }
                />
              </div>
            </Field>
          </div>
        </Panel>

        {/* 测试与保存 */}
        <Panel
          title="连接测试与保存"
          description="保存前建议先测试连接，确保配置可用。"
        >
          <div className="space-y-4">
            {/* 持久化状态提示 */}
            {persisted && (
              <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-dim px-3 py-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <p className="text-xs leading-relaxed text-success">
                  配置已加密持久化保存到本地文件（.data/llm-config.json），刷新页面或重启服务端不会丢失。API Key 使用 AES-256-GCM 加密存储。
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTest}
                disabled={testState.status === "testing"}
              >
                {testState.status === "testing" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                测试连接
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveState.status === "saving"}
              >
                {saveState.status === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                保存配置
              </Button>
              {persisted && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={clearing}
                >
                  {clearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  清除配置
                </Button>
              )}
            </div>

            {/* 测试结果 */}
            {testState.status === "success" && (
              <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-dim px-3 py-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-accent">
                    连接成功
                    {typeof testState.latency === "number" && (
                      <span className="ml-2 font-mono text-text-3">
                        延迟 {testState.latency}ms
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-text-2">
                    {testState.message}
                  </p>
                </div>
              </div>
            )}

            {testState.status === "error" && (
              <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-dim px-3 py-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-critical">
                    连接失败
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-text-2">
                    {testState.message}
                  </p>
                </div>
              </div>
            )}

            {/* 保存结果 */}
            {saveState.status === "success" && (
              <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-dim px-3 py-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p className="text-xs leading-relaxed text-accent">
                  {saveState.message}
                </p>
              </div>
            )}

            {saveState.status === "error" && (
              <div className="flex items-start gap-2 rounded-md border border-critical/30 bg-critical-dim px-3 py-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
                <p className="text-xs leading-relaxed text-critical">
                  {saveState.message}
                </p>
              </div>
            )}
          </div>
        </Panel>

        {/* 配置说明 */}
        <Panel
          title="配置说明"
          description="支持 OpenAI 兼容格式的 API，包括国内外主流模型。"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="text-xs leading-relaxed text-text-2">
                <p>
                  本系统使用 OpenAI 兼容格式（
                  <code className="rounded bg-bg-2 px-1 py-0.5 font-mono text-text">
                    /v1/chat/completions
                  </code>
                  ）调用 LLM，大多数国内外模型均支持此格式。
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-text">API 地址示例</p>
              <div className="space-y-1.5 rounded-md border border-border-soft bg-bg-2 p-3 font-mono text-xs leading-relaxed text-text-2">
                <div>
                  <span className="text-text-3"># 可只填到版本号，自动补全后缀</span>
                </div>
                <div className="break-all text-accent">
                  https://ark.cn-beijing.volces.com/api/v3
                </div>
                <div className="mt-2">
                  <span className="text-text-3"># OpenAI</span>
                </div>
                <div className="break-all text-accent">
                  https://api.openai.com/v1/chat/completions
                </div>
                <div className="mt-2">
                  <span className="text-text-3"># 通义千问（阿里云）</span>
                </div>
                <div className="break-all text-accent">
                  https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
                </div>
                <div className="mt-2">
                  <span className="text-text-3"># 智谱 GLM</span>
                </div>
                <div className="break-all text-accent">
                  https://open.bigmodel.cn/api/paas/v4/chat/completions
                </div>
                <div className="mt-2">
                  <span className="text-text-3"># 月之暗面 Moonshot</span>
                </div>
                <div className="break-all text-accent">
                  https://api.moonshot.cn/v1/chat/completions
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-dim px-3 py-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="text-xs leading-relaxed text-accent">
                API Key 使用 AES-256-GCM 加密后保存到本地文件（.data/llm-config.json），不会写入日志或上报。配置在服务端进程重启后仍然可用，无需重新填写。
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
