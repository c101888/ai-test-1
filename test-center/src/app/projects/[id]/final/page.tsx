"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ArrowLeft,
  Home,
  ListChecks,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Bug,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  getFinalReport,
  getAdvancedRetestResult,
  getProjectRegressionCases,
  type FinalQualityReport,
  type AdvancedRetestResult,
  type RegressionCase,
} from "@/lib/store";

// 结论等级 → Badge severity（5 级）
const conclusionSeverity: Record<
  FinalQualityReport["conclusionLevel"],
  "critical" | "warning" | "pass"
> = {
  no_demo: "critical",
  no_commercial: "critical",
  internal_demo: "warning",
  gray_release: "warning",
  public_test: "pass",
};

// 质量维度状态 → Badge severity
const qualityStatusSeverity: Record<
  "pass" | "warn" | "fail",
  "pass" | "warning" | "critical"
> = {
  pass: "pass",
  warn: "warning",
  fail: "critical",
};

export default function FinalPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<FinalQualityReport | null>(null);
  const [retestResult, setRetestResult] =
    useState<AdvancedRetestResult | null>(null);
  const [regressionCases, setRegressionCases] = useState<RegressionCase[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 加载最终报告
  const loadReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/final-report`);
      if (res.ok) {
        const data = await res.json();
        if (data?.report) {
          setReport(data.report);
          setRetestResult(data.retestResult ?? null);
          setRegressionCases(data.regressionCases ?? []);
          setLoading(false);
          return;
        }
      }
    } catch {
      // API 获取失败，尝试客户端存储兜底
    }

    // 客户端兜底
    const r = getFinalReport(projectId);
    if (r) {
      setReport(r);
      setRetestResult(getAdvancedRetestResult(projectId) ?? null);
      setRegressionCases(getProjectRegressionCases(projectId));
    }
    setLoading(false);
  }, [projectId]);

  // 自动触发复测生成最终报告
  const triggerGenerate = useCallback(async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      // 调用 POST 触发复测（演示项目用 scripted，真实项目也用 scripted 模拟修复）
      const res = await fetch(`/api/projects/${projectId}/final-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scripted" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setGenerateError(data.error || `请求失败（HTTP ${res.status}）`);
        setGenerating(false);
        return;
      }
      const data = await res.json();
      const taskId = data.taskId;
      if (!taskId) {
        setGenerateError("未返回任务 ID");
        setGenerating(false);
        return;
      }

      // 轮询任务状态
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const taskRes = await fetch(`/api/tasks/${taskId}`);
        if (!taskRes.ok) continue;
        const task = await taskRes.json();
        if (task.status === "done") {
          // 任务完成，重新加载报告
          await loadReport();
          setGenerating(false);
          return;
        }
        if (task.status === "failed") {
          setGenerateError(task.error || "复测执行失败");
          setGenerating(false);
          return;
        }
      }
      setGenerateError("复测超时（120 秒）");
      setGenerating(false);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  }, [projectId, loadReport]);

  useEffect(() => {
    setMounted(true);
    loadReport();
  }, [loadReport]);

  if (!mounted || loading) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
        <p className="mt-2">正在生成最终质量结论…</p>
      </div>
    );
  }

  // 未生成最终报告
  if (!report) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-lg font-semibold text-text">尚未生成最终结论</h2>
        <p className="mt-2 text-sm text-text-2">
          请先完成高级业务测试与三级回归复测，再查看最终质量结论。
        </p>

        {generateError && (
          <div className="mt-4 rounded-lg border border-critical/30 bg-critical/5 p-3 text-sm text-critical">
            {generateError}
          </div>
        )}

        <div className="mt-4 flex items-center justify-center gap-3">
          <Button
            onClick={triggerGenerate}
            disabled={generating}
            size="sm"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在生成最终结论…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                生成最终结论
              </>
            )}
          </Button>
          <Button
            href={`/projects/${projectId}/advanced/report`}
            size="sm"
            variant="ghost"
          >
            <ArrowLeft className="h-4 w-4" />
            前往高级测试报告
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="复测与最终验收"
        title="最终质量结论"
        description={`三级回归复测完成，防回归用例已沉淀。综合基础测试、高级业务测试与复测结果给出最终质量结论。项目标识：${projectId}`}
        action={
          <Badge severity={conclusionSeverity[report.conclusionLevel]}>
            {report.conclusionLabel}
          </Badge>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 顶部摘要：Bug 发现与修复情况 */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<Bug className="h-4 w-4" />}
            label="发现 Bug 总数"
            value={report.totalBugsFound}
            tone="accent"
          />
          <SummaryCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="已修复 Bug"
            value={report.totalBugsFixed}
            tone="pass"
          />
          <SummaryCard
            icon={<ShieldCheck className="h-4 w-4" />}
            label="三级回归"
            value={retestResult?.allPassed ? "全部通过" : "存在失败"}
            tone={retestResult?.allPassed ? "pass" : "critical"}
          />
          <SummaryCard
            icon={<ListChecks className="h-4 w-4" />}
            label="防回归用例"
            value={regressionCases.length}
            tone="accent"
          />
        </div>

        {/* 三级回归结果 */}
        {retestResult && (
          <>
            <Panel
              title="三级回归复测结果"
              description="原问题复测 → 相关功能回归 → 综合回归，逐层验证修复有效性"
              action={
                retestResult.allPassed ? (
                  <Badge severity="pass">全部通过</Badge>
                ) : (
                  <Badge severity="critical">存在失败</Badge>
                )
              }
            >
              <div className="space-y-6">
                {/* 第一层：原问题针对性复测 */}
                <RegressionLayer
                  title={retestResult.layer1.title}
                  description={retestResult.layer1.description}
                  passed={retestResult.layer1.passedIssues}
                  total={retestResult.layer1.totalIssues}
                  failed={retestResult.layer1.failedIssues}
                >
                  <div className="space-y-2">
                    {retestResult.layer1.details.map((d) => (
                      <div
                        key={d.issueId}
                        className="flex items-start gap-3 rounded-lg border border-border-soft bg-bg-2 px-3 py-2.5"
                      >
                        <StatusIcon status={d.status} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-text">
                              {d.title}
                            </span>
                            {d.bugId && (
                              <Badge severity="info">{d.bugId}</Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-text-2">{d.note}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </RegressionLayer>

                {/* 第二层：相关功能回归 */}
                <RegressionLayer
                  title={retestResult.layer2.title}
                  description={retestResult.layer2.description}
                  passed={retestResult.layer2.passedCases}
                  total={retestResult.layer2.totalCases}
                  failed={retestResult.layer2.failedCases}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {retestResult.layer2.details.map((d) => (
                      <div
                        key={d.caseId}
                        className="flex items-start gap-2 rounded-lg border border-border-soft bg-bg-2 px-3 py-2"
                      >
                        <StatusIcon status={d.status} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text">
                            {d.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-text-3">
                            {d.note}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </RegressionLayer>

                {/* 第三层：综合回归 */}
                <RegressionLayer
                  title={retestResult.layer3.title}
                  description={retestResult.layer3.description}
                  passed={retestResult.layer3.passedCases}
                  total={retestResult.layer3.totalCases}
                  failed={retestResult.layer3.failedCases}
                >
                  <div className="space-y-3">
                    {groupLayer3ByCategory(retestResult.layer3.details).map(
                      (group) => (
                        <div key={group.category}>
                          <p className="mb-1.5 text-xs font-medium text-text-2">
                            {group.category}
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {group.items.map((d, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2 rounded-lg border border-border-soft bg-bg-2 px-3 py-2"
                              >
                                <StatusIcon status={d.status} />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-text">
                                    {d.title}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-text-3">
                                    {d.note}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </RegressionLayer>
              </div>
            </Panel>
          </>
        )}

        {/* 防回归用例列表 */}
        {regressionCases.length > 0 && (
          <Panel
            title="防回归用例（沉淀的长期用例）"
            description="修复后自动生成的长期测试用例，后续测试自动复用，防止相同问题再次出现"
            action={
              <Badge severity="accent">{regressionCases.length} 条用例</Badge>
            }
          >
            <div className="grid gap-3 lg:grid-cols-2">
              {regressionCases.map((c) => (
                <RegressionCaseCard key={c.id} caseItem={c} />
              ))}
            </div>
          </Panel>
        )}

        {/* 最终质量结论 */}
        <Panel
          title="最终质量结论"
          description="综合基础测试、高级业务测试与三级回归复测结果的整体结论"
        >
          <div className="space-y-5">
            {/* 结论等级与原因 */}
            <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent-dim px-4 py-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge severity={conclusionSeverity[report.conclusionLevel]}>
                    {report.conclusionLabel}
                  </Badge>
                  <span className="text-xs text-text-3">
                    生成于 {formatTime(report.generatedAt)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text-2">
                  {report.conclusionReason}
                </p>
              </div>
            </div>

            {/* 质量维度评分 */}
            <div>
              <h4 className="mb-3 text-xs font-medium text-text-2">质量维度</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <QualityCard
                  label={report.basicQuality.label}
                  score={report.basicQuality.score}
                  status={report.basicQuality.status}
                />
                <QualityCard
                  label={report.businessQuality.label}
                  score={report.businessQuality.score}
                  status={report.businessQuality.status}
                />
                <QualityCard
                  label={report.uxQuality.label}
                  score={report.uxQuality.score}
                  status={report.uxQuality.status}
                />
              </div>
            </div>

            {/* Bug 总览 */}
            <div>
              <h4 className="mb-3 text-xs font-medium text-text-2">
                Bug 总览（{report.totalBugsFixed}/{report.totalBugsFound} 已修复）
              </h4>
              <div className="overflow-hidden rounded-lg border border-border-soft">
                <table className="w-full text-left text-xs">
                  <thead className="bg-bg-2 text-text-3">
                    <tr>
                      <th className="px-3 py-2 font-medium">Bug</th>
                      <th className="px-3 py-2 font-medium">标题</th>
                      <th className="px-3 py-2 font-medium">发现阶段</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-soft">
                    {report.bugSummary.map((b) => (
                      <tr key={b.bugId} className="text-text-2">
                        <td className="px-3 py-2 font-mono text-text">
                          Bug {b.bugNumber}
                        </td>
                        <td className="px-3 py-2">{b.title}</td>
                        <td className="px-3 py-2">
                          <Badge severity="info">
                            {b.detectedIn === "basic" ? "基础测试" : "高级测试"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {b.status === "fixed" ? (
                            <Badge severity="pass">已修复</Badge>
                          ) : (
                            <Badge severity="critical">未修复</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 剩余风险 / 未测试模块 / 需求缺口 */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* 剩余风险 */}
              <div className="rounded-lg border border-warning/30 bg-warning-dim/30 p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <h5 className="text-xs font-medium text-text">剩余风险</h5>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {report.remainingRisks.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-text-2"
                    >
                      <span className="mt-0.5 text-warning">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 未测试模块 */}
              <div className="rounded-lg border border-info/30 bg-info-dim/30 p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-info" />
                  <h5 className="text-xs font-medium text-text">未测试模块</h5>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {report.untestedModules.map((m, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-text-2"
                    >
                      <span className="mt-0.5 text-info">•</span>
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* 需求缺口 */}
              <div className="rounded-lg border border-border bg-bg-2 p-4">
                <div className="flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-text-2" />
                  <h5 className="text-xs font-medium text-text">需求缺口</h5>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {report.requirementGaps.map((g, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-text-2"
                    >
                      <span className="mt-0.5 text-text-3">•</span>
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 建议下一步 */}
            <div className="rounded-lg border border-accent/30 bg-accent-dim/20 p-4">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-accent" />
                <h5 className="text-xs font-medium text-text">建议下一步</h5>
              </div>
              <ol className="mt-2 space-y-1.5">
                {report.nextSteps.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs text-text-2"
                  >
                    <span className="mt-0.5 font-mono text-accent">
                      {i + 1}.
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Panel>

        {/* 底部操作 */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-2 text-sm text-text-2">
            <TrendingUp className="h-4 w-4 text-accent" />
            <span>
              测试流程已完成，最终结论：
              <span className="font-medium text-text">
                {report.conclusionLabel}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              href={`/projects/${projectId}/advanced/report`}
            >
              <ArrowLeft className="h-4 w-4" />
              返回高级报告
            </Button>
            <Button size="sm" href="/">
              <Home className="h-4 w-4" />
              返回项目列表
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// 子组件
// ============================================================

// 摘要卡片
function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: "accent" | "pass" | "critical";
}) {
  const toneClass =
    tone === "pass"
      ? "text-accent"
      : tone === "critical"
        ? "text-critical"
        : "text-accent";
  return (
    <div className="rounded-xl border border-border bg-surface px-5 py-4">
      <div className="flex items-center gap-2 text-text-3">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={`mt-2 font-mono text-2xl ${toneClass}`}>{value}</p>
    </div>
  );
}

// 回归层（第一/二/三层）
function RegressionLayer({
  title,
  description,
  passed,
  total,
  failed,
  children,
}: {
  title: string;
  description: string;
  passed: number;
  total: number;
  failed: number;
  children: React.ReactNode;
}) {
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  return (
    <div className="rounded-lg border border-border-soft bg-bg-2/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text">{title}</h4>
          <p className="mt-0.5 text-xs text-text-2">{description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="flex items-center gap-2">
            <Badge severity={failed === 0 ? "pass" : "critical"}>
              {passed}/{total} 通过
            </Badge>
            {failed > 0 && <Badge severity="critical">{failed} 失败</Badge>}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar
          value={passRate}
          tone={failed === 0 ? "accent" : "warning"}
          label="通过率"
        />
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// 状态图标
function StatusIcon({ status }: { status: "pass" | "fail" }) {
  return status === "pass" ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
  ) : (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-critical" />
  );
}

// 防回归用例卡片
function RegressionCaseCard({ caseItem }: { caseItem: RegressionCase }) {
  return (
    <div className="rounded-lg border border-border-soft bg-bg-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{caseItem.title}</p>
          <p className="mt-0.5 text-xs text-text-2">{caseItem.description}</p>
        </div>
        <Badge severity="pass">通过</Badge>
      </div>
      <div className="mt-2 space-y-1">
        <p className="text-[11px] font-medium text-text-3">步骤：</p>
        <ol className="space-y-0.5">
          {caseItem.steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 text-[11px] text-text-2"
            >
              <span className="font-mono text-text-3">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-2 rounded bg-surface-2 px-2 py-1.5">
        <p className="text-[11px] text-text-3">预期结果</p>
        <p className="mt-0.5 text-xs text-text">{caseItem.expectedResult}</p>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-text-3">
        <span className="font-mono">{caseItem.id}</span>
        {caseItem.bugId && (
          <>
            <span>·</span>
            <span>关联 {caseItem.bugId}</span>
          </>
        )}
      </div>
    </div>
  );
}

// 质量维度卡片
function QualityCard({
  label,
  score,
  status,
}: {
  label: string;
  score: number;
  status: "pass" | "warn" | "fail";
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-2 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-2">{label}</span>
        <Badge severity={qualityStatusSeverity[status]}>
          {status === "pass" ? "通过" : status === "warn" ? "警告" : "失败"}
        </Badge>
      </div>
      <p className="mt-2 font-mono text-2xl text-accent">{score}</p>
      <div className="mt-2">
        <ProgressBar value={score} tone={status === "pass" ? "accent" : "warning"} />
      </div>
    </div>
  );
}

// ============================================================
// 工具函数
// ============================================================

// 按类别分组第三层综合回归详情
function groupLayer3ByCategory(
  details: AdvancedRetestResult["layer3"]["details"],
): { category: string; items: typeof details }[] {
  const groups: Record<string, typeof details> = {};
  for (const d of details) {
    if (!groups[d.category]) groups[d.category] = [];
    groups[d.category].push(d);
  }
  return Object.entries(groups).map(([category, items]) => ({
    category,
    items,
  }));
}

// 格式化时间
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}
