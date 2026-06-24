"use client";

import { ArrowLeft, Lock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";

// 模块占位页面：用于尚未实现的测试模块（UI/功能/安全/数据库/并发）
// 显示模块名称、功能描述、"即将上线"提示
export function ModulePlaceholder({
  projectId,
  moduleName,
  description,
  features,
}: {
  projectId: string;
  moduleName: string;
  description: string;
  features?: string[];
}) {
  return (
    <>
      <PageHeader
        eyebrow="测试中心"
        title={moduleName}
        description={description}
      />

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
        <Panel>
          <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
              <Lock className="h-8 w-8 text-text-2" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-text">
              该模块即将上线
            </h2>
            <p className="mt-2 max-w-md text-sm text-text-2">
              {moduleName}模块正在开发中，暂不可用。请先使用已上线的「高级业务测试」模块。
            </p>

            {features && features.length > 0 && (
              <div className="mt-6 w-full max-w-md text-left">
                <p className="mb-2 text-xs font-medium text-text-2">
                  规划功能：
                </p>
                <ul className="space-y-1.5">
                  {features.map((f, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-xs text-text-2"
                    >
                      <span className="mt-0.5 text-accent">·</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href={`/projects/${projectId}/modules`}
              className="mt-8 inline-flex items-center gap-1.5 rounded-md border border-border bg-transparent px-4 py-2 text-xs font-medium text-text-2 transition-colors hover:bg-surface hover:text-text"
            >
              <ArrowLeft className="h-3 w-3" />
              返回模块选择
            </Link>
          </div>
        </Panel>
      </div>
    </>
  );
}
