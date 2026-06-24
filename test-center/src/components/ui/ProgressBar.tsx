import { cn } from "@/lib/utils";

type Tone = "accent" | "warning";

// 进度条：支持 accent / warning 配色
export function ProgressBar({
  value,
  tone = "accent",
  label,
  className,
}: {
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("w-full", className)}>
      {label !== undefined && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-text-2">{label}</span>
          <span className="font-mono text-text">{v}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            tone === "accent" ? "bg-accent" : "bg-warning",
          )}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}
