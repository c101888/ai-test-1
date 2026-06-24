"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { cn } from "@/lib/utils";

// 轻量语法高亮：注释行（# 或 //）置灰，其余保持正文色
function highlight(code: string) {
  return code.split("\n").map((line, i) => {
    const isComment = /^\s*(#|\/\/)/.test(line);
    return (
      <span
        key={i}
        className={isComment ? "text-text-3" : "text-text"}
      >
        {line}
        {"\n"}
      </span>
    );
  });
}

// AI 修复指令包：等宽字体 + 语法高亮 + 复制按钮 + 下载按钮
export function FixPack({
  code,
  title = "AI 修复指令包",
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略剪贴板权限错误
    }
  };

  const download = () => {
    // 用 Blob + a.click() 导出 .md 文件
    const blob = new Blob([code], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // 用 title 作为文件名，去除不安全字符
    const safeName = (title || "fix-instruction").replace(/[^\w\u4e00-\u9fa5-]/g, "_");
    a.download = `${safeName}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 1500);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-bg-2",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border-soft px-4 py-2">
        <span className="font-mono text-xs text-text-2">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-accent" />
                已复制
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                复制
              </>
            )}
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
          >
            {downloaded ? (
              <>
                <Check className="h-3 w-3 text-accent" />
                已下载
              </>
            ) : (
              <>
                <Download className="h-3 w-3" />
                下载
              </>
            )}
          </button>
        </div>
      </header>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">
        <code>{highlight(code)}</code>
      </pre>
    </div>
  );
}
