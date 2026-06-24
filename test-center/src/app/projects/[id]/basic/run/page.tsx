"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  SkipForward,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  categoryLabels,
  categoryOrder,
  getOrGenerateBasicCases,
} from "@/lib/basic-test-cases";
import { getProject, type TestCase, type TestResult, type ResultStatus } from "@/lib/store";

// 用例执行状态（用于 UI 实时展示）
type CaseRunState = "pending" | "running" | "pass" | "fail" | "block" | "skip";

// 状态 → Badge severity
const stateSeverity: Record<
  CaseRunState,
  "pass" | "critical" | "warning" | "info" | "accent"
> = {
  pending: "info",
  running: "accent",
  pass: "pass",
  fail: "critical",
  block: "warning",
  skip: "info",
};

const stateLabel: Record<CaseRunState, string> = {
  pending: "待执行",
  running: "执行中",
  pass: "通过",
  fail: "失败",
  block: "阻断",
  skip: "跳过",
};

// 状态 → 图标
function StateIcon({ state }: { state: CaseRunState }) {
  switch (state) {
    case "pass":
      return <CheckCircle2 className="h-4 w-4 text-accent" />;
    case "fail":
      return <XCircle className="h-4 w-4 text-critical" />;
    case "block":
      return <Ban className="h-4 w-4 text-warning" />;
    case "skip":
      return <SkipForward className="h-4 w-4 text-text-3" />;
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-accent" />;
    default:
      return <span className="h-2 w-2 rounded-full bg-text-3" />;
  }
}

export default function BasicRunPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [runStates, setRunStates] = useState<Map<string, CaseRunState>>(
    new Map(),
  );
  const [results, setResults] = useState<Map<string, TestResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const abortRef = useRef(false);
  const currentCaseRef = useRef<HTMLDivElement | null>(null);
  // 异步任务相关
  const [runId, setRunId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const restoreRef = useRef(false);

  // 当前执行项变化时自动滚动到视口
  useEffect(() => {
    if (currentCaseRef.current) {
      currentCaseRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentCaseId]);

  // 初始化用例 + 加载项目信息（判断是否为演示项目）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = getOrGenerateBasicCases(projectId);
      if (cancelled) return;
      setCases(list);
      const initialStates = new Map<string, CaseRunState>();
      list.forEach((c) => initialStates.set(c.id, "pending"));
      setRunStates(initialStates);
      setMounted(true);

      // 从服务端获取项目信息，判断是否为演示项目
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          const project = data.project;
          if (project?.isDemo) {
            setIsDemo(true);
          }
        }
      } catch {
        // 获取失败时忽略，默认非演示项目
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 执行单个用例的模拟（剧本回放）
  const executeCase = useCallback(
    async (tc: TestCase): Promise<TestResult> => {
      // 模拟 0.5-1.5 秒执行耗时
      const delayMs = 500 + Math.floor(Math.random() * 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      // 剧本回放：BTC-015 失败（Bug 5），其他通过
      if (tc.id === "BTC-015") {
        return {
          id: `res_${Math.random().toString(36).slice(2, 10)}`,
          runId: `run_${projectId}`,
          testCaseId: tc.id,
          status: "fail" as ResultStatus,
          failedStep: "步骤 5：刷新后回到首页或关卡详情页查看进度",
          expected:
            "刷新后关卡仍显示为已完成状态，下一关已解锁，已完成关卡不可重复答题",
          actual:
            "刷新后关卡仍显示为锁定 / 未完成状态，可重复答题，进度未持久化",
          evidenceIds: [],
          severity: "high",
          confidence: "high",
          impactScope:
            "学习进度模块：影响关卡解锁、答题积分路径、用户学习记录",
          executedAt: new Date().toISOString(),
        };
      }

      return {
        id: `res_${Math.random().toString(36).slice(2, 10)}`,
        runId: `run_${projectId}`,
        testCaseId: tc.id,
        status: "pass" as ResultStatus,
        evidenceIds: [],
        severity: "low",
        confidence: "high",
        impactScope: "无",
        executedAt: new Date().toISOString(),
      };
    },
    [projectId],
  );

  // 轮询测试运行进度
  const pollRunProgress = useCallback(async (targetRunId: string) => {
    pollAbortRef.current = new AbortController();

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/basic-run/${targetRunId}`,
          { signal: pollAbortRef.current?.signal },
        );
        if (!res.ok) {
          throw new Error(`查询进度失败 (${res.status})`);
        }
        const data = await res.json();
        const serverRun = data.run;
        const serverResults: TestResult[] = data.results || [];

        // 更新已完成的用例状态（根据 progress.current 区分 pending/running）
        const newResultMap = new Map<string, TestResult>();
        const newRunStatesMap = new Map<string, CaseRunState>();
        const currentProgress = data.progress as { current: number; total: number; currentLabel?: string } | undefined;
        const currentIdx = currentProgress?.current ?? 0;

        for (let idx = 0; idx < cases.length; idx++) {
          const tc = cases[idx];
          const result = serverResults.find((r) => r.testCaseId === tc.id);
          if (result) {
            // 已有结果：根据结果状态显示
            newResultMap.set(tc.id, result);
            newRunStatesMap.set(tc.id, result.status as CaseRunState);
          } else if (idx + 1 === currentIdx) {
            // 当前正在执行的项（progress.current 是 1-based）
            newRunStatesMap.set(tc.id, "running");
          } else if (idx + 1 < currentIdx) {
            // 已过但无结果（异常情况，可能正在保存中），标记为 running
            newRunStatesMap.set(tc.id, "running");
          } else {
            // 未轮到的项：保持 pending
            newRunStatesMap.set(tc.id, "pending");
          }
        }

        setResults(newResultMap);
        setRunStates(newRunStatesMap);

        // 更新当前执行项（用于高亮和进度条显示）
        if (currentProgress && currentProgress.current > 0) {
          const currentCase = cases[currentProgress.current - 1];
          if (currentCase) {
            setCurrentCaseId(currentCase.id);
            setCurrentLabel(currentProgress.currentLabel ?? currentCase.title);
          }
        }

        // 检查是否完成
        if (serverRun.status === "done" || serverRun.status === "failed") {
          setCurrentCaseId(null);
          setRunning(false);
          setDone(true);
          if (serverRun.status === "failed" && serverRun.error) {
            setError(`测试执行失败：${serverRun.error}`);
          }
          // 完成后清除 localStorage
          try {
            window.localStorage.removeItem(`test-center:basic-run:${projectId}`);
          } catch {
            // localStorage 操作失败不阻断
          }
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
  }, [projectId, cases]);

  // 开始执行
  // 执行方式由项目类型决定：演示项目→剧本回放，非演示项目→真实执行
  const handleStart = useCallback(async () => {
    if (running) return;
    if (cases.length === 0) {
      setError("项目尚未分析或无可用用例，无法执行测试。请先完成项目分析。");
      return;
    }
    abortRef.current = false;
    setRunning(true);
    setDone(false);
    setError(null);
    setRunId(null);
    setTaskId(null);

    // 重置所有状态
    const newStates = new Map<string, CaseRunState>();
    cases.forEach((c) => newStates.set(c.id, "pending"));
    setRunStates(newStates);
    setResults(new Map());

    // ============================================================
    // 非演示项目：真实执行（异步任务 + 轮询进度）
    // 失败时明确报错，引导用户检查被测项目是否已启动
    // ============================================================
    if (!isDemo) {
      try {
        // 不再标记所有用例为 running，保持 pending 状态
        // 轮询会根据 progress.current 精确控制每项状态
        setCurrentCaseId(null);

        // POST 启动异步任务
        const startRes = await fetch(
          `/api/projects/${projectId}/basic-run`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "real" }),
          },
        );

        if (!startRes.ok) {
          const errBody = await startRes.json().catch(() => ({}));
          throw new Error(
            errBody.detail || errBody.error || `启动测试失败 (${startRes.status})`,
          );
        }

        const startData = await startRes.json();
        const newRunId: string = startData.runId;
        const newTaskId: string = startData.taskId;
        setRunId(newRunId);
        setTaskId(newTaskId);

        // 持久化到 localStorage，便于刷新后恢复
        try {
          window.localStorage.setItem(
            `test-center:basic-run:${projectId}`,
            JSON.stringify({ runId: newRunId, taskId: newTaskId }),
          );
        } catch {
          // localStorage 操作失败不阻断
        }

        // 开始轮询进度
        await pollRunProgress(newRunId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setError(
          `真实执行失败：${errMsg}\n\n请检查：\n1. 被测项目是否已启动（如 npm run dev）\n2. 测试地址是否可访问\n3. 测试账号密码是否正确\n4. chromium 是否已安装（npx playwright install chromium）\n\n修正后点击「重新执行」重试。`,
        );
        setRunning(false);
        setDone(true);
        setCurrentCaseId(null);
      }
      return;
    }

    // ============================================================
    // 演示项目：剧本回放（客户端模拟执行）
    // 阻断范围：按模块阻断（同模块后续用例跳过），不阻断其他模块
    // ============================================================
    const blockedCategories = new Set<string>();

    // 逐个执行
    for (let i = 0; i < cases.length; i++) {
      if (abortRef.current) break;
      const tc = cases[i];

      // 同模块已阻断则跳过
      if (blockedCategories.has(tc.category)) {
        setRunStates((prev) => {
          const next = new Map(prev);
          next.set(tc.id, "skip");
          return next;
        });
        continue;
      }

      // 标记为执行中
      setCurrentCaseId(tc.id);
      setRunStates((prev) => {
        const next = new Map(prev);
        next.set(tc.id, "running");
        return next;
      });

      try {
        const result = await executeCase(tc);

        // 标记结果
        setResults((prev) => {
          const next = new Map(prev);
          next.set(tc.id, result);
          return next;
        });
        setRunStates((prev) => {
          const next = new Map(prev);
          next.set(tc.id, result.status);
          return next;
        });

        // 检查阻断条件：仅阻断同模块
        if (
          result.status === "fail" &&
          tc.blockingLevel === "blocking" &&
          (tc.category === "env" || tc.category === "page")
        ) {
          blockedCategories.add(tc.category);
        }
      } catch (err) {
        setError(`用例 ${tc.id} 执行失败：${(err as Error).message}`);
        break;
      }
    }

    setCurrentCaseId(null);
    setRunning(false);
    setDone(true);

    // 剧本回放完成后，调用服务端 API 持久化执行结果
    // 这样报告页可以直接从服务端读取数据生成报告
    try {
      await fetch(`/api/projects/${projectId}/basic-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scripted" }),
      });
    } catch {
      // 持久化失败不影响前端展示，报告页会自动触发服务端剧本回放
    }
  }, [running, cases, isDemo, projectId, executeCase, pollRunProgress]);

  // 重新执行（中止正在执行的测试）
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
      // 调用服务端中止 API
      if (runId && taskId) {
        try {
          await fetch(
            `/api/projects/${projectId}/basic-run/${runId}/abort`,
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
    setCurrentCaseId(null);
    setRunId(null);
    setTaskId(null);
    // 清除 localStorage
    try {
      window.localStorage.removeItem(`test-center:basic-run:${projectId}`);
    } catch {
      // localStorage 操作失败不阻断
    }
    const newStates = new Map<string, CaseRunState>();
    cases.forEach((c) => newStates.set(c.id, "pending"));
    setRunStates(newStates);
    setResults(new Map());
  }, [running, cases, runId, taskId, projectId]);

  // 恢复未完成的测试运行（从 localStorage）
  useEffect(() => {
    if (!mounted || cases.length === 0 || restoreRef.current) return;
    restoreRef.current = true;
    try {
      const stored = window.localStorage.getItem(`test-center:basic-run:${projectId}`);
      if (!stored) return;
      const { runId: storedRunId, taskId: storedTaskId } = JSON.parse(stored);
      if (!storedRunId) return;
      // 恢复运行状态
      setRunId(storedRunId);
      setTaskId(storedTaskId);
      setRunning(true);
      setDone(false);
      setCurrentCaseId("real-execution");
      // 标记所有用例为执行中
      const newStates = new Map<string, CaseRunState>();
      cases.forEach((c) => newStates.set(c.id, "running"));
      setRunStates(newStates);
      // 开始轮询
      pollRunProgress(storedRunId);
    } catch {
      // localStorage 解析失败不阻断
    }
  }, [mounted, cases, projectId, pollRunProgress]);

  if (!mounted) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
        <p className="mt-2">正在加载…</p>
      </div>
    );
  }

  // 统计
  const total = cases.length;
  const executed = Array.from(runStates.values()).filter(
    (s) => s !== "pending" && s !== "running",
  ).length;
  const passed = Array.from(runStates.values()).filter((s) => s === "pass").length;
  const failed = Array.from(runStates.values()).filter((s) => s === "fail").length;
  const blocked = Array.from(runStates.values()).filter((s) => s === "block").length;
  const skipped = Array.from(runStates.values()).filter((s) => s === "skip").length;
  const progress = total > 0 ? Math.round((executed / total) * 100) : 0;
  const passRate = executed > 0 ? Math.round((passed / executed) * 100) : 0;

  // 按 6 大类分组
  const grouped = categoryOrder
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat],
      cases: cases.filter((c) => c.category === cat),
    }))
    .filter((g) => g.cases.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="基础测试 · 执行"
        title="基础测试执行"
        description={`实时跟踪执行进度与结果。项目标识：${projectId}`}
        action={
          <div className="flex items-center gap-2">
            {/* 执行方式标签：由项目类型决定，不可切换 */}
            <span className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-2">
              {isDemo ? "剧本回放" : "真实执行"}
            </span>
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
                href={`/projects/${projectId}/basic/report`}
              >
                查看报告
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 顶部统计 */}
        <div className="grid gap-4 sm:grid-cols-5">
          <StatCard label="总用例数" value={total} icon={PlayCircle} color="text-accent" />
          <StatCard label="已执行" value={executed} icon={CheckCircle2} color="text-accent" />
          <StatCard label="通过" value={passed} icon={CheckCircle2} color="text-accent" />
          <StatCard label="失败" value={failed} icon={XCircle} color="text-critical" />
          <StatCard label="阻断" value={blocked} icon={Ban} color="text-warning" />
        </div>

        {/* 进度条 */}
        <Panel
          title="执行进度"
          description={
            running
              ? `正在执行：${currentLabel ?? "初始化中…"} · ${isDemo ? "剧本回放" : "真实执行"}`
              : done
                ? `执行完成 · 通过率 ${passRate}%`
                : "点击「开始执行」启动测试"
          }
        >
          <ProgressBar value={progress} label="执行进度" />
          <div className="mt-4">
            <ProgressBar
              value={passRate}
              label="通过率"
              tone={passRate >= 80 ? "accent" : "warning"}
            />
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-critical/30 bg-critical-dim px-3 py-2 text-xs text-critical">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </Panel>

        {/* 用例执行明细 */}
        <Panel
          title="用例执行明细"
          description="按 6 大类分组展示每条用例的实时状态。"
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border-soft">
            {grouped.map((group) => (
              <div key={group.category}>
                {/* 分组标题 */}
                <div className="flex items-center gap-2 bg-bg-2 px-5 py-2">
                  <span className="font-mono text-xs text-accent">
                    {String(categoryOrder.indexOf(group.category) + 1).padStart(2, "0")}
                  </span>
                  <span className="text-xs font-medium text-text-2">
                    {group.label}
                  </span>
                  <span className="text-xs text-text-3">
                    · {group.cases.length} 个用例
                  </span>
                </div>
                {/* 用例列表 */}
                {group.cases.map((tc) => {
                  const state = runStates.get(tc.id) ?? "pending";
                  const result = results.get(tc.id);
                  const isCurrent = currentCaseId === tc.id;
                  return (
                    <div
                      key={tc.id}
                      ref={isCurrent ? currentCaseRef : undefined}
                      className={`border-b border-border-soft px-5 py-3 transition-colors last:border-b-0 ${
                        isCurrent
                          ? "border-l-2 border-l-accent bg-accent-dim/30"
                          : state === "pending"
                            ? "opacity-60"
                            : ""
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <StateIcon state={state} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-text-2">
                              {tc.id}
                            </span>
                            <span className="text-sm text-text">
                              {tc.title}
                            </span>
                          </div>
                          {/* 失败时显示失败步骤与原因 */}
                          {state === "fail" && result && (
                            <div className="mt-2 space-y-1.5 rounded-md border border-critical/20 bg-critical-dim/50 px-3 py-2">
                              <p className="text-xs text-critical">
                                <span className="font-medium">失败步骤：</span>
                                {result.failedStep}
                              </p>
                              <p className="text-xs text-text-2">
                                <span className="font-medium">预期：</span>
                                {result.expected}
                              </p>
                              <p className="text-xs text-text-2">
                                <span className="font-medium">实际：</span>
                                {result.actual}
                              </p>
                              <p className="text-xs text-text-3">
                                <span className="font-medium">影响范围：</span>
                                {result.impactScope}
                              </p>
                            </div>
                          )}
                          {/* 跳过时显示原因 */}
                          {state === "skip" && (
                            <p className="mt-1 text-xs text-text-3">
                              因前置模块阻断而跳过
                            </p>
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
            ))}
          </div>
        </Panel>

        {/* 底部操作 */}
        {done && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-text">
                执行完成 · 通过 {passed} / 失败 {failed}
                {blocked > 0 && ` / 阻断 ${blocked}`}
                {skipped > 0 && ` / 跳过 ${skipped}`}
              </p>
              <p className="mt-0.5 text-xs text-text-2">
                {failed > 0
                  ? "存在失败用例，查看报告获取完整修复指南包。"
                  : "所有用例通过，可进入高级业务测试。"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={handleReset}>
                <RefreshCw className="h-4 w-4" />
                重新执行
              </Button>
              <Button size="sm" href={`/projects/${projectId}/basic/report`}>
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
