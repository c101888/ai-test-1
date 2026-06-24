import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Phase = "accent" | "warning" | "info" | "critical" | "pass";
type Status = "done" | "active" | "pending";

export interface TimelineItem {
  title: string;
  description?: string;
  phase?: Phase;
  status?: Status;
}

const dotColor: Record<Phase, string> = {
  accent: "bg-accent",
  warning: "bg-warning",
  info: "bg-info",
  critical: "bg-critical",
  pass: "bg-accent",
};

// 时间线 / 步骤组件：支持阶段配色与完成态
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative space-y-6">
      {items.map((it, i) => {
        const phase = it.phase ?? "accent";
        const status = it.status ?? "pending";
        const last = i === items.length - 1;
        return (
          <li key={i} className="relative pl-8">
            {!last && (
              <span className="absolute left-[11px] top-6 h-[calc(100%-0.5rem)] w-px bg-border" />
            )}
            <span
              className={cn(
                "absolute left-0 top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border border-border bg-surface-2",
                status === "done" && dotColor[phase],
              )}
            >
              {status === "done" ? (
                <Check className="h-3 w-3 text-bg" />
              ) : (
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    status === "active" ? dotColor[phase] : "bg-text-3",
                  )}
                />
              )}
            </span>
            <div>
              <p className="text-sm font-medium text-text">{it.title}</p>
              {it.description && (
                <p className="mt-0.5 text-xs leading-relaxed text-text-2">
                  {it.description}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
