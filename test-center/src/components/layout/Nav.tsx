"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

// 顶部全局导航：品牌名 + 导航链接 + 提交项目按钮
const navLinks = [
  { href: "/", label: "首页" },
  { href: "/projects/new", label: "项目接入" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-dim text-accent">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold tracking-wide text-text">
            AI项目智能测试中心
          </span>
        </Link>

        {/* 桌面端显示完整导航链接，手机端隐藏只保留品牌名与提交项目按钮 */}
        <nav className="hidden items-center gap-1 sm:flex">
          {navLinks.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-surface text-text"
                    : "text-text-2 hover:bg-surface/60 hover:text-text",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden font-mono text-xs text-text-3 sm:inline">
            v0.1 · skeleton
          </span>
          {/* 设置入口：齿轮图标 + 文字，当前页高亮 */}
          <Link
            href="/settings"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              pathname === "/settings"
                ? "bg-surface text-text"
                : "text-text-2 hover:bg-surface/60 hover:text-text",
            )}
            title="LLM 配置"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">设置</span>
          </Link>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-bg transition-colors hover:bg-accent/90"
          >
            提交项目
          </Link>
        </div>
      </div>
    </header>
  );
}
