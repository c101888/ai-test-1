import { cn } from "@/lib/utils";

type Severity = "critical" | "warning" | "info" | "accent" | "pass";

const styles: Record<Severity, string> = {
  critical: "bg-critical-dim text-critical border-critical/30",
  warning: "bg-warning-dim text-warning border-warning/30",
  info: "bg-info-dim text-info border-info/30",
  accent: "bg-accent-dim text-accent border-accent/30",
  pass: "bg-accent-dim text-accent border-accent/30",
};

// 徽章：支持 severity 配色
export function Badge({
  severity = "accent",
  children,
  className,
}: {
  severity?: Severity;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium",
        styles[severity],
        className,
      )}
    >
      {children}
    </span>
  );
}
