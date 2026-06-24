"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Monitor,
  Code,
  Sparkles,
  Shield,
  Database,
  Zap,
  ArrowRight,
  CheckCircle2,
  Clock,
  Lock,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  getProject,
  putProject,
  getModuleStatus,
  isModuleAvailable,
  countCompletedModules,
  moduleDisplay,
  getModuleRoutePrefix,
  type Project,
  type TestModuleType,
  type ModuleStatus,
} from "@/lib/store";

// 模块图标映射
const moduleIcons: Record<TestModuleType, React.ComponentType<{ className?: string }>> = {
  ui: Monitor,
  functional: Code,
  business: Sparkles,
  security: Shield,
  database: Database,
  concurrency: Zap,
};

// 模块顺序（展示用）
const moduleOrder: TestModuleType[] = [
  "ui",
  "functional",
  "business",
  "security",
  "database",
  "concurrency",
];

// 模块状态展示
const moduleStatusDisplay: Record<ModuleStatus, { label: string; severity: "info" | "warning" | "pass" }> = {
  not_started: { label: "未开始", severity: "info" },
  testing: { label: "测试中", severity: "warning" },
  done: { label: "已完成", severity: "pass" },
};

export default function ModulesPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let p = getProject(id);
      // localStorage 可能无数据（直接访问/刷新页面），从服务端同步
      if (!p) {
        try {
          const res = await fetch("/api/projects");
          if (res.ok) {
            const data = await res.json();
            const list = Array.isArray(data) ? data : (data.projects || []);
            list.forEach((proj: Project) => putProject(proj));
            p = getProject(id);
          }
        } catch {
          // 服务端不可用时忽略
        }
      }
      if (!cancelled) {
        setProject(p ?? null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // 显示 toast 提示（3 秒后自动消失）
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <p className="text-text-2">加载中…</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Panel title="项目不存在">
          <p className="px-5 py-4 text-text-2">未找到该项目，请返回首页重新选择。</p>
        </Panel>
      </div>
    );
  }

  const completedCount = countCompletedModules(project);

  return (
    <>
      <PageHeader
        eyebrow="测试中心"
        title="测试模块选择"
        description={`${project.name} · 选择需要执行的测试模块（6 个模块平级，可任意顺序测试）`}
      />

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {/* 项目分析摘要 */}
        {project.analysisModel && (
          <Panel title="项目分析摘要" description="AI 全栈审计结果概览">
            <div className="grid grid-cols-2 gap-4 px-5 py-4 md:grid-cols-4">
              <div>
                <p className="text-xs text-text-2">项目类型</p>
                <p className="text-sm text-text">{project.analysisModel.overview.projectType || "未识别"}</p>
              </div>
              <div>
                <p className="text-xs text-text-2">核心功能</p>
                <p className="text-sm text-text">
                  {(project.analysisModel.overview.coreFunctions || []).slice(0, 3).join("、") || "未识别"}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-2">风险区域</p>
                <p className="text-sm text-text">{(project.analysisModel.riskMap || []).length} 项</p>
              </div>
              <div>
                <p className="text-xs text-text-2">技术栈</p>
                <p className="text-sm text-text">
                  {(project.analysisModel.overview.techStack || []).slice(0, 2).join("、") || "未识别"}
                </p>
              </div>
            </div>
          </Panel>
        )}

        {/* 6 个模块卡片 */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {moduleOrder.map((moduleType) => {
            const info = moduleDisplay[moduleType];
            const Icon = moduleIcons[moduleType];
            const status = getModuleStatus(project, moduleType);
            const available = isModuleAvailable(project, moduleType);
            const statusInfo = moduleStatusDisplay[status];
            const routePrefix = getModuleRoutePrefix(moduleType);
            const moduleHref = `/projects/${id}/${routePrefix}/plan`;

            return (
              <div
                key={moduleType}
                className={`relative overflow-hidden rounded-xl border bg-surface transition-shadow ${
                  available
                    ? "border-border hover:shadow-md"
                    : "border-border-soft opacity-75"
                }`}
              >
                <div className="flex items-start gap-3 p-5">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      available ? "bg-accent-dim text-accent" : "bg-surface-2 text-text-2"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-text">{info.label}</h3>
                      <Badge severity={statusInfo.severity}>{statusInfo.label}</Badge>
                      {!available && (
                        <Badge severity="info">
                          <Lock className="mr-1 h-3 w-3" />
                          即将上线
                        </Badge>
                      )}
                      {moduleType === "business" && (
                        <Badge severity="accent">核心</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-text-2">
                      {info.description}
                    </p>
                  </div>
                </div>

                <div className="border-t border-border-soft px-5 py-3">
                  {available ? (
                    <Link
                      href={moduleHref}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
                    >
                      {status === "done" ? "查看报告" : status === "testing" ? "继续测试" : "进入测试"}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  ) : (
                    <button
                      onClick={() => showToast(`「${info.label}」模块即将上线，暂不可用`)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-text-2 hover:text-text"
                    >
                      <Lock className="h-3 w-3" />
                      暂不可用
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部操作区 */}
        <Panel
          title="最终验收"
          description="完成至少 1 个测试模块后，可生成最终质量报告"
        >
          <div className="flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-text-2">
              <CheckCircle2 className="h-4 w-4" />
              已完成 {completedCount} / 6 个模块
            </div>
            <Button
              variant={completedCount >= 1 ? "primary" : "ghost"}
              size="sm"
              href={completedCount >= 1 ? `/projects/${id}/final` : undefined}
              disabled={completedCount < 1}
            >
              {completedCount >= 1 ? "查看最终报告" : "需完成至少 1 个模块"}
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </Panel>
      </div>

      {/* Toast 提示 */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-lg">
            <AlertCircle className="h-4 w-4 text-text-2" />
            <span className="text-sm text-text">{toastMsg}</span>
          </div>
        </div>
      )}
    </>
  );
}
