"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertCircle,
  GitBranch,
  Users,
  ShieldAlert,
  FileSearch,
  Layers,
  Network,
  Settings,
  RefreshCw,
  Film,
  Info,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FeatureMap } from "@/components/ui/FeatureMap";
import {
  AIThinkingPanel,
  type AIThinkingLog,
} from "@/components/ui/AIThinkingPanel";
import {
  getProject,
  type AnalysisModel,
  type Project,
  type FeatureNode,
  type RiskLevel,
  type SourceType,
  type Confidence,
} from "@/lib/store";

// 风险等级 → 中文标签
const riskLabel: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

// 来源 → 中文标签
const sourceLabel: Record<SourceType, string> = {
  doc: "文档明确",
  code: "代码确认",
  runtime: "运行确认",
  ai: "AI 推断",
  unknown: "未知",
};

// 来源 → Badge severity
const sourceSeverity: Record<
  SourceType,
  "critical" | "warning" | "info" | "accent" | "pass"
> = {
  doc: "info",
  code: "accent",
  runtime: "critical",
  ai: "info",
  unknown: "info",
};

// 置信度 → 中文标签
const confidenceLabel: Record<Confidence, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

// 置信度 → Badge severity
const confidenceSeverity: Record<
  Confidence,
  "critical" | "warning" | "info" | "accent" | "pass"
> = {
  high: "pass",
  medium: "warning",
  low: "info",
};

// 分析步骤定义
interface AnalysisStep {
  label: string;
  // 触发该步骤的延迟（毫秒），用于模拟渐进式进度
  delay: number;
}

const ANALYSIS_STEPS: AnalysisStep[] = [
  { label: "正在解析代码结构...", delay: 0 },
  { label: "正在调用 AI 分析...", delay: 1500 },
  { label: "正在生成功能地图...", delay: 3000 },
  { label: "正在标记风险区域...", delay: 4500 },
];

// 分析状态
type AnalysisState =
  | { status: "idle" }
  | { status: "analyzing"; modelName: string; currentStep: number }
  | { status: "success"; model: AnalysisModel }
  | {
      status: "error";
      message: string;
      code?: string;
      llmNotConfigured: boolean;
    };

export default function AnalysisPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [project, setProject] = useState<Project | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState>({
    status: "idle",
  });

  // 客户端挂载后读取项目
  useEffect(() => {
    setMounted(true);
    const p = getProject(projectId);
    setProject(p);
    setLoading(false);
  }, [projectId]);

  // 触发分析流程（通过 API 路由调用服务端 runAnalysis）
  const triggerAnalysis = useCallback(async () => {
    if (!projectId) return;

    // 先获取 LLM 配置，用于显示模型名称
    let modelName = "LLM";
    try {
      const cfgRes = await fetch("/api/llm-config");
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        if (cfgData.config?.modelName) {
          modelName = cfgData.config.modelName;
        } else if (cfgData.config?.modelId) {
          modelName = cfgData.config.modelId;
        }
      }
    } catch {
      // 获取配置失败时忽略，使用默认名称
    }

    // 进入分析中状态，启动步骤动画
    setAnalysisState({ status: "analyzing", modelName, currentStep: 0 });

    // 启动步骤推进定时器
    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    ANALYSIS_STEPS.forEach((step, idx) => {
      const timer = setTimeout(() => {
        setAnalysisState((prev) =>
          prev.status === "analyzing"
            ? { ...prev, currentStep: idx }
            : prev,
        );
      }, step.delay);
      stepTimers.push(timer);
    });

    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "POST",
      });
      const data = await res.json();

      // 清理定时器
      stepTimers.forEach(clearTimeout);

      if (!res.ok) {
        const llmNotConfigured =
          data.code === "llm_not_configured" ||
          data.code === "config";
        setAnalysisState({
          status: "error",
          message: data.error || "分析失败",
          code: data.code,
          llmNotConfigured,
        });
        return;
      }

      // 分析成功：更新本地项目状态
      if (data.model) {
        const updated = getProject(projectId);
        if (updated) {
          setProject({
            ...updated,
            status: "analyzed",
            analysisModel: data.model,
          });
        }
        setAnalysisState({ status: "success", model: data.model });
      } else {
        setAnalysisState({
          status: "error",
          message: "分析失败：未返回分析结果",
          llmNotConfigured: false,
        });
      }
    } catch (err) {
      stepTimers.forEach(clearTimeout);
      setAnalysisState({
        status: "error",
        message: `请求失败：${err instanceof Error ? err.message : String(err)}`,
        llmNotConfigured: false,
      });
    }
  }, [projectId]);

  // 自动触发分析（仅当项目无分析结果且状态为 idle 时）
  useEffect(() => {
    if (!mounted || !project) return;
    if (project.analysisModel) return; // 已有分析结果
    if (analysisState.status !== "idle") return; // 已在分析中或已出错
    triggerAnalysis();
  }, [mounted, project, analysisState.status, triggerAnalysis]);

  // 客户端挂载前显示加载
  if (!mounted || loading) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        正在加载项目…
      </div>
    );
  }

  // 项目不存在
  if (!project) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-lg font-semibold text-text">项目不存在</h2>
        <p className="mt-2 text-sm text-text-2">
          可能该项目已被删除，或链接已失效。
        </p>
        <Button href="/" className="mt-4" variant="ghost" size="sm">
          <ArrowLeft className="h-4 w-4" />
          返回项目列表
        </Button>
      </div>
    );
  }

  // 已有分析结果：直接显示
  if (project.analysisModel) {
    return (
      <AnalysisResultView
        project={project}
        model={project.analysisModel}
      />
    );
  }

  // 分析中
  if (analysisState.status === "analyzing") {
    return (
      <AnalyzingView
        projectName={project.name}
        currentStep={analysisState.currentStep}
        modelName={analysisState.modelName}
        projectId={projectId}
      />
    );
  }

  // 分析出错
  if (analysisState.status === "error") {
    return (
      <ErrorView
        projectName={project.name}
        message={analysisState.message}
        llmNotConfigured={analysisState.llmNotConfigured}
        isDemo={project.isDemo}
        onRetry={triggerAnalysis}
        projectId={projectId}
      />
    );
  }

  // 兜底：不应到达
  return (
    <div className="py-24 text-center text-sm text-text-3">
      正在准备分析…
    </div>
  );
}

// 分析中视图：加载动画 + 渐进式步骤 + AI 思考过程
function AnalyzingView({
  projectName,
  currentStep,
  modelName,
  projectId,
}: {
  projectName: string;
  currentStep: number;
  modelName: string;
  projectId: string;
}) {
  const [aiLogs, setAiLogs] = useState<AIThinkingLog[]>([]);
  const lastLogIdRef = useRef<string | null>(null);

  // 轮询 AI 思考日志（会话模式：只显示当前分析的思考，刷新不消失）
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let knownSessionId: string | null = null;

    const poll = async () => {
      try {
        const url = new URL(
          `/api/projects/${projectId}/ai-thinking`,
          window.location.origin,
        );
        url.searchParams.set("page", "analysis");
        if (lastLogIdRef.current) {
          url.searchParams.set("afterId", lastLogIdRef.current);
        }
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const data = await res.json();
        const serverSessionId: string | null = data.sessionId ?? null;

        // 检测会话变化：服务端开启了新会话（重新分析），清空旧日志重新加载
        if (knownSessionId !== null && serverSessionId !== null && knownSessionId !== serverSessionId) {
          setAiLogs([]);
          lastLogIdRef.current = null;
          knownSessionId = serverSessionId;
          const reloadUrl = new URL(
            `/api/projects/${projectId}/ai-thinking`,
            window.location.origin,
          );
          reloadUrl.searchParams.set("page", "analysis");
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
          const newLogs: AIThinkingLog[] = data.logs || [];
          if (newLogs.length > 0 && !cancelled) {
            setAiLogs((prev) => [...prev, ...newLogs]);
            lastLogIdRef.current = data.lastId ?? newLogs[newLogs.length - 1].id;
          }
        }
      } catch {
        // 忽略错误，继续轮询
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
  }, [projectId]);

  return (
    <>
      <PageHeader
        eyebrow="项目分析"
        title="AI 正在理解你的项目"
        description={`正在对「${projectName}」进行多维分析：功能地图、角色地图、状态机、数据地图、风险地图与三方对照。`}
      />
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-16">
        {/* AI 思考过程窗口（位于顶部确保可见） */}
        <AIThinkingPanel
          logs={aiLogs}
          loading={true}
          title="AI 思考过程"
          emptyText="AI 正在准备分析，思考过程即将显示…"
        />

        <div className="flex flex-col items-center text-center">
          <span className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-dim opacity-60" />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-accent-dim">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </span>
          </span>
          <h3 className="mt-6 text-base font-semibold text-text">
            AI 正在分析项目…
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-2">
            正在读取代码结构与文档语义，构建功能地图、角色权限、状态机、数据关系与风险区域，并执行文档 / 代码 / 运行三方对照。
          </p>

          {/* 当前模型标识 */}
          <div className="mt-4 flex items-center gap-1.5 rounded-full border border-border-soft bg-surface px-3 py-1 text-xs text-text-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            当前模型：<span className="font-medium text-text">{modelName}</span>
          </div>

          {/* 分析步骤进度 */}
          <div className="mt-8 w-full max-w-md space-y-3 text-left">
            {ANALYSIS_STEPS.map((step, i) => {
              const isDone = i < currentStep;
              const isActive = i === currentStep;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-text-2"
                >
                  {isDone ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-dim text-accent">
                      ✓
                    </span>
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  ) : (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-border-soft" />
                  )}
                  <span className={isActive ? "text-text" : ""}>
                    {step.label}
                    {isActive && step.label.includes("AI 分析") && (
                      <span className="ml-1 text-accent">（{modelName}）</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// 错误视图：显示错误信息 + 重试 / 配置 / 降级按钮
function ErrorView({
  projectName,
  message,
  llmNotConfigured,
  isDemo,
  onRetry,
  projectId,
}: {
  projectName: string;
  message: string;
  llmNotConfigured: boolean;
  isDemo: boolean;
  onRetry: () => void;
  projectId: string;
}) {
  return (
    <>
      <PageHeader
        eyebrow="项目分析"
        title="AI 分析失败"
        description={`对「${projectName}」的分析未能完成。`}
      />
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-critical" />
          <h3 className="mt-4 text-base font-semibold text-text">
            {llmNotConfigured ? "LLM 未配置" : "分析过程中出错"}
          </h3>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-2">
            {message}
          </p>

          {/* 操作按钮 */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {/* LLM 未配置：去配置按钮 */}
            {llmNotConfigured && (
              <Button href="/settings" size="sm">
                <Settings className="h-4 w-4" />
                去配置 LLM
              </Button>
            )}

            {/* 重试按钮 */}
            <Button variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
              重试
            </Button>

            {/* 演示项目降级按钮：使用剧本回放 */}
            {isDemo && (
              <Button
                variant="ghost"
                size="sm"
                href={`/projects/${projectId}/modules`}
              >
                <Film className="h-4 w-4" />
                使用剧本回放
              </Button>
            )}
          </div>

          {/* LLM 未配置时的提示 */}
          {llmNotConfigured && (
            <div className="mt-6 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-dim px-4 py-3 text-left">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="text-xs leading-relaxed text-text-2">
                <p className="font-medium text-warning">
                  LLM 未配置，无法进行真实 AI 分析
                </p>
                <p className="mt-1">
                  请前往设置页配置 LLM API（支持 OpenAI 兼容格式），配置完成后点击"重试"重新分析。
                </p>
                {isDemo && (
                  <p className="mt-1">
                    演示项目也可跳过 AI 分析，直接使用剧本回放模式进行测试。
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// 分析结果视图：展示完整 7 类分析结果
function AnalysisResultView({
  project,
  model,
}: {
  project: Project;
  model: AnalysisModel;
}) {
  return (
    <>
      <PageHeader
        eyebrow="项目分析"
        title="项目分析结果"
        description={`基于代码与文档自动构建的多维地图，为后续测试计划提供依据。项目标识：${project.id}`}
        action={
          <div className="flex items-center gap-2">
            <Badge severity="pass">分析完成</Badge>
            {project.isDemo && <Badge severity="accent">演示项目</Badge>}
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* B1 项目概况 */}
        <OverviewPanel model={model} />

        {/* B2 功能地图 */}
        <FeatureMapPanel nodes={model.featureMap} />

        {/* B3 角色权限地图 */}
        <RoleMapPanel roles={model.roleMap} />

        {/* B4 状态机地图 */}
        <StateMapPanel states={model.stateMap} />

        {/* B5 数据地图 */}
        <DataMapPanel
          objects={model.dataMap.objects}
          relations={model.dataMap.relations}
          consistencyRisks={model.consistencyRisks}
        />

        {/* B6 风险地图 */}
        <RiskMapPanel risks={model.riskMap} />

        {/* B7 三方对照 */}
        <CrossCheckPanel items={model.crossCheck} />

        {/* 底部下一步操作 */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">分析已完成</p>
            <p className="mt-0.5 text-xs text-text-2">
              下一步：选择需要执行的测试模块（UI/功能/业务/安全/数据库/并发），6 个模块平级可任意顺序测试。
            </p>
          </div>
          <Button href={`/projects/${project.id}/modules`}>
            进入模块选择中心
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}

// B1 项目概况面板
function OverviewPanel({ model }: { model: AnalysisModel }) {
  const o = model.overview;
  const items: { label: string; value: React.ReactNode }[] = [
    { label: "项目类型", value: o.projectType },
    { label: "面向用户", value: o.targetUser },
    { label: "核心功能", value: o.coreFunctions.join("、") },
    { label: "核心业务对象", value: o.businessObjects.join("、") },
    { label: "技术栈", value: o.techStack.join(" / ") },
    { label: "数据库", value: o.database },
    { label: "登录方式", value: o.authMethod },
    { label: "权限体系", value: o.permissionSystem },
  ];

  return (
    <Panel
      title="项目概况"
      description="技术栈、核心功能与业务对象的概览。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <Layers className="h-3.5 w-3.5" />
          B1
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-md border border-border-soft bg-bg-2 px-3 py-2.5"
          >
            <p className="text-xs text-text-3">{it.label}</p>
            <p className="mt-1 text-sm text-text">{it.value}</p>
          </div>
        ))}
      </div>

      {/* API 列表 */}
      <div className="mt-4">
        <p className="text-xs font-medium text-text-2">API 列表</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {o.apis.map((api) => (
            <span
              key={api}
              className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-accent"
            >
              {api}
            </span>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// B2 功能地图面板（树形 + 风险色标）
function FeatureMapPanel({ nodes }: { nodes: FeatureNode[] }) {
  return (
    <Panel
      title="功能地图"
      description="按模块拆解的功能点与风险色标，高风险区域需重点测试。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <GitBranch className="h-3.5 w-3.5" />
          B2
        </span>
      }
    >
      <div className="space-y-5">
        {nodes.map((node, i) => (
          <div key={i}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <h4 className="text-sm font-semibold text-text">{node.name}</h4>
            </div>
            {node.children && node.children.length > 0 && (
              <div className="mt-2 pl-4">
                <FeatureMap
                  items={node.children.map((child) => ({
                    name: child.name,
                    risk: child.risk || "low",
                  }))}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 风险图例 */}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-soft pt-3 text-xs text-text-3">
        <span>风险图例：</span>
        {(["low", "medium", "high", "critical"] as RiskLevel[]).map((r) => (
          <span key={r} className="flex items-center gap-1">
            <span
              className={`h-2.5 w-2.5 rounded ${
                r === "low"
                  ? "bg-accent"
                  : r === "medium"
                    ? "bg-info"
                    : r === "high"
                      ? "bg-warning"
                      : "bg-critical"
              }`}
            />
            {riskLabel[r]}
          </span>
        ))}
      </div>
    </Panel>
  );
}

// B3 角色权限地图面板
function RoleMapPanel({
  roles,
}: {
  roles: AnalysisModel["roleMap"];
}) {
  return (
    <Panel
      title="角色权限地图"
      description="系统中的角色、可访问页面与数据归属范围。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <Users className="h-3.5 w-3.5" />
          B3
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-bg-2 p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-dim text-accent">
                <Users className="h-3.5 w-3.5" />
              </span>
              <h4 className="text-sm font-semibold text-text">{role.role}</h4>
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium text-text-2">可访问页面</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {role.pages.map((page) => (
                  <span
                    key={page}
                    className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text-2"
                  >
                    {page}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-3">
              <p className="text-xs font-medium text-text-2">数据归属</p>
              <p className="mt-1 text-xs leading-relaxed text-text-3">
                {role.dataScope}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// B4 状态机地图面板
function StateMapPanel({
  states,
}: {
  states: AnalysisModel["stateMap"];
}) {
  return (
    <Panel
      title="状态机地图"
      description="核心业务对象的状态流转，标记非法流转用于异常测试。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <GitBranch className="h-3.5 w-3.5" />
          B4
        </span>
      }
    >
      <div className="space-y-5">
        {states.map((sm, i) => (
          <div key={i} className="rounded-lg border border-border bg-bg-2 p-4">
            <h4 className="text-sm font-semibold text-text">{sm.subject}</h4>

            {/* 合法流转 */}
            <div className="mt-3">
              <p className="text-xs font-medium text-accent">合法流转</p>
              <div className="mt-2 space-y-1.5">
                {sm.flows.map((flow, j) => (
                  <div
                    key={j}
                    className="flex items-center gap-2 font-mono text-xs text-text-2"
                  >
                    <span className="rounded bg-surface-2 px-2 py-0.5 text-text">
                      {flow.from}
                    </span>
                    <span className="text-accent">──{flow.event}──▶</span>
                    <span className="rounded bg-surface-2 px-2 py-0.5 text-text">
                      {flow.to}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 非法流转 */}
            {sm.illegalFlows.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-critical">
                  非法流转（异常测试重点）
                </p>
                <div className="mt-2 space-y-1.5">
                  {sm.illegalFlows.map((flow, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 font-mono text-xs text-text-2"
                    >
                      <span className="rounded bg-critical-dim px-2 py-0.5 text-critical">
                        {flow.from}
                      </span>
                      <span className="text-critical">─ ✕ ─▶</span>
                      <span className="rounded bg-critical-dim px-2 py-0.5 text-critical">
                        {flow.to}
                      </span>
                      <span className="text-text-3">（{flow.note}）</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

// B5 数据地图面板
function DataMapPanel({
  objects,
  relations,
  consistencyRisks,
}: {
  objects: AnalysisModel["dataMap"]["objects"];
  relations: AnalysisModel["dataMap"]["relations"];
  consistencyRisks?: string[];
}) {
  return (
    <Panel
      title="数据地图"
      description="核心数据实体与依赖关系，标记一致性风险。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <Network className="h-3.5 w-3.5" />
          B5
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 数据对象 */}
        <div>
          <p className="text-xs font-medium text-text-2">数据对象</p>
          <div className="mt-2 space-y-1.5">
            {objects.map((obj, i) => (
              <div
                key={i}
                className="rounded-md border border-border-soft bg-bg-2 px-3 py-2"
              >
                <p className="font-mono text-sm text-accent">{obj.name}</p>
                <p className="mt-0.5 text-xs text-text-3">{obj.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 关系图 */}
        <div>
          <p className="text-xs font-medium text-text-2">对象关系</p>
          <div className="mt-2 space-y-1.5">
            {relations.map((rel, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-border-soft bg-bg-2 px-3 py-2 font-mono text-xs"
              >
                <span className="text-text">{rel.from}</span>
                <span className="text-accent">── {rel.type} ──▶</span>
                <span className="text-text">{rel.to}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 一致性风险 */}
      {consistencyRisks && consistencyRisks.length > 0 && (
        <div className="mt-4">
          <p className="flex items-center gap-1 text-xs font-medium text-warning">
            <ShieldAlert className="h-3.5 w-3.5" />
            一致性风险
          </p>
          <ul className="mt-2 space-y-1">
            {consistencyRisks.map((risk, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-warning/20 bg-warning-dim/50 px-3 py-2 text-xs text-text-2"
              >
                <span className="mt-0.5 text-warning">•</span>
                <span>{risk}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// B6 风险地图面板
function RiskMapPanel({ risks }: { risks: AnalysisModel["riskMap"] }) {
  const sorted = [...risks].sort((a, b) => {
    const order: Record<RiskLevel, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return order[a.level] - order[b.level];
  });

  const levelSeverity: Record<
    RiskLevel,
    "critical" | "warning" | "info" | "accent" | "pass"
  > = {
    critical: "critical",
    high: "warning",
    medium: "info",
    low: "accent",
  };

  return (
    <Panel
      title="风险地图"
      description="按风险等级排序的高危区域，标记原因与测试优先级。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <ShieldAlert className="h-3.5 w-3.5" />
          B6
        </span>
      }
    >
      <div className="space-y-2">
        {sorted.map((risk, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 rounded-md border border-border-soft bg-bg-2 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text">
                  {risk.area}
                </span>
                <Badge severity={levelSeverity[risk.level]}>
                  {riskLabel[risk.level]}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-2">
                {risk.reason}
              </p>
            </div>
            <span className="shrink-0 rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-3">
              {risk.priority}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// B7 三方对照面板
function CrossCheckPanel({
  items,
}: {
  items: AnalysisModel["crossCheck"];
}) {
  return (
    <Panel
      title="三方对照"
      description="文档 / 代码 / 运行三方对照，标记来源与置信度。"
      action={
        <span className="flex items-center gap-1 text-xs text-text-3">
          <FileSearch className="h-3.5 w-3.5" />
          B7
        </span>
      }
    >
      {/* 表格 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-text-3">
              <th className="whitespace-nowrap px-2 py-2 font-medium">
                功能点
              </th>
              <th className="whitespace-nowrap px-2 py-2 font-medium">文档</th>
              <th className="whitespace-nowrap px-2 py-2 font-medium">代码</th>
              <th className="whitespace-nowrap px-2 py-2 font-medium">运行</th>
              <th className="whitespace-nowrap px-2 py-2 font-medium">结论</th>
              <th className="whitespace-nowrap px-2 py-2 font-medium">
                来源 / 置信度
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={i}
                className="border-b border-border-soft align-top"
              >
                <td className="whitespace-nowrap px-2 py-2.5 font-medium text-text">
                  {item.feature}
                </td>
                <td className="px-2 py-2.5 text-text-2">{item.doc}</td>
                <td className="px-2 py-2.5 text-text-2">{item.code}</td>
                <td className="px-2 py-2.5 text-text-2">{item.runtime}</td>
                <td className="px-2 py-2.5 text-text">{item.conclusion}</td>
                <td className="whitespace-nowrap px-2 py-2.5">
                  <div className="flex flex-col gap-1">
                    <Badge severity={sourceSeverity[item.source]}>
                      {sourceLabel[item.source]}
                    </Badge>
                    <Badge severity={confidenceSeverity[item.confidence]}>
                      置信度：{confidenceLabel[item.confidence]}
                    </Badge>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
