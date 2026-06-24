"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Ban,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Camera,
  Network,
  Wrench,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IssueCard } from "@/components/ui/IssueCard";
import { FixPack } from "@/components/ui/FixPack";
import {
  AIThinkingPanel,
  type AIThinkingLog,
} from "@/components/ui/AIThinkingPanel";
import {
  type Issue,
  type BasicTestReport,
  type Evidence,
  type RiskLevel,
} from "@/lib/store";

// 严重等级 → IssueCard severity
const severityToCard: Record<
  RiskLevel,
  "critical" | "warning" | "info"
> = {
  low: "info",
  medium: "info",
  high: "warning",
  critical: "critical",
};

// 证据类型 → 图标
function EvidenceIcon({ type }: { type: Evidence["type"] }) {
  switch (type) {
    case "screenshot":
      return <Camera className="h-3.5 w-3.5 text-accent" />;
    case "console":
      return <Terminal className="h-3.5 w-3.5 text-info" />;
    case "network":
      return <Network className="h-3.5 w-3.5 text-warning" />;
    default:
      return null;
  }
}

const evidenceTypeLabel: Record<Evidence["type"], string> = {
  screenshot: "截图描述",
  console: "Console 日志",
  network: "网络请求",
};

export default function BasicReportPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [report, setReport] = useState<BasicTestReport | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [retesting, setRetesting] = useState(false);
  const [retestMessage, setRetestMessage] = useState<string | null>(null);
  const [allFixed, setAllFixed] = useState(false);
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
        url.searchParams.set("page", "basic-report");
        if (lastLogIdRef.current) {
          url.searchParams.set("afterId", lastLogIdRef.current);
        }
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const json = await res.json();
        const serverSessionId: string | null = json.sessionId ?? null;

        // 检测会话变化：服务端开启了新会话（重新生成报告），清空旧日志重新加载
        if (knownSessionId !== null && serverSessionId !== null && knownSessionId !== serverSessionId) {
          setAiLogs([]);
          lastLogIdRef.current = null;
          knownSessionId = serverSessionId;
          const reloadUrl = new URL(
            `/api/projects/${projectId}/ai-thinking`,
            window.location.origin,
          );
          reloadUrl.searchParams.set("page", "basic-report");
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

  // 加载报告（优先从 API 获取服务端数据，兜底使用客户端存储）
  const loadReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/basic-report`);
      if (res.ok) {
        const data = await res.json();
        if (data?.report) {
          setReport(data.report);
          // 从报告中的 issues 设置问题列表
          const issueList = data.report.issues ?? [];
          setIssues(issueList);
          // 检查是否全部已修复
          const allDone =
            issueList.length > 0 &&
            issueList.every((i: Issue) => i.status === "fixed");
          setAllFixed(allDone);
          setLoading(false);
          return;
        }
      }
    } catch {
      // API 获取失败
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    setMounted(true);
    loadReport();
  }, [loadReport]);

  // 模拟修复并复测
  const handleRetest = useCallback(async () => {
    if (retesting) return;
    setRetesting(true);
    setRetestMessage(null);

    try {
      // 调用复测 API
      const res = await fetch(`/api/projects/${projectId}/basic-retest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data?.result) {
        setRetestMessage(data.result.message);
        // 重新加载报告与问题
        loadReport();
      } else if (data?.error) {
        setRetestMessage(`复测失败：${data.error}`);
      }
    } catch (err) {
      setRetestMessage(`复测请求失败：${(err as Error).message}`);
    } finally {
      setRetesting(false);
    }
  }, [projectId, retesting, loadReport]);

  if (!mounted || loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* AI 思考过程窗口（位于顶部确保可见） */}
        <AIThinkingPanel
          logs={aiLogs}
          loading={true}
          title="AI 思考过程"
          emptyText="AI 正在为每个问题生成修复指令，思考过程即将显示…"
        />
        <div className="py-12 text-center text-sm text-text-3">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
          <p className="mt-2">正在生成基础测试报告…</p>
        </div>
      </div>
    );
  }

  // 未执行基础测试
  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-lg font-semibold text-text">尚未生成报告</h2>
        <p className="mt-2 text-sm text-text-2">
          请先执行基础测试，再查看报告。
        </p>
        <Button
          href={`/projects/${projectId}/basic/run`}
          className="mt-4"
          size="sm"
        >
          <ArrowLeft className="h-4 w-4" />
          前往执行
        </Button>
      </div>
    );
  }

  const failedCount = report.failed;
  const blockedCount = report.blocked;
  const nonBlockingFailed = report.nonBlockingFailed;
  const hasFailures = issues.length > 0 && !allFixed;

  return (
    <>
      <PageHeader
        eyebrow="基础测试 · 报告"
        title="基础测试报告"
        description={`问题汇总与可执行的修复指南包。项目标识：${projectId}`}
        action={
          <div className="flex items-center gap-2">
            {allFixed ? (
              <Badge severity="pass">全部已修复</Badge>
            ) : hasFailures ? (
              <Badge severity="critical">存在未修复问题</Badge>
            ) : (
              <Badge severity="pass">无失败用例</Badge>
            )}
          </div>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 顶部摘要 */}
        <div className="grid gap-4 sm:grid-cols-5">
          <SummaryCard
            label="通过"
            value={report.passed}
            icon={CheckCircle2}
            color="text-accent"
          />
          <SummaryCard
            label="失败"
            value={failedCount}
            icon={XCircle}
            color="text-critical"
          />
          <SummaryCard
            label="阻断"
            value={blockedCount}
            icon={Ban}
            color="text-warning"
          />
          <SummaryCard
            label="非阻断失败"
            value={nonBlockingFailed}
            icon={AlertCircle}
            color="text-info"
          />
          <SummaryCard
            label="通过率"
            value={`${report.passRate}%`}
            icon={ShieldCheck}
            color="text-accent"
          />
        </div>

        {/* 复测消息提示 */}
        {retestMessage && (
          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-dim px-4 py-3 text-sm text-accent">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{retestMessage}</span>
          </div>
        )}

        {/* 失败用例列表 */}
        {issues.length > 0 ? (
          <Panel
            title="失败用例与问题详情"
            description="按严重等级排列的失败用例对应问题，含完整证据与修复指南。"
          >
            <div className="space-y-6">
              {issues.map((issue) => (
                <IssueDetail key={issue.id} issue={issue} />
              ))}
            </div>
          </Panel>
        ) : (
          <Panel
            title="无失败用例"
            description="本次基础测试全部通过，可直接进入高级业务测试。"
          >
            <div className="flex items-center gap-3 text-sm text-text-2">
              <CheckCircle2 className="h-5 w-5 text-accent" />
              所有 {report.passed} 个用例均通过，未发现需要修复的问题。
            </div>
          </Panel>
        )}

        {/* 底部操作 */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">
              {allFixed
                ? "所有问题已修复"
                : hasFailures
                  ? "存在未修复问题"
                  : "基础测试通过"}
            </p>
            <p className="mt-0.5 text-xs text-text-2">
              {allFixed
                ? "复测通过，可进入高级业务测试阶段。"
                : hasFailures
                  ? "点击「模拟修复并复测」模拟用户已修复问题并执行复测。"
                  : "可直接进入高级业务测试阶段。"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              href={`/projects/${projectId}/basic/run`}
            >
              <RefreshCw className="h-4 w-4" />
              重新执行
            </Button>
            {hasFailures && (
              <Button
                size="sm"
                onClick={handleRetest}
                disabled={retesting}
              >
                {retesting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    复测中…
                  </>
                ) : (
                  <>
                    <Wrench className="h-4 w-4" />
                    模拟修复并复测
                  </>
                )}
              </Button>
            )}
            {(allFixed || !hasFailures) && (
              <Button
                size="sm"
                href={`/projects/${projectId}/modules`}
              >
                返回模块选择
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// 单个问题详情：IssueCard + FixPack
function IssueDetail({ issue }: { issue: Issue }) {
  const [showFixPack, setShowFixPack] = useState(true);

  // 证据文本（用于 IssueCard 的 evidence 字段）
  const evidenceText = issue.evidences
    .map((e) => `[${evidenceTypeLabel[e.type]}]\n${e.content}`)
    .join("\n\n");

  // 修复包文本（用于 IssueCard 的 fix 字段）
  const fixSummary = `修复方向：\n${issue.fixDirections.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

  return (
    <div className="space-y-4">
      <IssueCard
        title={`${issue.title} · ${issue.id}`}
        severity={severityToCard[issue.severity]}
        steps={issue.reproduceSteps}
        evidence={evidenceText}
        fix={fixSummary}
      />

      {/* 详细信息：影响模块、可能原因、证据列表 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 影响模块与可能原因 */}
        <div className="rounded-lg border border-border bg-bg-2 p-4">
          <h5 className="text-xs font-medium text-text-2">影响模块</h5>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {issue.impactModules.map((m) => (
              <span
                key={m}
                className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text-2"
              >
                {m}
              </span>
            ))}
          </div>

          <h5 className="mt-4 text-xs font-medium text-text-2">可能原因</h5>
          <ul className="mt-2 space-y-1.5">
            {issue.possibleCauses.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-text-2"
              >
                <span className="mt-0.5 text-warning">•</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>

          <h5 className="mt-4 text-xs font-medium text-text-2">修复后验收标准</h5>
          <ul className="mt-2 space-y-1.5">
            {issue.acceptanceCriteria.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-text-2"
              >
                <span className="mt-0.5 text-accent">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* 证据列表 */}
        <div className="rounded-lg border border-border bg-bg-2 p-4">
          <h5 className="text-xs font-medium text-text-2">证据详情</h5>
          <div className="mt-2 space-y-3">
            {issue.evidences.map((ev) => (
              <div
                key={ev.id}
                className="rounded-md border border-border-soft bg-surface px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <EvidenceIcon type={ev.type} />
                  <span className="text-xs font-medium text-text">
                    {evidenceTypeLabel[ev.type]}
                  </span>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-2">
                  {ev.content}
                </pre>
              </div>
            ))}
          </div>

          <h5 className="mt-4 text-xs font-medium text-text-2">禁止事项</h5>
          <ul className="mt-2 space-y-1.5">
            {issue.prohibitions.map((p, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-xs text-text-2"
              >
                <span className="mt-0.5 text-critical">✕</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* AI 修复指令包 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h5 className="text-xs font-medium text-text-2">
            AI 修复指令包（可一键复制给编程 AI）
          </h5>
          <button
            onClick={() => setShowFixPack(!showFixPack)}
            className="text-xs text-accent hover:underline"
          >
            {showFixPack ? "收起" : "展开"}
          </button>
        </div>
        {showFixPack && (
          <FixPack
            code={issue.aiInstruction}
            title={`AI 修复指令包 · ${issue.id}`}
          />
        )}
      </div>

      {/* 问题状态 */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text-3">问题状态：</span>
        {issue.status === "open" && <Badge severity="critical">待修复</Badge>}
        {issue.status === "fixing" && <Badge severity="warning">修复中</Badge>}
        {issue.status === "retesting" && (
          <Badge severity="warning">复测中</Badge>
        )}
        {issue.status === "fixed" && <Badge severity="pass">已修复</Badge>}
        {issue.status === "wont_fix" && <Badge severity="info">不修复</Badge>}
        <span className="text-text-3">
          · 复测轮数：{issue.retestRounds} / {issue.maxRetestRounds}
        </span>
      </div>
    </div>
  );
}

// 摘要卡片
function SummaryCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
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
