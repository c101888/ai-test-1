import { cn } from "@/lib/utils";

// 页面标题区域：eyebrow 标签 + 主标题 + 描述 + 可选操作
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("relative border-b border-border bg-bg-2 bg-grid", className)}>
      <div className="mx-auto max-w-7xl px-6 py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
          {eyebrow}
        </p>
        <div className="mt-3 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-2">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      </div>
    </div>
  );
}
