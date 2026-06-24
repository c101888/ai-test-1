import { cn } from "@/lib/utils";

type Risk = "low" | "medium" | "high" | "critical";

export interface FeatureItem {
  name: string;
  risk: Risk;
}

const riskColor: Record<Risk, string> = {
  low: "border-accent/30 bg-accent-dim text-accent",
  medium: "border-info/30 bg-info-dim text-info",
  high: "border-warning/30 bg-warning-dim text-warning",
  critical: "border-critical/30 bg-critical-dim text-critical",
};

const riskLabel: Record<Risk, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

// 功能地图：网格布局 + 风险色标
export function FeatureMap({
  items,
  className,
}: {
  items: FeatureItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4",
        className,
      )}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className={cn("rounded-lg border px-3 py-2.5", riskColor[it.risk])}
        >
          <p className="text-sm font-medium">{it.name}</p>
          <p className="mt-1 text-xs opacity-80">风险：{riskLabel[it.risk]}</p>
        </div>
      ))}
    </div>
  );
}
