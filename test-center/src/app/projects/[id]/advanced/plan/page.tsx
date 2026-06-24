"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  PlayCircle,
  ShieldCheck,
  AlertCircle,
  Target,
  GitBranch,
  Route,
  Sparkles,
  Settings,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  AIThinkingPanel,
  type AIThinkingLog,
} from "@/components/ui/AIThinkingPanel";
import {
  type AdvancedTestModel,
  type TestItemSource,
  testItemSourceLabels,
  testItemSourceSeverity,
  ruleSourceLabels,
  ruleSourceSeverity,
  confidenceLabels,
  confidenceSeverity,
  pathTypeLabels,
  pathTypeSeverity,
} from "@/lib/advanced-test-model";

// 来源徽章配置
const sourceBadgeConfig: Record<
  "ai_generated" | "preset_only" | "preset_fallback",
  { label: string; severity: "accent" | "info" | "warning"; icon: typeof Sparkles }
> = {
  ai_generated: { label: "AI 动态生成", severity: "accent", icon: Sparkles },
  preset_only: { label: "预设规则（未配置 AI）", severity: "info", icon: AlertCircle },
  preset_fallback: { label: "预设规则（AI 生成失败）", severity: "warning", icon: AlertCircle },
};

// API 返回结构
interface AdvancedModelResponse {
  model: AdvancedTestModel;
  source: "ai_generated" | "preset_only" | "preset_fallback";
  sourceNote: string;
  pathSources: Record<string, TestItemSource>;
}

export default function AdvancedPlanPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdvancedModelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // AI 思考过程日志
  const [aiLogs, setAiLogs] = useState<AIThinkingLog[]>([]);
  const lastLogIdRef = useRef<string | null>(null);

  // 轮询 AI 思考日志（会话模式，loading 期间）
  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let knownSessionId: string | null = null;

    const poll = async () => {
      try {
        const url = new URL(
          `/api/projects/${projectId}/ai-thinking`,
          window.location.origin,
        );
        url.searchParams.set("page", "advanced-plan");
        if (lastLogIdRef.current) {
          url.searchParams.set("afterId", lastLogIdRef.current);
        }
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const json = await res.json();
        const serverSessionId: string | null = json.sessionId ?? null;

        // 检测会话变化：服务端开启了新会话（重新生成），清空旧日志重新加载
        if (knownSessionId !== null && serverSessionId !== null && knownSessionId !== serverSessionId) {
          setAiLogs([]);
          lastLogIdRef.current = null;
          knownSessionId = serverSessionId;
          const reloadUrl = new URL(
            `/api/projects/${projectId}/ai-thinking`,
            window.location.origin,
          );
          reloadUrl.searchParams.set("page", "advanced-plan");
          const reloadRes = await fetch(reloadUrl.toString());
          if (reloadRes.ok) {
            const reloadData = await reloadRes.json();
            const reloadLogs: AIThinkingLog[] = reloadData.logs || [];
            if (reloadLogs.length > 0 && !cancelled) {
              setAiLogs(reloadLogs);
              lastLogIdRef.current = reloadData.lastId ?? reloadLogs[reloadLogs.length - 1].id;
            }
          }
        } else {
          knownSessionId = serverSessionId;
          const newLogs: AIThinkingLog[] = json.logs || [];
          if (newLogs.length > 0 && !cancelled) {
            setAiLogs((prev) => [...prev, ...newLogs]);
            lastLogIdRef.current = json.lastId ?? newLogs[newLogs.length - 1].id;
          }
        }
      } catch {
        // 忽略错误
      }
      if (!cancelled) {
        timer = setTimeout(poll, 1500);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, loading]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMounted(true);
      setLoading(true);
      try {
        // 调用异步 API（AI 动态生成；AI 不可用时降级到预设规则匹配）
        const res = await fetch(`/api/projects/${projectId}/advanced-model`);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as AdvancedModelResponse;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!mounted || loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="py-12 text-center text-sm text-text-3">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
          <p className="mt-2">AI 正在根据项目业务功能生成测试清单…</p>
          <p className="mt-1 text-xs text-text-3">（首次生成可能需要 10-30 秒）</p>
        </div>
        {/* AI 思考过程窗口 */}
        <AIThinkingPanel
          logs={aiLogs}
          loading={true}
          title="AI 思考过程"
          emptyText="AI 正在准备生成测试清单，思考过程即将显示…"
        />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12">
        <Panel title="加载失败">
          <div className="px-5 py-4">
            <p className="text-sm text-warning">{error || "未知错误"}</p>
            <Button
              className="mt-3"
              size="sm"
              onClick={() => window.location.reload()}
            >
              重试
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const model = data.model;
  const sourceConfig = sourceBadgeConfig[data.source];
  const SourceIcon = sourceConfig.icon;

  // 统计
  const totalRules = model.rules.length;
  const totalInvariants = model.invariants.length;
  const totalPaths = model.paths.length;
  const normalPaths = model.paths.filter((p) => p.type === "normal").length;
  const abnormalPaths = model.paths.filter((p) => p.type === "abnormal").length;
  const crossFunctionPaths = model.paths.filter(
    (p) => p.type === "cross_function",
  ).length;
  const totalBugs = model.seededBugs.length;
  const bugsInBasic = model.seededBugs.filter((b) => b.detectedInBasic).length;
  const bugsInAdvanced = totalBugs - bugsInBasic;

  // AI 生成项数量统计
  const aiPathCount = Object.values(data.pathSources).filter((s) => s === "ai").length;

  return (
    <>
      <PageHeader
        eyebrow="高级业务测试 · 计划"
        title="高级业务测试计划"
        description={`AI 根据项目业务功能动态生成业务 bug 测试清单。项目标识：${projectId}`}
        action={
          <Button href={`/projects/${projectId}/advanced/run`} size="sm">
            <PlayCircle className="h-4 w-4" />
            开始高级业务测试
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* AI 思考过程窗口（位于顶部确保可见，展示生成测试清单时的思考日志） */}
        <AIThinkingPanel
          logs={aiLogs}
          loading={false}
          title="AI 思考过程"
          emptyText="本次未记录 AI 思考日志（可能使用缓存结果）。"
        />

        {/* 来源徽章 + 说明 */}
        <Panel bodyClassName="flex items-start gap-3 px-5 py-4">
          <SourceIcon className={`mt-0.5 h-5 w-5 ${
            data.source === "ai_generated" ? "text-accent" :
            data.source === "preset_fallback" ? "text-warning" : "text-text-2"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge severity={sourceConfig.severity}>
                {sourceConfig.label}
              </Badge>
              {data.source === "ai_generated" && (
                <span className="text-xs text-text-2">
                  AI 动态生成 {aiPathCount} 项
                </span>
              )}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-text-2">
              {data.sourceNote}
            </p>
            {(data.source === "preset_only" || data.source === "preset_fallback") && (
              <Button
                href="/settings"
                size="sm"
                variant="ghost"
                className="mt-2"
              >
                <Settings className="h-3.5 w-3.5" />
                配置 AI 获得动态生成
              </Button>
            )}
          </div>
        </Panel>

        {/* 顶部统计 */}
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            label="业务规则假设"
            value={totalRules}
            icon={Target}
            color="text-accent"
          />
          <StatCard
            label="状态不变量"
            value={totalInvariants}
            icon={ShieldCheck}
            color="text-accent"
          />
          <StatCard
            label="测试路径"
            value={totalPaths}
            icon={Route}
            color="text-accent"
          />
          <StatCard
            label="待发现 Bug"
            value={bugsInAdvanced}
            icon={AlertCircle}
            color="text-warning"
          />
        </div>

        {/* 业务规则假设 */}
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" />
              业务规则假设
            </span>
          }
          description="从文档、页面文案、代码、行业通用规则、AI 推断中得出的业务规则，每条标记来源与置信度，待测试验证。"
          bodyClassName="p-0"
        >
          {/* 小屏幕横向滚动容器，避免表格溢出 */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px] divide-y divide-border-soft">
              {/* 表头 */}
              <div className="grid grid-cols-[90px_1fr_120px_100px] gap-3 px-5 py-2.5 text-xs font-medium text-text-3">
                <span>规则编号</span>
                <span>规则内容 / 测试策略</span>
                <span>来源</span>
                <span>置信度</span>
              </div>
              {model.rules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-[90px_1fr_120px_100px] items-start gap-3 px-5 py-3 text-sm transition-colors hover:bg-bg-2"
                >
                  <span className="font-mono text-xs text-text-2">{rule.id}</span>
                  <div className="min-w-0">
                    <p className="text-text">{rule.rule}</p>
                    <div className="mt-2">
                      <p className="text-xs font-medium text-text-3">测试策略：</p>
                      <ul className="mt-1 space-y-0.5">
                        {rule.testStrategies.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-1.5 text-xs text-text-2"
                          >
                            <span className="mt-0.5 text-accent">▸</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {rule.targetBugIds.length > 0 && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <span className="text-xs text-text-3">关联 Bug：</span>
                        {rule.targetBugIds.map((b) => (
                          <Badge key={b} severity="warning">
                            {b}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Badge severity={ruleSourceSeverity[rule.source]}>
                      {ruleSourceLabels[rule.source]}
                    </Badge>
                  </div>
                  <div>
                    <Badge severity={confidenceSeverity[rule.confidence]}>
                      {confidenceLabels[rule.confidence]}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* 状态不变量 */}
        <Panel
          title={
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-accent" />
              状态不变量
            </span>
          }
          description="任何业务路径下都应成立的不变量，违反不变量即存在 Bug。"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border-soft">
            {model.invariants.map((inv) => (
              <div
                key={inv.id}
                className="px-5 py-3 transition-colors hover:bg-bg-2"
              >
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs text-accent">
                    {inv.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text">
                      <span className="font-mono text-accent">∀ </span>
                      {inv.description}
                    </p>
                    <p className="mt-1.5 text-xs text-text-2">
                      <span className="font-medium text-text-3">校验方法：</span>
                      {inv.checkMethod}
                    </p>
                    {inv.relatedRuleIds.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-xs text-text-3">关联规则：</span>
                        {inv.relatedRuleIds.map((r) => (
                          <span
                            key={r}
                            className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-2"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* 测试路径 */}
        <Panel
          title={
            <span className="flex items-center gap-2">
              <Route className="h-4 w-4 text-accent" />
              测试路径
            </span>
          }
          description={`按业务场景组织的探索性测试路径：正常路径 ${normalPaths} 条 · 异常·重复·绕过·滥用 ${abnormalPaths} 条 · 跨功能 ${crossFunctionPaths} 条`}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border-soft">
            {model.paths.map((path) => {
              const pathSource = data.pathSources[path.id] || "preset";
              return (
                <div
                  key={path.id}
                  className="px-5 py-4 transition-colors hover:bg-bg-2"
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs text-accent">
                      {path.id}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge severity={pathTypeSeverity[path.type]}>
                          {pathTypeLabels[path.type]}
                        </Badge>
                        {/* 来源标签：AI 动态生成 / 预设规则 */}
                        <Badge severity={testItemSourceSeverity[pathSource]}>
                          {testItemSourceLabels[pathSource]}
                        </Badge>
                        <h4 className="text-sm font-medium text-text">
                          {path.title}
                        </h4>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-text-2">
                        {path.description}
                      </p>

                      {/* 执行步骤 */}
                      <div className="mt-2">
                        <p className="text-xs font-medium text-text-3">
                          执行步骤：
                        </p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-text-2">
                          {path.steps.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ol>
                      </div>

                      {/* 预期行为 */}
                      <div className="mt-2 rounded-md border border-border-soft bg-bg-2 px-3 py-2">
                        <p className="text-xs text-text-2">
                          <span className="font-medium text-accent">预期：</span>
                          {path.expectedBehavior}
                        </p>
                      </div>

                      {/* 关联 Bug */}
                      {path.targetBugIds.length > 0 && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <GitBranch className="h-3.5 w-3.5 text-warning" />
                          <span className="text-xs text-text-3">检测目标：</span>
                          {path.targetBugIds.map((b) => (
                            <Badge key={b} severity="critical">
                              {b}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* 预埋 Bug 矩阵 */}
        <Panel
          title="待发现 Bug 矩阵"
          description={`共 ${totalBugs} 个待发现 Bug，基础测试已发现 ${bugsInBasic} 个，高级测试需发现 ${bugsInAdvanced} 个`}
          bodyClassName="p-0"
        >
          {/* 小屏幕横向滚动容器，避免表格溢出 */}
          <div className="overflow-x-auto">
            <div className="min-w-[560px] divide-y divide-border-soft">
              <div className="grid grid-cols-[90px_1fr_120px_120px] gap-3 px-5 py-2.5 text-xs font-medium text-text-3">
                <span>Bug ID</span>
                <span>标题</span>
                <span>发现阶段</span>
                <span>检测路径</span>
              </div>
              {model.seededBugs.map((bug) => (
                <div
                  key={bug.id}
                  className="grid grid-cols-[90px_1fr_120px_120px] items-center gap-3 px-5 py-2.5 text-sm transition-colors hover:bg-bg-2"
                >
                  <span className="font-mono text-xs text-text-2">{bug.id}</span>
                  <span className="text-text">{bug.title}</span>
                  <div>
                    {bug.detectedInBasic ? (
                      <Badge severity="accent">基础测试</Badge>
                    ) : (
                      <Badge severity="warning">高级测试</Badge>
                    )}
                  </div>
                  <span className="font-mono text-xs text-text-2">
                    {bug.detectedByPath || "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* 底部下一步操作 */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">测试计划已就绪</p>
            <p className="mt-0.5 text-xs text-text-2">
              下一步：执行高级业务测试，沿 {totalPaths} 条测试路径逐个执行，发现 {bugsInAdvanced} 个待发现 Bug。
            </p>
          </div>
          <Button href={`/projects/${projectId}/advanced/run`}>
            开始执行
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

// 统计卡片
function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  return (
    <Panel bodyClassName="flex items-center gap-3">
      <Icon className={`h-6 w-6 ${color}`} />
      <div>
        <p className="text-xs text-text-3">{label}</p>
        <p className="font-mono text-xl text-text">{value}</p>
      </div>
    </Panel>
  );
}
