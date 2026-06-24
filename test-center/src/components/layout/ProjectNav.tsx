"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// 项目子导航：模块化架构（分析 → 模块中心 → 最终验收）
// 模块中心下展开 6 个模块子链接
const links = [
  { href: "analysis", label: "分析" },
  { href: "modules", label: "模块中心" },
  { href: "ui-test/plan", label: "UI 测试", disabled: true },
  { href: "functional/plan", label: "功能测试", disabled: true },
  { href: "advanced/plan", label: "业务测试" },
  { href: "security-test/plan", label: "安全测试", disabled: true },
  { href: "database-test/plan", label: "数据库测试", disabled: true },
  { href: "concurrency-test/plan", label: "并发测试", disabled: true },
  { href: "final", label: "最终验收" },
];

export function ProjectNav({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/projects/${id}`;

  return (
    <div className="border-b border-border bg-bg">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 py-2">
        {links.map((l) => {
          const href = `${base}/${l.href}`;
          const active = pathname === href || pathname.startsWith(href + "/");
          const disabled = "disabled" in l && l.disabled;

          if (disabled) {
            return (
              <span
                key={l.href}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-text-2/50"
                title="该模块即将上线，暂不可用"
              >
                {l.label}
              </span>
            );
          }

          return (
            <Link
              key={l.href}
              href={href}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-xs transition-colors",
                active
                  ? "bg-accent-dim text-accent"
                  : "text-text-2 hover:bg-surface hover:text-text",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
