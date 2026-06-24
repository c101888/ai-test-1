"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileCode2,
  Globe,
  ShieldCheck,
  Sparkles,
  Plus,
  Bug,
  Trash2,
  Pencil,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  createProject,
  listProjects,
  getNextRoute,
  statusDisplay,
  putProject,
  migrateLegacyStatus,
  type Project,
} from "@/lib/store";
import { demoProjectSeed } from "@/lib/demo-analysis";

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [mounted, setMounted] = useState(false);
  const [importing, setImporting] = useState(false);

  // 客户端挂载后从服务端拉取项目列表并同步到 localStorage
  // 这样服务端已不存在的旧项目（如重启前创建但未持久化的项目）会自动从列表中消失
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (res.ok) {
          const data = await res.json();
          const serverProjects = (data.projects as Project[]) ?? [];
          if (cancelled) return;
          // 同步到 localStorage，覆盖可能存在的旧数据
          window.localStorage.setItem(
            "test-center:projects",
            JSON.stringify(
              Array.from(
                serverProjects.map((p) => [p.id, p] as [string, Project]),
              ),
            ),
          );
          setProjects(serverProjects);
          setMounted(true);
          return;
        }
      } catch {
        // 服务端不可用时回退到 localStorage
      }
      if (!cancelled) {
        setProjects(listProjects());
        setMounted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 删除项目：调用 API 删除服务端数据 + 客户端 localStorage
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`确定要删除项目「${name}」吗？\n\n该操作将删除项目及其所有关联数据（测试用例、运行记录、结果、问题、报告等），且不可恢复。`)) {
      return;
    }
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(`删除失败：${data.error || res.status}`);
        return;
      }
      // 同步删除客户端 localStorage
      // putProject 会更新，这里用 listProjects 重新读取
      const fresh = listProjects().filter((p) => p.id !== id);
      window.localStorage.setItem(
        "test-center:projects",
        JSON.stringify(Array.from(fresh.map((p) => [p.id, p] as [string, Project]))),
      );
      setProjects(fresh);
    } catch (err) {
      window.alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 一键导入演示项目
  // 通过 API 在服务端创建项目（确保后续 API 路由可访问），再同步到客户端 localStorage
  const handleImportDemo = async () => {
    setImporting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...demoProjectSeed, status: "analyzing" }),
      });
      if (res.ok) {
        const data = await res.json();
        const project = data.project as Project;
        // 同步到客户端 localStorage，使首页列表可立即显示
        putProject(project);
        router.push(`/projects/${project.id}/analysis`);
        return;
      }
    } catch {
      // API 失败时回退到客户端创建
    }
    // 回退：仅在客户端创建（API 路由将不可用）
    const project = createProject({
      ...demoProjectSeed,
      status: "analyzing",
    });
    router.push(`/projects/${project.id}/analysis`);
  };

  return (
    <>
      <PageHeader
        eyebrow="测试中心"
        title="你的项目，先测再上线"
        description="接入项目代码与文档，AI 自动构建功能地图、角色地图、状态机与风险地图，生成可执行的测试计划与修复指南包。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              onClick={handleImportDemo}
              disabled={importing}
            >
              <Sparkles className="h-4 w-4" />
              {importing ? "导入中…" : "导入演示项目"}
            </Button>
            <Button href="/projects/new" size="md">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* 项目卡片列表 / 空状态 */}
        {!mounted ? (
          <div className="py-16 text-center text-sm text-text-3">
            正在加载项目列表…
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onImportDemo={handleImportDemo} importing={importing} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* 能力介绍 */}
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "智能分析",
              desc: "自动构建功能地图、角色地图、状态机与风险地图，覆盖文档、代码、运行三方对照。",
            },
            {
              icon: FileCode2,
              title: "分层测试",
              desc: "基础用例执行 + 高级业务路径探索，覆盖正常流与异常流，定位真实业务 Bug。",
            },
            {
              icon: Globe,
              title: "修复指南包",
              desc: "为每个问题生成可复现证据与 AI 修复指令包，直达代码层修复建议。",
            },
          ].map((f) => (
            <Card key={f.title} className="p-5">
              <f.icon className="h-5 w-5 text-accent" />
              <h4 className="mt-3 text-sm font-semibold text-text">{f.title}</h4>
              <p className="mt-1 text-xs leading-relaxed text-text-2">
                {f.desc}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

// 空状态：引导用户接入项目或导入演示项目
function EmptyState({
  onImportDemo,
  importing,
}: {
  onImportDemo: () => void;
  importing: boolean;
}) {
  return (
    <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-dim text-accent">
        <Sparkles className="h-6 w-6" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-text">
        还没有测试项目
      </h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-2">
        接入你的第一个项目，或一键导入内置的演示项目（闯关学习 + 签到积分，预埋
        6 个业务 Bug），立即体验 AI 智能分析全流程。
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={onImportDemo} disabled={importing}>
          <Sparkles className="h-4 w-4" />
          {importing ? "导入中…" : "导入演示项目"}
        </Button>
        <Button variant="ghost" href="/projects/new">
          <Plus className="h-4 w-4" />
          手动接入项目
        </Button>
      </div>
    </Card>
  );
}

// 项目卡片
function ProjectCard({
  project,
  onDelete,
}: {
  project: Project;
  onDelete: (id: string, name: string) => void;
}) {
  // 兼容旧状态值（basic_testing 等 → analyzed）
  const normalizedStatus = migrateLegacyStatus(project.status as string);
  const display = statusDisplay[normalizedStatus] ?? statusDisplay.draft;
  const nextRoute = getNextRoute(project.id, normalizedStatus);
  const isDemo = project.isDemo;

  return (
    <div className="group relative h-full">
      <Link href={nextRoute} className="block h-full">
        <Card className="flex h-full flex-col p-5 transition-colors hover:border-accent/40">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-dim text-accent">
                <FileCode2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-text">
                  {project.name}
                </h3>
                {isDemo && (
                  <span className="font-mono text-[10px] text-accent">
                    演示项目
                  </span>
                )}
              </div>
            </div>
            <Badge severity={display.severity}>{display.label}</Badge>
          </div>

          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-text-2">
            {project.description || "暂无描述"}
          </p>

          {/* 关键指标 */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Metric label="发现问题" value={String(project.issuesFound)} />
            <Metric label="当前阶段" value={display.stage} />
            <Metric
              label="分析状态"
              value={
                project.analysisModel ? "已生成模型" : "待分析"
              }
            />
          </div>

          {/* 下一步操作 */}
          <div className="mt-auto flex items-center justify-between pt-4">
            <span className="flex items-center gap-1 text-xs text-text-3">
              <Bug className="h-3 w-3" />
              {project.issuesFound > 0
                ? `${project.issuesFound} 个待修复`
                : "暂无问题"}
            </span>
            <span className="flex items-center gap-1 text-xs text-accent">
              {display.next}
              <ArrowRight className="h-3 w-3" />
            </span>
          </div>
        </Card>
      </Link>

      {/* 卡片右上角操作按钮：编辑 + 删除 */}
      <div className="absolute right-2 top-2 flex items-center gap-1">
        <Link
          href={`/projects/${project.id}/settings`}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border-soft bg-surface/90 text-text-3 opacity-0 transition-opacity hover:border-accent/40 hover:text-accent group-hover:opacity-100"
          title="编辑项目"
          onClick={(e) => e.stopPropagation()}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border-soft bg-surface/90 text-text-3 opacity-0 transition-opacity hover:border-red-400/60 hover:text-red-500 group-hover:opacity-100"
          title="删除项目"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(project.id, project.name);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// 指标小块
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-soft bg-bg-2 px-2.5 py-2">
      <p className="text-[10px] text-text-3">{label}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-text">{value}</p>
    </div>
  );
}
