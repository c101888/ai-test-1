"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Brain,
  Activity,
  Eye,
  Gavel,
  Info,
  AlertTriangle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "./Badge";

// ============================================================
// 类型定义（与 ai-thinking-log.ts 保持一致，但客户端独立定义避免 server-only 污染）
// ============================================================

export type AIThinkingPhase =
  | "thinking"
  | "acting"
  | "observing"
  | "judging";

export type AIThinkingLevel = "info" | "warning" | "error";

export interface AIThinkingLog {
  id: string;
  timestamp: string;
  phase: AIThinkingPhase;
  content: string;
  level?: AIThinkingLevel;
  context?: {
    pathId?: string;
    pathTitle?: string;
    stepIndex?: number;
    [key: string]: unknown;
  };
}

// ============================================================
// 阶段配置：图标 + 颜色 + 中文标签
// ============================================================

const phaseConfig: Record<
  AIThinkingPhase,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    badgeSeverity: "info" | "accent" | "warning" | "critical";
  }
> = {
  thinking: {
    label: "思考",
    icon: Brain,
    color: "text-info",
    badgeSeverity: "info",
  },
  acting: {
    label: "执行",
    icon: Activity,
    color: "text-accent",
    badgeSeverity: "accent",
  },
  observing: {
    label: "观察",
    icon: Eye,
    color: "text-warning",
    badgeSeverity: "warning",
  },
  judging: {
    label: "判定",
    icon: Gavel,
    color: "text-critical",
    badgeSeverity: "critical",
  },
};

const levelConfig: Record<
  AIThinkingLevel,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  info: { icon: Info, color: "text-text-3" },
  warning: { icon: AlertTriangle, color: "text-warning" },
  error: { icon: AlertCircle, color: "text-critical" },
};

// ============================================================
// 时间格式化
// ============================================================

function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

// ============================================================
// AIThinkingPanel 组件
// ============================================================

export interface AIThinkingPanelProps {
  /** 窗口标题（默认"AI 思考过程"） */
  title?: string;
  /** 思考日志数组 */
  logs: AIThinkingLog[];
  /** 是否正在加载（显示加载动画） */
  loading?: boolean;
  /** 是否自动滚动到最新日志（默认 true） */
  autoScroll?: boolean;
  /** 空状态文案 */
  emptyText?: string;
  /** 额外 className */
  className?: string;
}

export function AIThinkingPanel({
  title = "AI 思考过程",
  logs,
  loading = false,
  autoScroll = true,
  emptyText = "AI 尚未开始思考，点击「开始执行」后此处会实时显示 AI 的思考与操作过程。",
  className,
}: AIThinkingPanelProps) {
  // 默认收起；刷新后强制收起（用 sessionStorage 标记本次会话已刷新）
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // 初始化时强制收起（刷新后默认收起）
  useEffect(() => {
    // 检测是否是本次会话的首次加载（刷新后强制收起）
    // 用 sessionStorage 标记：如果标记不存在，说明是刷新/首次加载，强制收起
    // 之后用户手动展开/收起由组件内部状态管理
    setExpanded(false);
  }, []);

  // 自动滚动到最新日志
  useEffect(() => {
    if (expanded && autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [logs, expanded, autoScroll]);

  const logCount = logs.length;
  const lastLog = logs[logs.length - 1];

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface",
        className,
      )}
    >
      {/* 标题栏（可点击展开/收起） */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 border-b border-border-soft px-5 py-3 text-left transition-colors hover:bg-bg-2"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-3" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-3" />
          )}
          <Brain className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          {/* 日志条数徽章 */}
          {logCount > 0 && (
            <Badge severity="accent">{logCount} 条</Badge>
          )}
          {/* 加载动画 */}
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          )}
          {/* 最新日志摘要（收起时显示） */}
          {!expanded && lastLog && (
            <span className="hidden truncate text-xs text-text-3 sm:inline-block sm:max-w-md">
              <span className={phaseConfig[lastLog.phase].color}>
                [{phaseConfig[lastLog.phase].label}]
              </span>{" "}
              {lastLog.content}
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs text-text-3">
          {expanded ? "点击收起" : "点击展开"}
        </span>
      </button>

      {/* 日志内容（展开时显示） */}
      {expanded && (
        <div
          ref={bodyRef}
          className="max-h-[400px] overflow-y-auto px-5 py-3"
        >
          {logCount === 0 ? (
            <p className="py-6 text-center text-xs text-text-3">
              {loading ? "AI 正在思考中…" : emptyText}
            </p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log) => {
                const phase = phaseConfig[log.phase];
                const level = levelConfig[log.level ?? "info"];
                const PhaseIcon = phase.icon;
                const LevelIcon = level.icon;
                return (
                  <li
                    key={log.id}
                    className="flex items-start gap-2 rounded-md border border-border-soft bg-bg-2 px-3 py-2"
                  >
                    {/* 时间戳 */}
                    <span className="mt-0.5 shrink-0 font-mono text-xs text-text-3">
                      {formatTime(log.timestamp)}
                    </span>
                    {/* 阶段图标 */}
                    <PhaseIcon
                      className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", phase.color)}
                    />
                    {/* 阶段标签 */}
                    <Badge severity={phase.badgeSeverity} className="mt-0.5 shrink-0">
                      {phase.label}
                    </Badge>
                    {/* 内容 */}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-relaxed text-text">
                        {log.content}
                      </p>
                      {/* 上下文信息 */}
                      {log.context?.pathTitle && (
                        <p className="mt-1 text-xs text-text-3">
                          <span className="font-mono">
                            [{log.context.pathId ?? ""}]
                          </span>{" "}
                          {log.context.pathTitle}
                          {typeof log.context.stepIndex === "number" &&
                            ` · 步骤 ${log.context.stepIndex}`}
                        </p>
                      )}
                    </div>
                    {/* 级别图标（非 info 时显示） */}
                    {log.level && log.level !== "info" && (
                      <LevelIcon
                        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", level.color)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {/* 底部加载提示 */}
          {loading && logCount > 0 && (
            <div className="mt-2 flex items-center justify-center gap-1.5 py-2 text-xs text-accent">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>AI 正在思考中…</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
