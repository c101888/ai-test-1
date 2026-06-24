"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Wrench,
  RefreshCw,
  Camera,
  Terminal,
  Network,
  ShieldCheck,
  Target,
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
  type AdvancedTestReport,
  type AdvancedIssue,
  type Evidence,
  type RiskLevel,
} from "@/lib/store";
import {
  categoryLabels,
  categorySeverity,
  categoryDescriptions,
  type IssueCategory,
} from "@/lib/issue-classifier";
import {
  confidenceLabels,
  confidenceSeverity,
} from "@/lib/advanced-test-model";

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

export default function AdvancedReportPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [report, setReport] = useState<AdvancedTestReport | null>(null);
  const [issues, setIssues] = useState<AdvancedIssue[]>([]);
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
        url.searchParams.set("page", "advanced-report");
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
          reloadUrl.searchParams.set("page", "advanced-report");
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

  // 加载报告
  const loadReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/advanced-report`);
      if (res.ok) {
        const data = await res.json();
        if (data?.report) {
          setReport(data.report);
          const issueList = data.report.issues ?? [];
          setIssues(issueList);
          const allDone =
            issueList.length > 0 &&
            issueList.every((i: AdvancedIssue) => i.status === "fixed");
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

  // 模拟修复并复测（三级回归）
  const handleRetest = useCallback(async () => {
    if (retesting) return;
    setRetesting(true);
    setRetestMessage(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/advanced-retest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data?.result) {
        const r = data.result;
        setRetestMessage(
          `三级回归完成：第一层 ${r.layer1.passedIssues}/${r.layer1.totalIssues} 通过 · 第二层 ${r.layer2.passedCases}/${r.layer2.totalCases} 通过 · 第三层 ${r.layer3.passedCases}/${r.layer3.totalCases} 通过 · 防回归用例 ${r.regressionCases.length} 条已沉淀`,
        );
        // 重新加载报告
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
          <p className="mt-2">正在生成高级测试报告…</p>
        </div>
      </div>
    );
  }

  // 未执行高级测试
  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-lg font-semibold text-text">尚未生成报告</h2>
        <p className="mt-2 text-sm text-text-2">
          请先执行高级业务测试，再查看报告。
        </p>
        <Button
          href={`/projects/${projectId}/advanced/run`}
          className="mt-4"
          size="sm"
        >
          <ArrowLeft className="h-4 w-4" />
          前往执行
        </Button>
      </div>
    );
  }

  // 按分类分组问题
  const groupByCategory = (category: IssueCategory) =>
    issues.filter((i) => i.category === category);

  const confirmedBugs = groupByCategory("confirmed_bug");
  const highProbVulnerabilities = groupByCategory("high_prob_vulnerability");
  const uxDefects = groupByCategory("ux_defect");
  const requirementGaps = groupByCategory("requirement_gap");

  const hasFailures = issues.length > 0 && !allFixed;
  const hasSkipped = (report.skipped ?? 0) > 0;
  const allSkipped = report.total > 0 && report.passed === 0 && report.failed === 0 && hasSkipped;

  return (
    <>
      <PageHeader
        eyebrow="高级业务测试 · 报告"
        title="高级业务测试报告"
        description={`汇总已确认 Bug、高概率漏洞、体验缺陷与需求缺口，附完整证据与 AI 修复指令。项目标识：${projectId}`}
        action={
          <div className="flex items-center gap-2">
            {allFixed ? (
              <Badge severity="pass">全部已修复</Badge>
            ) : hasFailures ? (
              <Badge severity="critical">存在未修复问题</Badge>
            ) : allSkipped ? (
              <Badge severity="warning">需手动验证</Badge>
            ) : hasSkipped ? (
              <Badge severity="warning">部分需手动验证</Badge>
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
            label="已确认 Bug"
            value={report.confirmedBugCount}
            icon={XCircle}
            color="text-critical"
          />
          <SummaryCard
            label="高概率漏洞"
            value={report.highProbVulnerabilityCount}
            icon={AlertCircle}
            color="text-warning"
          />
          <SummaryCard
            label="体验缺陷"
            value={report.uxDefectCount}
            icon={AlertCircle}
            color="text-info"
          />
          <SummaryCard
            label="需求缺口"
            value={report.requirementGapCount}
            icon={Target}
            color="text-accent"
          />
          <SummaryCard
            label="发现 Bug 总数"
            value={report.detectedBugCount}
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

        {/* 已确认 Bug 列表 */}
        {confirmedBugs.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Badge severity={categorySeverity.confirmed_bug}>
                  {categoryLabels.confirmed_bug}
                </Badge>
                <span>{confirmedBugs.length} 个</span>
              </span>
            }
            description={categoryDescriptions.confirmed_bug}
          >
            <div className="space-y-6">
              {confirmedBugs.map((issue) => (
                <AdvancedIssueDetail key={issue.id} issue={issue} />
              ))}
            </div>
          </Panel>
        )}

        {/* 高概率漏洞 */}
        {highProbVulnerabilities.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Badge severity={categorySeverity.high_prob_vulnerability}>
                  {categoryLabels.high_prob_vulnerability}
                </Badge>
                <span>{highProbVulnerabilities.length} 个</span>
              </span>
            }
            description={categoryDescriptions.high_prob_vulnerability}
          >
            <div className="space-y-4">
              {highProbVulnerabilities.map((issue) => (
                <AdvancedIssueDetail key={issue.id} issue={issue} />
              ))}
            </div>
          </Panel>
        )}

        {/* 体验缺陷 */}
        {uxDefects.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Badge severity={categorySeverity.ux_defect}>
                  {categoryLabels.ux_defect}
                </Badge>
                <span>{uxDefects.length} 个</span>
              </span>
            }
            description={categoryDescriptions.ux_defect}
          >
            <div className="space-y-4">
              {uxDefects.map((issue) => (
                <AdvancedIssueDetail key={issue.id} issue={issue} />
              ))}
            </div>
          </Panel>
        )}

        {/* 需求缺口 */}
        {requirementGaps.length > 0 && (
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Badge severity={categorySeverity.requirement_gap}>
                  {categoryLabels.requirement_gap}
                </Badge>
                <span>{requirementGaps.length} 个</span>
              </span>
            }
            description={categoryDescriptions.requirement_gap}
          >
            <div className="space-y-4">
              {requirementGaps.map((issue) => (
                <AdvancedIssueDetail key={issue.id} issue={issue} />
              ))}
            </div>
          </Panel>
        )}

        {/* 无问题提示 */}
        {issues.length === 0 && (
          <Panel
            title={allSkipped ? "需手动验证" : "无发现问题"}
            description={
              allSkipped
                ? "本次高级测试路径均基于项目分析生成，需人工执行验证。"
                : "本次高级业务测试全部通过。"
            }
          >
            <div className="flex items-center gap-3 text-sm text-text-2">
              {allSkipped ? (
                <>
                  <AlertCircle className="h-5 w-5 text-warning" />
                  共 {report.skipped} 条测试路径需手动验证，{report.passed} 条通过。请参考测试计划逐条执行并记录结果。
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-accent" />
                  所有 {report.passed} 条测试路径均通过，未发现需要修复的问题。
                </>
              )}
            </div>
          </Panel>
        )}

        {/* 结论建议 */}
        <Panel
          title="结论建议"
          description="基于本轮高级测试的整体建议。"
        >
          {hasFailures ? (
            <div className="flex items-start gap-3 rounded-lg border border-critical/30 bg-critical-dim px-4 py-3">
              <Badge severity="critical">阻断发布</Badge>
              <p className="text-sm text-text-2">
                发现 {report.confirmedBugCount} 个已确认 Bug（含资金安全与积分经济风险），建议修复并复测通过后再进入最终验收。
              </p>
            </div>
          ) : allSkipped ? (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-dim/40 px-4 py-3">
              <Badge severity="warning">需手动验证</Badge>
              <p className="text-sm text-text-2">
                本轮 {report.skipped} 条测试路径基于项目分析自动生成，尚未执行真实验证。请参考测试计划逐条人工执行，确认无问题后再进入最终验收。
              </p>
            </div>
          ) : hasSkipped ? (
            <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-dim/40 px-4 py-3">
              <Badge severity="warning">部分需验证</Badge>
              <p className="text-sm text-text-2">
                {report.passed} 条路径通过，{report.skipped} 条路径需手动验证。建议补充验证后再进入最终验收。
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent-dim/40 px-4 py-3">
              <Badge severity="pass">可进入验收</Badge>
              <p className="text-sm text-text-2">
                所有 {report.passed} 条测试路径均通过，未发现需修复的问题，可进入最终验收阶段。
              </p>
            </div>
          )}
        </Panel>

        {/* 底部操作 */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">
              {allFixed
                ? "所有问题已修复"
                : hasFailures
                  ? "存在未修复问题"
                  : allSkipped
                    ? "需手动验证"
                    : hasSkipped
                      ? "部分需手动验证"
                      : "高级测试通过"}
            </p>
            <p className="mt-0.5 text-xs text-text-2">
              {allFixed
                ? "三级回归通过，可查看最终质量结论。"
                : hasFailures
                  ? "点击「模拟修复并复测」执行三级回归（原问题复测 + 相关功能回归 + 综合回归）。"
                  : allSkipped
                    ? "测试路径已基于项目分析生成，请参考测试计划逐条人工执行验证。"
                    : hasSkipped
                      ? "部分路径已通过，剩余路径需手动验证后再进入最终验收。"
                      : "可直接进入最终验收阶段。"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              href={`/projects/${projectId}/advanced/run`}
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
            {(allFixed || (!hasFailures && !hasSkipped)) && (
              <Button size="sm" href={`/projects/${projectId}/final`}>
                查看最终质量结论
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// 单个高级问题详情：IssueCard + 分类信息 + 证据 + AI 修复指令包
// ============================================================

function AdvancedIssueDetail({ issue }: { issue: AdvancedIssue }) {
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
        title={`${issue.title} · ${issue.id}${issue.bugNumber ? `（Bug ${issue.bugNumber}）` : ""}`}
        severity={severityToCard[issue.severity]}
        steps={issue.reproduceSteps}
        evidence={evidenceText}
        fix={fixSummary}
      />

      {/* 分类与规则信息 */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* 分类与规则 */}
        <div className="rounded-lg border border-border bg-bg-2 p-4">
          <h5 className="text-xs font-medium text-text-2">问题分类</h5>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge severity={categorySeverity[issue.category]}>
              {categoryLabels[issue.category]}
            </Badge>
            <Badge severity={confidenceSeverity[issue.confidence]}>
              置信度：{confidenceLabels[issue.confidence]}
            </Badge>
            <Badge severity="info">规则来源：{issue.ruleSource}</Badge>
          </div>
          <p className="mt-2 text-xs text-text-2">
            <span className="font-medium text-text-3">分类依据：</span>
            {issue.categoryReason}
          </p>

          <h5 className="mt-4 text-xs font-medium text-text-2">影响模块</h5>
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
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto">
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

          <h5 className="mt-4 text-xs font-medium text-text-2">回归范围</h5>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {issue.regressionScope.map((r) => (
              <span
                key={r}
                className="rounded bg-surface-2 px-2 py-0.5 text-xs text-text-2"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* AI 修复指令包 */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h5 className="text-xs font-medium text-text-2">
            AI 修复指令包（可一键复制给编程 AI · 含服务端校验+数据一致性+并发风险提醒）
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
