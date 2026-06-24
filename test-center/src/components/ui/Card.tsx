import { cn } from "@/lib/utils";

// 卡片容器：surface 背景 + border
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}
