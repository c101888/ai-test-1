"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  PlayCircle,
  RefreshCw,
  Camera,
  Terminal,
  Network,
  Database,
  ArrowLeftRight,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  AIThinkingPanel,
  type AIThinkingLog,
} from "@/components/ui/AIThinkingPanel";
import {
  getAdvancedTestModel,
  getAdvancedTestModelForProject,
  pathTypeLabels,
  pathTypeSeverity,
  type TestPath,
  type AdvancedTestModel,
} from "@/lib/advanced-test-model";
import type {
  AdvancedPathResult,
  AdvancedStepRecord,
  ResultStatus,
  RiskLevel,
} from "@/lib/store";

// 路径执行状态
type PathRunState = "pending" | "running" | "pass" | "fail" | "skip";

const stateSeverity: Record<
  PathRunState,
  "pass" | "critical" | "warning" | "info" | "accent"
> = {
  pending: "info",
  running: "accent",
  pass: "pass",
  fail: "critical",
  skip: "warning",
};

const stateLabel: Record<PathRunState, string> = {
  pending: "待执行",
  running: "执行中",
  pass: "通过",
  fail: "发现问题",
  skip: "已跳过",
};

// 严重等级 → Badge severity
const severityToBadge: Record<
  RiskLevel,
  "critical" | "warning" | "info" | "accent" | "pass"
> = {
  low: "info",
  medium: "info",
  high: "warning",
  critical: "critical",
};

// 步骤证据类型 → 图标
function StepEvidenceIcons({ step }: { step: AdvancedStepRecord }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {step.screenshotDesc && (
        <Badge severity="accent">
          <Camera className="h-3 w-3" />
          截图
        </Badge>
      )}
      {step.consoleLog && (
        <Badge severity="info">
          <Terminal className="h-3 w-3" />
          Console
        </Badge>
      )}
      {step.networkRequest && (
        <Badge severity="warning">
          <Network className="h-3 w-3" />
          网络请求
        </Badge>
      )}
      {step.dataChange && (
        <Badge severity="critical">
          <Database className="h-3 w-3" />
          数据变化
        </Badge>
      )}
      {step.stateBefore && step.stateAfter && (
        <Badge severity="accent">
          <ArrowLeftRight className="h-3 w-3" />
          状态对比
        </Badge>
      )}
    </div>
  );
}

export default function AdvancedRunPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [model, setModel] = useState<AdvancedTestModel | null>(null);
  const [runStates, setRunStates] = useState<Map<string, PathRunState>>(
    new Map(),
  );
  const [results, setResults] = useState<Map<string, AdvancedPathResult>>(
    new Map(),
  );
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [currentPathId, setCurrentPathId] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 预检失败时的解决方案提示
  const [precheckSolution, setPrecheckSolution] = useState<string | null>(null);
  // AI 思考过程日志
  const [aiThinkingLogs, setAiThinkingLogs] = useState<AIThinkingLog[]>([]);
  const aiThinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiThinkingAbortRef = useRef<AbortController | null>(null);
  const lastAiLogIdRef = useRef<string | null>(null);
  const abortRef = useRef(false);
  const currentPathRef = useRef<HTMLDivElement | null>(null);
  // 异步任务相关
  const [runId, setRunId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

  // 当前执行项变化时自动滚动到视口
  useEffect(() => {
    if (currentPathRef.current) {
      currentPathRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentPathId]);

  // 初始化：加载测试模型 + 获取项目信息判断是否为演示项目
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMounted(true);

      // 从服务端获取项目信息
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          const project = data.project;
          if (project) {
            if (project.isDemo) {
              // 演示项目：使用硬编码模型（剧本回放）
              setIsDemo(true);
              const dynamicModel = getAdvancedTestModelForProject(project);
              if (!cancelled) setModel(dynamicModel);
              return;
            }
            // 非演示项目：调用 advanced-model API 获取 AI 动态生成的测试清单
            // 与计划页、服务端执行使用同一数据源，确保前端显示与实际执行一致
            const modelRes = await fetch(`/api/projects/${projectId}/advanced-model`);
            if (modelRes.ok) {
              const modelJson = await modelRes.json();
              const aiModel = modelJson.model;
              if (aiModel && aiModel.paths && aiModel.paths.length > 0) {
                if (!cancelled) setModel(aiModel);
                return;
              }
            }
            // API 失败时降级到同步预设版本（仅用于显示，实际执行仍由服务端决定）
            const dynamicModel = getAdvancedTestModelForProject(project);
            if (!cancelled) setModel(dynamicModel);
            return;
          }
        }
      } catch {
        // 获取失败时降级到默认模型
      }

      // 降级：使用默认演示项目模型
      if (!cancelled) setModel(getAdvancedTestModel());
    })();
    return () => {
      cancelled = false;
    };
  }, [projectId]);

  // 执行单条路径（剧本回放，模拟 1-2 秒）
  const executePath = useCallback(
    async (path: TestPath): Promise<AdvancedPathResult> => {
      const delayMs = 1000 + Math.floor(Math.random() * 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // 剧本回放：根据 pathId 返回预定义结果
      // 这里复用 advanced-test-runner 中的剧本逻辑（简化版）
      return simulatePathResult(path, projectId);
    },
    [projectId],
  );

  // 轮询 AI 思考日志（会话模式：只显示当前操作的思考，刷新不消失）
  const pollAiThinkingLogs = useCallback(async () => {
    aiThinkingAbortRef.current = new AbortController();
    // 记录前端已知的 sessionId，用于检测服务端是否开启新会话
    let knownSessionId: string | null = null;

    const poll = async (): Promise<void> => {
      try {
        const url = new URL(
          `/api/projects/${projectId}/ai-thinking`,
          window.location.origin,
        );
        url.searchParams.set("page", "advanced-run");
        if (lastAiLogIdRef.current) {
          url.searchParams.set("afterId", lastAiLogIdRef.current);
        }
        const res = await fetch(url.toString(), {
          signal: aiThinkingAbortRef.current?.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        const serverSessionId: string | null = data.sessionId ?? null;

        // 检测会话变化：服务端开启了新会话（重新执行），清空旧日志重新加载
        if (knownSessionId !== null && serverSessionId !== null && knownSessionId !== serverSessionId) {
          setAiThinkingLogs([]);
          lastAiLogIdRef.current = null;
          knownSessionId = serverSessionId;
          // 重新加载新会话的全部日志
          const reloadUrl = new URL(
            `/api/projects/${projectId}/ai-thinking`,
            window.location.origin,
          );
          reloadUrl.searchParams.set("page", "advanced-run");
          const reloadRes = await fetch(reloadUrl.toString());
          if (reloadRes.ok) {
            const reloadData = await reloadRes.json();
            const reloadLogs: AIThinkingLog[] = reloadData.logs || [];
            if (reloadLogs.length > 0) {
              setAiThinkingLogs(reloadLogs);
              lastAiLogIdRef.current = reloadData.lastId ?? reloadLogs[reloadLogs.length - 1].id;
            }
          }
        } else {
          knownSessionId = serverSessionId;
          const newLogs: AIThinkingLog[] = data.logs || [];
          if (newLogs.length > 0) {
            setAiThinkingLogs((prev) => [...prev, ...newLogs]);
            lastAiLogIdRef.current = data.lastId ?? newLogs[newLogs.length - 1].id;
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
      // 继续轮询（1 秒间隔，比 run 进度更频繁）
      aiThinkingTimerRef.current = setTimeout(poll, 1000);
    };

    await poll();
  }, [projectId]);

  // 停止 AI 思考日志轮询
  const stopAiThinkingPoll = useCallback(() => {
    if (aiThinkingTimerRef.current) {
      clearTimeout(aiThinkingTimerRef.current);
      aiThinkingTimerRef.current = null;
    }
    if (aiThinkingAbortRef.current) {
      aiThinkingAbortRef.current.abort();
      aiThinkingAbortRef.current = null;
    }
  }, []);

  // 轮询测试运行进度
  const pollRunProgress = useCallback(async (targetRunId: string) => {
    pollAbortRef.current = new AbortController();

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/advanced-run/${targetRunId}`,
          { signal: pollAbortRef.current?.signal },
        );
        if (!res.ok) {
          throw new Error(`查询进度失败 (${res.status})`);
        }
        const data = await res.json();
        const serverRun = data.run;
        const serverResults: AdvancedPathResult[] = data.results || [];

        // 更新已完成的路径状态（根据 progress.current 区分 pending/running）
        const newResultMap = new Map<string, AdvancedPathResult>();
        const newRunStatesMap = new Map<string, PathRunState>();
        const currentProgress = data.progress as { current: number; total: number; currentLabel?: string } | undefined;
        const currentIdx = currentProgress?.current ?? 0;

        for (let idx = 0; idx < model!.paths.length; idx++) {
          const path = model!.paths[idx];
          const result = serverResults.find((r) => r.pathId === path.id);
          if (result) {
            // 已有结果：根据结果状态显示
            newResultMap.set(path.id, result);
            newRunStatesMap.set(
              path.id,
              result.status === "pass"
                ? "pass"
                : result.status === "skip"
                  ? "skip"
                  : "fail",
            );
          } else if (idx + 1 === currentIdx) {
            // 当前正在执行的项（progress.current 是 1-based）
            newRunStatesMap.set(path.id, "running");
          } else if (idx + 1 < currentIdx) {
            // 已过但无结果（异常情况，可能正在保存中），标记为 running
            newRunStatesMap.set(path.id, "running");
          } else {
            // 未轮到的项：保持 pending
            newRunStatesMap.set(path.id, "pending");
          }
        }

        setResults(newResultMap);
        setRunStates(newRunStatesMap);

        // 更新当前执行项（用于高亮和进度条显示）
        if (currentProgress && currentProgress.current > 0) {
          const currentPath = model!.paths[currentProgress.current - 1];
          if (currentPath) {
            setCurrentPathId(currentPath.id);
            setCurrentLabel(currentProgress.currentLabel ?? currentPath.title);
          }
        }

        // 检查是否完成
        if (serverRun.status === "done" || serverRun.status === "failed") {
          setCurrentPathId(null);
          setRunning(false);
          setDone(true);
          if (serverRun.status === "failed" && serverRun.error) {
            setError(`测试执行失败：${serverRun.error}`);
          }
          // 停止 AI 思考日志轮询（再拉取一次确保获取最终日志）
          setTimeout(() => stopAiThinkingPoll(), 2000);
          return;
        }

        // 继续轮询（1.5 秒间隔）
        pollTimerRef.current = setTimeout(poll, 1500);
      } catch (err) {
        // AbortError 不继续轮询
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        // 其他错误继续重试
        pollTimerRef.current = setTimeout(poll, 1500);
      }
    };

    await poll();
  }, [projectId, model]);

  // 开始执行
  // 执行方式由项目类型决定：演示项目→剧本回放，非演示项目→真实执行
  const handleStart = useCallback(async () => {
    if (running || !model || model.paths.length === 0) {
      // 未分析时明确提示
      if (model && model.paths.length === 0) {
        setError("项目尚未分析或分析结果为空，无法生成测试路径。请先完成项目分析。");
      }
      return;
    }
    abortRef.current = false;
    setRunning(true);
    setDone(false);
    setError(null);
    setRunId(null);
    setTaskId(null);
    setPrecheckSolution(null);
    // 重置 AI 思考日志
    setAiThinkingLogs([]);
    lastAiLogIdRef.current = null;

    // 重置所有状态
    const newStates = new Map<string, PathRunState>();
    model.paths.forEach((p) => newStates.set(p.id, "pending"));
    setRunStates(newStates);
    setResults(new Map());

    // ============================================================
    // 非演示项目：真实执行（异步任务 + 轮询进度）
    // ============================================================
    if (!isDemo) {
      try {
        // 不再标记所有路径为 running，保持 pending 状态
        // 轮询会根据 progress.current 精确控制每项状态
        setCurrentPathId(null);

        // POST 启动异步任务
        const startRes = await fetch(
          `/api/projects/${projectId}/advanced-run`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "real" }),
          },
        );

        if (!startRes.ok) {
          const errBody = await startRes.json().catch(() => ({}));
          // 预检失败（503）：显示错误原因和解决方案，不降级
          if (startRes.status === 503) {
            setError(errBody.error || "项目无法访问，无法执行测试");
            setPrecheckSolution(errBody.solution || "请启动被测项目后重新执行测试。");
            setRunning(false);
            setDone(true);
            setCurrentPathId(null);
            return;
          }
          throw new Error(
            errBody.error || `启动测试失败 (${startRes.status})`,
          );
        }

        const startData = await startRes.json();
        const newRunId: string = startData.runId;
        const newTaskId: string = startData.taskId;
        setRunId(newRunId);
        setTaskId(newTaskId);

        // 启动 AI 思考日志轮询（与 run 进度并行）
        pollAiThinkingLogs();

        // 开始轮询进度
        await pollRunProgress(newRunId);
      } catch (err) {
        setError(
          `真实执行失败：${(err as Error).message}\n\n请检查：\n1. 被测项目是否已启动（如 npm run dev）\n2. 测试地址是否可访问\n3. 测试账号密码是否正确\n4. chromium 是否已安装（npx playwright install chromium）\n\n修正后点击「重新执行」重试。`,
        );
        setRunning(false);
        setDone(true);
        setCurrentPathId(null);
      }
      return;
    }

    // ============================================================
    // 演示项目：剧本回放（客户端模拟执行）
    // ============================================================
    for (let i = 0; i < model.paths.length; i++) {
      if (abortRef.current) break;
      const path = model.paths[i];

      // 标记为执行中
      setCurrentPathId(path.id);
      setRunStates((prev) => {
        const next = new Map(prev);
        next.set(path.id, "running");
        return next;
      });

      try {
        const result = await executePath(path);

        setResults((prev) => {
          const next = new Map(prev);
          next.set(path.id, result);
          return next;
        });
        setRunStates((prev) => {
          const next = new Map(prev);
          next.set(
            path.id,
            result.status === "pass"
              ? "pass"
              : result.status === "skip"
                ? "skip"
                : "fail",
          );
          return next;
        });
      } catch (err) {
        setError(`路径 ${path.id} 执行失败：${(err as Error).message}`);
        break;
      }
    }

    setCurrentPathId(null);
    setRunning(false);
    setDone(true);

    // 剧本回放完成后，调用服务端 API 持久化执行结果
    try {
      await fetch(`/api/projects/${projectId}/advanced-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scripted" }),
      });
    } catch {
      // 持久化失败不影响前端展示，报告页会自动触发服务端剧本回放
    }
  }, [running, model, isDemo, projectId, executePath, pollRunProgress]);

  // 重置（中止正在执行的测试）
  const handleReset = useCallback(async () => {
    if (running) {
      abortRef.current = true;
      // 中止轮询
      if (pollAbortRef.current) {
        pollAbortRef.current.abort();
      }
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      // 停止 AI 思考日志轮询
      stopAiThinkingPoll();
      // 调用服务端中止 API
      if (runId && taskId) {
        try {
          await fetch(
            `/api/projects/${projectId}/advanced-run/${runId}/abort`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ taskId }),
            },
          );
        } catch {
          // 中止失败不阻断
        }
      }
    }
    setRunning(false);
    setDone(false);
    setError(null);
    setCurrentPathId(null);
    setRunId(null);
    setTaskId(null);
    setPrecheckSolution(null);
    setAiThinkingLogs([]);
    lastAiLogIdRef.current = null;
    if (model) {
      const newStates = new Map<string, PathRunState>();
      model.paths.forEach((p) => newStates.set(p.id, "pending"));
      setRunStates(newStates);
      setResults(new Map());
    }
  }, [running, model, runId, taskId, projectId, stopAiThinkingPoll]);

  if (!mounted || !model) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
        <p className="mt-2">正在加载…</p>
      </div>
    );
  }

  // 统计
  const total = model.paths.length;
  const executed = Array.from(runStates.values()).filter(
    (s) => s !== "pending" && s !== "running",
  ).length;
  const passed = Array.from(runStates.values()).filter((s) => s === "pass").length;
  const failed = Array.from(runStates.values()).filter((s) => s === "fail").length;
  const skipped = Array.from(runStates.values()).filter((s) => s === "skip").length;
  const detectedBugs = Array.from(results.values()).filter(
    (r) => r.detectedBugId,
  ).length;
  const progress = total > 0 ? Math.round((executed / total) * 100) : 0;

  return (
    <>
      <PageHeader
        eyebrow="高级业务测试 · 执行"
        title="高级业务测试执行"
        description={`沿测试路径执行行为步骤并记录发现的问题。项目标识：${projectId}`}
        action={
          <div className="flex items-center gap-2">
            {!running && !done && (
              <Button size="sm" onClick={handleStart}>
                <PlayCircle className="h-4 w-4" />
                开始执行
              </Button>
            )}
            {running && (
              <Button size="sm" variant="ghost" onClick={handleReset}>
                中止
              </Button>
            )}
            {done && (
              <Button
                size="sm"
                href={`/projects/${projectId}/advanced/report`}
              >
                查看报告
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 预检失败错误提示（不降级，显示错误原因和解决方案） */}
        {precheckSolution && (
          <div className="flex flex-col gap-3 rounded-xl border border-critical/40 bg-critical-dim/20 px-5 py-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-critical" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge severity="critical">项目无法访问</Badge>
                  <span className="text-sm font-medium text-text">
                    测试无法执行
                  </span>
                </div>
                {error && (
                  <p className="mt-2 text-sm text-text">{error}</p>
                )}
                <div className="mt-3 rounded-lg border border-border bg-bg-2 p-3">
                  <p className="text-xs font-medium text-text-2">解决方案：</p>
                  <pre className="mt-1 whitespace-pre-wrap font-sans text-xs leading-relaxed text-text-2">
                    {precheckSolution}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* 真实执行徽章 */}
        {!precheckSolution && (running || done) && !error && (
          <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent-dim/20 px-5 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
            <Badge severity="pass">真实执行</Badge>
            <span className="text-xs text-text-2">
              已通过预检，使用 Playwright 真实访问被测项目执行测试
            </span>
          </div>
        )}

        {/* AI 思考过程窗口（默认收起，点击展开，位于顶部确保可见） */}
        <AIThinkingPanel
          logs={aiThinkingLogs}
          loading={running}
          title="AI 思考过程"
          emptyText="AI 尚未开始思考，点击「开始执行」后此处会实时显示 AI 的思考与操作过程。"
        />

        {/* 顶部统计 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard
            label="总路径数"
            value={total}
            icon={PlayCircle}
            color="text-accent"
          />
          <StatCard
            label="已执行"
            value={executed}
            icon={CheckCircle2}
            color="text-accent"
          />
          <StatCard
            label="通过"
            value={passed}
            icon={CheckCircle2}
            color="text-accent"
          />
          <StatCard
            label="发现问题"
            value={failed}
            icon={XCircle}
            color="text-critical"
          />
          <StatCard
            label="已跳过"
            value={skipped}
            icon={AlertCircle}
            color="text-warning"
          />
          <StatCard
            label="发现 Bug"
            value={detectedBugs}
            icon={AlertCircle}
            color="text-warning"
          />
        </div>

        {/* 进度条 */}
        <Panel
          title="执行进度"
          description={
            running
              ? `正在执行：${currentLabel ?? "初始化中…"} · 模式：${
                  isDemo ? "剧本回放" : "真实执行"
                }`
              : done
                ? failed > 0
                  ? `执行完成 · 发现 ${failed} 个问题 / ${detectedBugs} 个 Bug`
                  : skipped > 0
                    ? `执行完成 · ${skipped} 条路径需手动验证`
                    : "执行完成 · 全部通过"
                : "点击「开始执行」启动高级业务测试"
          }
        >
          <ProgressBar value={progress} label="执行进度" />
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-critical/30 bg-critical-dim px-3 py-2 text-xs text-critical">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </Panel>

        {/* 路径执行明细 */}
        <Panel
          title="路径执行明细"
          description="逐条展示测试路径的执行状态、步骤与证据。"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border-soft">
            {model.paths.map((path) => {
              const state = runStates.get(path.id) ?? "pending";
              const result = results.get(path.id);
              const isCurrent = currentPathId === path.id;
              return (
                <div
                  key={path.id}
                  ref={isCurrent ? currentPathRef : undefined}
                  className={`px-5 py-4 transition-colors ${
                    isCurrent
                      ? "border-l-2 border-l-accent bg-accent-dim/30"
                      : state === "pending"
                        ? "opacity-60"
                        : ""
                  }`}
                >
                  {/* 路径标题行 */}
                  <div className="flex items-start gap-3">
                    <PathStateIcon state={state} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-text-2">
                          {path.id}
                        </span>
                        <Badge severity={pathTypeSeverity[path.type]}>
                          {pathTypeLabels[path.type]}
                        </Badge>
                        <h4 className="text-sm font-medium text-text">
                          {path.title}
                        </h4>
                        {isCurrent && running && (
                          <Badge severity="accent">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            执行中
                          </Badge>
                        )}
                      </div>

                      {/* 失败时显示问题摘要 */}
                      {state === "fail" && result && (
                        <div className="mt-3 space-y-2 rounded-md border border-critical/20 bg-critical-dim/50 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge severity="critical">
                              {result.detectedBugId ?? "CRITICAL"}
                            </Badge>
                            <Badge severity={severityToBadge[result.severity]}>
                              严重等级：{result.severity}
                            </Badge>
                            <span className="text-xs text-text-3">
                              · 耗时 {result.durationMs}ms
                            </span>
                          </div>
                          <p className="text-xs text-critical">
                            <span className="font-medium">实际行为：</span>
                            {result.actualBehavior}
                          </p>
                          <p className="text-xs text-text-2">
                            <span className="font-medium">影响范围：</span>
                            {result.impactScope}
                          </p>
                        </div>
                      )}

                      {/* 跳过时显示需手动验证摘要 */}
                      {state === "skip" && result && (
                        <div className="mt-3 space-y-2 rounded-md border border-warning/20 bg-warning-dim/30 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge severity="warning">需手动验证</Badge>
                            <Badge severity={severityToBadge[result.severity]}>
                              严重等级：{result.severity}
                            </Badge>
                            <span className="text-xs text-text-3">
                              · 耗时 {result.durationMs}ms
                            </span>
                          </div>
                          <p className="text-xs text-text-2">
                            <span className="font-medium">实际行为：</span>
                            {result.actualBehavior}
                          </p>
                          <p className="text-xs text-text-3">
                            <span className="font-medium">影响范围：</span>
                            {result.impactScope}
                          </p>
                        </div>
                      )}

                      {/* 通过时显示摘要 */}
                      {state === "pass" && result && (
                        <div className="mt-2 rounded-md border border-accent/20 bg-accent-dim/30 px-3 py-2">
                          <p className="text-xs text-accent">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            {result.actualBehavior}
                          </p>
                        </div>
                      )}

                      {/* 执行步骤与证据（仅在已执行后展示） */}
                      {result && result.steps.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs font-medium text-text-3">
                            执行证据（{result.steps.length} 步）：
                          </p>
                          {result.steps.map((step) => (
                            <div
                              key={step.index}
                              className="rounded-md border border-border-soft bg-bg-2 px-3 py-2"
                            >
                              <div className="flex items-start gap-2">
                                <span className="font-mono text-xs text-accent">
                                  #{step.index}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs text-text">
                                    {step.action}
                                  </p>
                                  <StepEvidenceIcons step={step} />

                                  {/* 截图描述 */}
                                  {step.screenshotDesc && (
                                    <div className="mt-1.5">
                                      <p className="text-xs font-medium text-accent">
                                        <Camera className="mr-1 inline h-3 w-3" />
                                        截图描述：
                                      </p>
                                      <p className="mt-0.5 text-xs text-text-2">
                                        {step.screenshotDesc}
                                      </p>
                                    </div>
                                  )}

                                  {/* Console 日志 */}
                                  {step.consoleLog && (
                                    <div className="mt-1.5">
                                      <p className="text-xs font-medium text-info">
                                        <Terminal className="mr-1 inline h-3 w-3" />
                                        Console：
                                      </p>
                                      <pre className="mt-0.5 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-xs text-text-2">
                                        {step.consoleLog}
                                      </pre>
                                    </div>
                                  )}

                                  {/* 网络请求 */}
                                  {step.networkRequest && (
                                    <div className="mt-1.5">
                                      <p className="text-xs font-medium text-warning">
                                        <Network className="mr-1 inline h-3 w-3" />
                                        网络请求：
                                      </p>
                                      <pre className="mt-0.5 overflow-x-auto rounded bg-surface-2 p-1.5 font-mono text-xs text-text-2">
                                        {step.networkRequest}
                                      </pre>
                                    </div>
                                  )}

                                  {/* 数据变化 */}
                                  {step.dataChange && (
                                    <div className="mt-1.5">
                                      <p className="text-xs font-medium text-critical">
                                        <Database className="mr-1 inline h-3 w-3" />
                                        数据变化：
                                      </p>
                                      <p className="mt-0.5 text-xs text-text-2">
                                        {step.dataChange}
                                      </p>
                                    </div>
                                  )}

                                  {/* 状态对比 */}
                                  {step.stateBefore && step.stateAfter && (
                                    <div className="mt-1.5 flex items-center gap-2 text-xs">
                                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text-2">
                                        {step.stateBefore}
                                      </span>
                                      <ArrowLeftRight className="h-3 w-3 text-accent" />
                                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-text">
                                        {step.stateAfter}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <Badge severity={stateSeverity[state]}>
                      {stateLabel[state]}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* 底部操作 */}
        {done && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-text">
                执行完成 · 通过 {passed} / 发现问题{" "}
                {failed} / 已跳过 {skipped} / 发现 Bug {detectedBugs}
              </p>
              <p className="mt-0.5 text-xs text-text-2">
                {failed > 0
                  ? `发现 ${detectedBugs} 个已确认 Bug，查看报告获取完整证据与 AI 修复指令。`
                  : skipped > 0
                    ? `${skipped} 条路径需手动验证，查看报告获取测试路径详情与验证指引。`
                    : "所有路径通过，可进入复测阶段。"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <RefreshCw className="h-4 w-4" />
                重新执行
              </Button>
              <Button size="sm" href={`/projects/${projectId}/advanced/report`}>
                查看报告
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// 路径状态图标
function PathStateIcon({ state }: { state: PathRunState }) {
  switch (state) {
    case "pass":
      return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />;
    case "fail":
      return <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />;
    case "skip":
      return <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />;
    case "running":
      return <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />;
    default:
      return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-text-3" />;
  }
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

// ============================================================
// 剧本回放：模拟路径执行结果（与 advanced-test-runner.ts 保持一致）
// ============================================================

function simulatePathResult(
  path: TestPath,
  projectId: string,
): AdvancedPathResult {
  const resultId = `advres_${Math.random().toString(36).slice(2, 10)}`;
  const durationMs = 1000 + Math.floor(Math.random() * 1000);
  const executedAt = new Date().toISOString();

  // 默认通过
  const baseResult: AdvancedPathResult = {
    id: resultId,
    runId: `advrun_${projectId}`,
    pathId: path.id,
    pathType: path.type,
    title: path.title,
    status: "pass",
    severity: "low",
    confidence: "high",
    expectedBehavior: path.expectedBehavior,
    actualBehavior: "执行通过",
    impactScope: "无",
    steps: [],
    executedAt,
    durationMs,
  };

  switch (path.id) {
    case "PATH-001":
      return {
        ...baseResult,
        actualBehavior: "签到成功后积分 +10，按钮变灰，刷新后状态保持",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，进入签到页",
            screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
            consoleLog: "[Auth] 登录成功\n[Network] GET /api/sign/status 200 → { signed: false }",
            networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
            apiResponse: '{ "signed": false, "points": 0 }',
            dataChange: "SignRecord 表：0 条；User.points：0",
            stateBefore: "未签到，积分 0",
            stateAfter: "未签到，积分 0",
          },
          {
            index: 2,
            action: "点击签到按钮",
            screenshotDesc: "签到成功提示「+10 积分」，按钮变灰显示「今日已签到」",
            consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }",
            networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
            apiResponse: '{ "success": true, "points": 10 }',
            dataChange: "积分：0 → 10（+10）；签到记录：0 → 1 条",
            stateBefore: "未签到，积分 0",
            stateAfter: "已签到，积分 10",
          },
          {
            index: 3,
            action: "刷新页面",
            screenshotDesc: "刷新后签到状态保持「今日已签到」，按钮仍为灰色",
            consoleLog: "[Network] GET /api/sign/status 200 → { signed: true }",
            networkRequest: "GET /api/sign/status 200 → { signed: true, points: 10 }",
            apiResponse: '{ "signed": true, "points": 10 }',
            dataChange: "无变化（状态保持）",
            stateBefore: "已签到，积分 10",
            stateAfter: "已签到，积分 10",
          },
        ],
      };

    case "PATH-002":
      // Bug 1：无限签到
      return {
        ...baseResult,
        status: "fail",
        severity: "critical",
        detectedBugId: "BUG-001",
        actualBehavior:
          "100 次签到全部成功，积分从 0 增长到 1000，SignRecord 表新增 100 条记录（应仅 1 条）",
        impactScope:
          "激励系统核心：签到接口无频率限制，用户可无限领取积分，破坏积分经济体系与游戏平衡",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，确保今日未签到",
            screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
            consoleLog: "[Auth] 登录成功\n[Network] GET /api/sign/status 200 → { signed: false }",
            networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
            dataChange: "SignRecord 表：0 条；User.points：0",
            stateBefore: "未签到，积分 0",
            stateAfter: "未签到，积分 0",
          },
          {
            index: 2,
            action: "使用脚本在 10 秒内连续点击签到按钮 100 次",
            screenshotDesc: "签到按钮连续点击 100 次，每次点击后弹窗显示「签到成功 +10 积分」，积分从 0 增长到 1000",
            consoleLog: "[Network] POST /api/sign 200 × 100 次（应仅 1 次 200，99 次 409）",
            networkRequest: "POST /api/sign 200 → { success: true, points: +10 } × 100 次",
            apiResponse: '{ "success": true, "points": 10 } × 100',
            dataChange: "积分：0 → 1000（+1000）；签到记录：0 → 100 条",
            stateBefore: "未签到，积分 0",
            stateAfter: "已签到 100 次，积分 1000",
          },
          {
            index: 3,
            action: "查询 SignRecord 表，统计今日签到记录数",
            screenshotDesc: "数据库查询结果：SignRecord 表今日记录 100 条",
            consoleLog: "[DB] SELECT COUNT(*) FROM SignRecord WHERE userId=u_001 AND date=today → 100",
            networkRequest: "GET /api/sign/history 200 → { records: [...100 条] }",
            dataChange: "SignRecord 表今日记录：100 条（违反 INV-002）",
            stateBefore: "预期签到记录：1 条",
            stateAfter: "实际签到记录：100 条",
          },
        ],
      };

    case "PATH-003":
      // Bug 2：双击重复
      return {
        ...baseResult,
        status: "fail",
        severity: "critical",
        detectedBugId: "BUG-002",
        actualBehavior:
          "100ms 内双击签到，两次请求均返回 200 成功，积分 +20（应 +10），SignRecord 表新增 2 条记录",
        impactScope:
          "激励系统：并发请求未做幂等控制，用户可通过快速双击重复领取积分",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，确保今日未签到",
            screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
            consoleLog: "[Auth] 登录成功",
            networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
            dataChange: "SignRecord 表：0 条；User.points：0",
            stateBefore: "未签到，积分 0",
            stateAfter: "未签到，积分 0",
          },
          {
            index: 2,
            action: "使用脚本在 100ms 内连续触发 2 次 POST /api/sign",
            screenshotDesc: "浏览器 Network 面板显示 2 个 POST /api/sign 请求，时间戳相差 87ms，均返回 200",
            consoleLog: "[Network] POST /api/sign 200 (87ms 后) POST /api/sign 200",
            networkRequest: "POST /api/sign 200 → { success: true, points: +10 } × 2（间隔 87ms）",
            apiResponse: '{ "success": true, "points": 10 } × 2',
            dataChange: "积分：0 → 20（+20，应为 +10）；签到记录：0 → 2 条",
            stateBefore: "未签到，积分 0",
            stateAfter: "已签到 2 次，积分 20",
          },
          {
            index: 3,
            action: "查询 SignRecord 表，统计今日签到记录数",
            screenshotDesc: "数据库查询结果：SignRecord 表今日记录 2 条，时间戳相差 87ms",
            consoleLog: "[DB] SELECT * FROM SignRecord WHERE userId=u_001 AND date=today → 2 条记录",
            dataChange: "SignRecord 表今日记录：2 条（违反 INV-002）",
            stateBefore: "预期签到记录：1 条",
            stateAfter: "实际签到记录：2 条",
          },
        ],
      };

    case "PATH-004":
      // Bug 3：刷新可再签
      return {
        ...baseResult,
        status: "fail",
        severity: "high",
        detectedBugId: "BUG-003",
        actualBehavior:
          "签到后刷新页面，签到状态丢失（signed=true → signed=false），可再次签到，积分再次 +10",
        impactScope:
          "激励系统：签到状态未正确持久化或前端未读取后端状态，用户可通过刷新绕过每日一次限制",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，确保今日未签到",
            screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
            consoleLog: "[Auth] 登录成功",
            networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
            dataChange: "SignRecord 表：0 条；User.points：0",
            stateBefore: "未签到，积分 0",
            stateAfter: "未签到，积分 0",
          },
          {
            index: 2,
            action: "点击签到按钮，签到成功，积分 +10",
            screenshotDesc: "签到成功提示「+10 积分」，按钮变灰显示「今日已签到」，积分余额：10",
            consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }",
            networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
            dataChange: "积分：0 → 10（+10）；签到记录：0 → 1 条",
            stateBefore: "未签到，积分 0",
            stateAfter: "已签到，积分 10",
          },
          {
            index: 3,
            action: "刷新浏览器（F5）",
            screenshotDesc: "刷新后签到页重新渲染，「每日签到」按钮恢复为可点击状态",
            consoleLog: "[Network] GET /api/sign/status 200 → { signed: false }（应为 signed: true）",
            networkRequest: "GET /api/sign/status 200 → { signed: false, points: 10 }",
            apiResponse: '{ "signed": false, "points": 10 }（signed 应为 true）',
            dataChange: "前端状态：signed=true → signed=false（刷新后丢失）",
            stateBefore: "已签到，按钮灰色",
            stateAfter: "未签到（前端状态丢失），按钮可点击",
          },
          {
            index: 4,
            action: "再次点击签到按钮，签到成功，积分再次 +10",
            screenshotDesc: "签到成功提示「+10 积分」，积分余额：20（应为 10）",
            consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }",
            networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
            dataChange: "积分：10 → 20（+10，违规）；签到记录：1 → 2 条",
            stateBefore: "已签到 1 次，积分 10",
            stateAfter: "已签到 2 次，积分 20",
          },
        ],
      };

    case "PATH-005":
      // Bug 4：跳关
      return {
        ...baseResult,
        status: "fail",
        severity: "high",
        detectedBugId: "BUG-004",
        actualBehavior:
          "直接访问 /level/3 未被拦截，可答题并获得积分，Progress 表新增关卡 3 的 completed 记录",
        impactScope:
          "学习系统：关卡解锁校验缺失，用户可跳过前置关卡直接答题获得积分，破坏学习路径与进度体系",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，确保未完成任何关卡",
            screenshotDesc: "首页关卡列表：关卡 1 显示「进入」，关卡 2/3 显示「锁定」",
            consoleLog: "[Network] GET /api/level 200 → levels[0].status=locked",
            networkRequest: "GET /api/level 200 → [{ id:1, status:locked }, ...]",
            dataChange: "Progress 表：0 条 completed 记录",
            stateBefore: "未完成任何关卡",
            stateAfter: "未完成任何关卡",
          },
          {
            index: 2,
            action: "直接访问 /level/3（绕过首页关卡列表的解锁校验）",
            screenshotDesc: "关卡 3 详情页正常渲染，显示题目与答题表单（应被拦截或重定向到 /level/1）",
            consoleLog: "[Network] GET /api/level/3 200 → { id:3, title:'关卡3', question:'...' }",
            networkRequest: "GET /api/level/3 200 → { id: 3, question: '...', status: 'locked' }",
            apiResponse: '{ "id": 3, "question": "关卡3题目", "status": "locked" }',
            stateBefore: "未访问关卡 3",
            stateAfter: "关卡 3 页面已渲染",
          },
          {
            index: 3,
            action: "输入正确答案并提交",
            screenshotDesc: "提交后显示「回答正确 +10 积分」，关卡 3 状态变为 completed",
            consoleLog: "[Network] POST /api/level/3/answer 200 → { correct: true, points: +10 }",
            networkRequest: "POST /api/level/3/answer 200 → { correct: true, points: 10 }",
            apiResponse: '{ "correct": true, "points": 10 }',
            dataChange: "积分：0 → 10（+10）；Progress 表新增关卡 3 的 completed 记录（违反 INV-004）",
            stateBefore: "关卡 3 未完成",
            stateAfter: "关卡 3 已完成（违规）",
          },
          {
            index: 4,
            action: "查询 Progress 表，检查关卡 3 的 status",
            screenshotDesc: "数据库查询结果：Progress 表存在 (userId=u_001, levelId=3, status=completed) 记录",
            consoleLog: "[DB] SELECT * FROM Progress WHERE userId=u_001 → [{ levelId:3, status:completed }]",
            dataChange: "Progress 表：关卡 3 status=completed（违反 INV-004）",
            stateBefore: "预期：关卡 3 不可完成",
            stateAfter: "实际：关卡 3 已完成",
          },
        ],
      };

    case "PATH-006":
      // Bug 6：积分不足兑换
      return {
        ...baseResult,
        status: "fail",
        severity: "critical",
        detectedBugId: "BUG-006",
        actualBehavior:
          "0 积分兑换 100 积分奖励成功，积分未扣减（仍为 0），ExchangeRecord 表新增 1 条记录，库存 -1",
        impactScope:
          "激励系统·兑换模块：积分余额校验缺失，用户可 0 成本兑换任意奖励，造成库存损失与积分经济崩溃",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，确保积分为 0",
            screenshotDesc: "积分页显示余额：0；奖励页显示「100 积分奖励」可兑换",
            consoleLog: "[Network] GET /api/points 200 → { points: 0 }",
            networkRequest: "GET /api/points 200 → { points: 0 }\nGET /api/rewards 200 → [{ id:1, cost:100, stock:10 }]",
            dataChange: "User.points：0；ExchangeRecord 表：0 条",
            stateBefore: "积分 0",
            stateAfter: "积分 0",
          },
          {
            index: 2,
            action: "进入奖励页，选择价值 100 积分的奖励，点击兑换按钮",
            screenshotDesc: "奖励卡片显示「兑换（需 100 积分）」，按钮可点击（应禁用或拦截）",
            consoleLog: "[UI] 兑换按钮可点击（应禁用）",
            stateBefore: "积分 0",
            stateAfter: "积分 0",
          },
          {
            index: 3,
            action: "点击兑换（或直接调用 POST /api/exchange）",
            screenshotDesc: "兑换成功提示「兑换成功」，奖励已发放，积分仍为 0",
            consoleLog: "[Network] POST /api/exchange 200 → { success: true }（应 400 积分不足）",
            networkRequest: "POST /api/exchange 200 → { success: true, rewardId: 1 }",
            apiResponse: '{ "success": true, "rewardId": 1 }（应返回 400 { error: "积分不足" }）',
            dataChange: "积分：0 → 0（未扣减，违规）；ExchangeRecord 表新增 1 条；Reward 表 stock：10 → 9",
            stateBefore: "积分 0，库存 10",
            stateAfter: "积分 0（未扣减），库存 9，兑换记录 +1",
          },
          {
            index: 4,
            action: "查询 User.points 与 ExchangeRecord 表",
            screenshotDesc: "数据库查询结果：User.points=0，ExchangeRecord 表新增 1 条记录",
            consoleLog: "[DB] SELECT points FROM User WHERE id=u_001 → 0（违规）",
            dataChange: "User.points：0（违反 INV-005：积分余额必须与签到+答题-兑换的汇总一致）",
            stateBefore: "预期：积分不足，兑换失败",
            stateAfter: "实际：兑换成功，积分未扣减",
          },
        ],
      };

    case "PATH-007":
      // 跨功能综合验证：通过
      return {
        ...baseResult,
        actualBehavior:
          "完成关卡获得 10 积分，兑换 5 积分奖励后余额正确为 5，积分扣减逻辑正确",
        steps: [
          {
            index: 1,
            action: "用户 learner_test 登录，记录初始积分 P0=0",
            screenshotDesc: "积分页显示余额：0",
            consoleLog: "[Network] GET /api/points 200 → { points: 0 }",
            dataChange: "P0 = 0",
            stateBefore: "积分 0",
            stateAfter: "积分 0",
          },
          {
            index: 2,
            action: "完成关卡 1，获得 10 积分",
            screenshotDesc: "答题正确提示「+10 积分」，积分余额：10",
            consoleLog: "[Network] POST /api/level/1/answer 200 → { correct: true, points: +10 }",
            dataChange: "积分：0 → 10（P1 = P0 + 10 = 10）",
            stateBefore: "积分 0",
            stateAfter: "积分 10",
          },
          {
            index: 3,
            action: "兑换价值 5 积分的奖励",
            screenshotDesc: "兑换成功提示「兑换成功」，积分余额：5",
            consoleLog: "[Network] POST /api/exchange 200 → { success: true }",
            dataChange: "积分：10 → 5（P2 = P1 - 5 = 5）；ExchangeRecord 表 +1 条",
            stateBefore: "积分 10",
            stateAfter: "积分 5",
          },
          {
            index: 4,
            action: "验证 P2 = P1 - 5 = 5，查询 ExchangeRecord 表",
            screenshotDesc: "积分余额：5，兑换记录 1 条，库存 -1",
            consoleLog: "[DB] SELECT points FROM User → 5",
            dataChange: "P2 = 5 = P1 - 5 ✓（积分扣减正确）",
            stateBefore: "预期：P2 = 5",
            stateAfter: "实际：P2 = 5 ✓",
          },
        ],
      };

    default:
      return baseResult;
  }
}
