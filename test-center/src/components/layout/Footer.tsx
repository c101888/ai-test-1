import { ShieldCheck } from "lucide-react";

// 底部 footer
export function Footer() {
  return (
    <footer className="border-t border-border bg-bg-2">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 text-xs text-text-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          <span>AI项目智能测试中心 · 智能化测试控制台</span>
        </div>
        <div className="font-mono">© {new Date().getFullYear()} AI Test Center</div>
      </div>
    </footer>
  );
}
