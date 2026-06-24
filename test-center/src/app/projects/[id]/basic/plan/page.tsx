"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  AlertCircle,
  Loader2,
  PlayCircle,
  ShieldCheck,
  Ban,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  categoryLabels,
  categoryOrder,
  categoryDescriptions,
  getOrGenerateBasicCases,
} from "@/lib/basic-test-cases";
import type { TestCase } from "@/lib/store";

// 优先级 → Badge severity
const prioritySeverity: Record<
  TestCase["priority"],
  "critical" | "warning" | "info"
> = {
  P0: "critical",
  P1: "warning",
  P2: "info",
};

// 用例状态 → Badge severity
const statusSeverity: Record<
  TestCase["status"],
  "pass" | "critical" | "warning" | "info"
> = {
  pending: "info",
  pass: "pass",
  fail: "critical",
  block: "warning",
  skip: "info",
};

const statusLabel: Record<TestCase["status"], string> = {
  pending: "待执行",
  pass: "已通过",
  fail: "失败",
  block: "阻断",
  skip: "跳过",
};

export default function BasicPlanPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;

  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const list = getOrGenerateBasicCases(projectId);
    setCases(list);
    setLoading(false);
  }, [projectId]);

  if (!mounted || loading) {
    return (
      <div className="py-24 text-center text-sm text-text-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent" />
        <p className="mt-2">正在生成基础测试用例…</p>
      </div>
    );
  }

  if (cases.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="mt-4 text-lg font-semibold text-text">未生成用例</h2>
        <p className="mt-2 text-sm text-text-2">
          可能该项目尚未完成分析，请先返回分析页。
        </p>
        <Button href={`/projects/${projectId}/analysis`} className="mt-4" variant="ghost" size="sm">
          返回分析页
        </Button>
      </div>
    );
  }

  // 按 6 大类分组
  const grouped = categoryOrder
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat],
      description: categoryDescriptions[cat],
      cases: cases.filter((c) => c.category === cat),
    }))
    .filter((g) => g.cases.length > 0);

  // 统计
  const totalCases = cases.length;
  const blockingCount = cases.filter((c) => c.blockingLevel === "blocking").length;
  const passedCount = cases.filter((c) => c.status === "pass").length;
  const failedCount = cases.filter((c) => c.status === "fail").length;

  return (
    <>
      <PageHeader
        eyebrow="基础测试 · 计划"
        title="基础测试计划"
        description={`基于功能地图生成的基础用例清单，覆盖环境、页面、正常路径、表单、持久化与权限 6 大类。项目标识：${projectId}`}
        action={
          <Button href={`/projects/${projectId}/basic/run`} size="sm">
            <PlayCircle className="h-4 w-4" />
            开始执行基础测试
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        {/* 顶部统计 */}
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="用例总数" value={totalCases} icon={ShieldCheck} color="text-accent" />
          <StatCard label="阻断用例" value={blockingCount} icon={Ban} color="text-warning" />
          <StatCard label="已通过" value={passedCount} icon={ShieldCheck} color="text-accent" />
          <StatCard label="失败" value={failedCount} icon={AlertCircle} color="text-critical" />
        </div>

        {/* 按 6 大类分组展示 */}
        {grouped.map((group) => (
          <Panel
            key={group.category}
            title={
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent">
                  {String(categoryOrder.indexOf(group.category) + 1).padStart(2, "0")}
                </span>
                {group.label}
              </span>
            }
            description={`${group.description} · 共 ${group.cases.length} 个用例`}
            bodyClassName="p-0"
          >
            {/* 小屏幕横向滚动容器，避免表格溢出 */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px] divide-y divide-border-soft">
                {/* 表头 */}
                <div className="grid grid-cols-[110px_1fr_120px_90px_90px] gap-3 px-5 py-2.5 text-xs font-medium text-text-3">
                  <span>用例编号</span>
                  <span>用例标题 / 目标</span>
                  <span>预期结果</span>
                  <span>优先级</span>
                  <span>阻断</span>
                </div>
                {group.cases.map((tc) => (
                  <div
                    key={tc.id}
                    className="grid grid-cols-[110px_1fr_120px_90px_90px] items-start gap-3 px-5 py-3 text-sm transition-colors hover:bg-bg-2"
                  >
                    <span className="font-mono text-xs text-text-2">{tc.id}</span>
                    <div className="min-w-0">
                      <p className="text-text">{tc.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-3">
                        目标：{tc.objective}
                      </p>
                      {tc.status !== "pending" && (
                        <div className="mt-1.5">
                          <Badge severity={statusSeverity[tc.status]}>
                            {statusLabel[tc.status]}
                          </Badge>
                        </div>
                      )}
                    </div>
                    <p className="line-clamp-3 text-xs leading-relaxed text-text-2">
                      {tc.expectedResult}
                    </p>
                    <div>
                      <Badge severity={prioritySeverity[tc.priority]}>
                        {tc.priority}
                      </Badge>
                    </div>
                    <div>
                      {tc.blockingLevel === "blocking" ? (
                        <Badge severity="warning">阻断</Badge>
                      ) : (
                        <Badge severity="info">非阻断</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        ))}

        {/* 底部下一步操作 */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">用例已就绪</p>
            <p className="mt-0.5 text-xs text-text-2">
              下一步：执行基础测试，使用剧本回放模式逐步运行每个用例并收集结果。
            </p>
          </div>
          <Button href={`/projects/${projectId}/basic/run`}>
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
