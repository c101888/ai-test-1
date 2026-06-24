import { cn } from "@/lib/utils";

// 面板：带 header（标题 / 描述 / 操作）+ body 的容器
export function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-border-soft px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h3 className="text-sm font-semibold text-text">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-text-2">
                {description}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn("px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}
