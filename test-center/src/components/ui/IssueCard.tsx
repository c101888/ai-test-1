import { cn } from "@/lib/utils";
import { Badge } from "./Badge";

type Severity = "critical" | "warning" | "info";

const bar: Record<Severity, string> = {
  critical: "bg-critical",
  warning: "bg-warning",
  info: "bg-info",
};

const severityLabel: Record<Severity, string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

export interface IssueCardProps {
  title: string;
  severity: Severity;
  steps?: string[];
  evidence?: string;
  fix?: string;
  className?: string;
}

// 问题卡片：左侧严重等级色条 + 标题 + 复现步骤 + 证据 + 修复包
export function IssueCard({
  title,
  severity,
  steps,
  evidence,
  fix,
  className,
}: IssueCardProps) {
  return (
    <article
      className={cn(
        "flex overflow-hidden rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <div className={cn("w-1 shrink-0", bar[severity])} />
      <div className="flex-1 p-4">
        <div className="flex items-center gap-2">
          <Badge severity={severity}>{severityLabel[severity]}</Badge>
          <h4 className="text-sm font-semibold text-text">{title}</h4>
        </div>

        {steps && steps.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-text-2">复现步骤</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-text-2">
              {steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}

        {evidence && (
          <div className="mt-3">
            <p className="text-xs font-medium text-text-2">证据</p>
            <pre className="mt-1 overflow-x-auto rounded bg-bg-2 p-2 font-mono text-xs text-text-2">
              {evidence}
            </pre>
          </div>
        )}

        {fix && (
          <div className="mt-3">
            <p className="text-xs font-medium text-text-2">修复包</p>
            <pre className="mt-1 overflow-x-auto rounded bg-bg-2 p-2 font-mono text-xs text-accent">
              {fix}
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}
