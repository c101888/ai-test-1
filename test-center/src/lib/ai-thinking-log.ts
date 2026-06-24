// AI 思考过程日志基础设施
// - 按 projectId + page + sessionId 分组存储 AI 思考日志
// - 每次开始新操作（分析/执行/生成报告）时开启新会话，清空旧日志
// - 刷新页面时获取当前活跃会话的日志（不消失）
// - 进入新页面或重新操作时开启新会话
// - 进程内存存储（使用 globalThis，避免热重载丢失）

import "server-only";

// ============================================================
// 类型定义
// ============================================================

export type AIThinkingPhase =
  | "thinking" // 思考中：分析问题、规划步骤
  | "acting" // 执行中：调用 API、访问页面、操作数据
  | "observing" // 观察中：读取结果、对比状态
  | "judging"; // 判定中：判断是否为 Bug、给出结论

export type AIThinkingLevel = "info" | "warning" | "error";

export interface AIThinkingLog {
  id: string; // 日志 ID（用于前端 key）
  timestamp: string; // ISO 时间戳
  phase: AIThinkingPhase; // 阶段
  content: string; // 内容
  level?: AIThinkingLevel; // 级别（默认 info）
  sessionId: string; // 会话 ID（标识当前操作）
  // 可选的附加上下文（如当前路径、当前步骤）
  context?: {
    pathId?: string;
    pathTitle?: string;
    stepIndex?: number;
    [key: string]: unknown;
  };
}

// AI 思考页面标识（对应不同接入页面）
export type AIThinkingPage =
  | "advanced-run" // 高级测试执行页
  | "analysis" // 项目分析页
  | "advanced-plan" // 高级测试计划页
  | "advanced-report" // 高级测试报告页
  | "basic-report"; // 基础测试报告页

// ============================================================
// 内存存储（使用 globalThis，避免 Turbopack 热重载/多 worker 丢失）
// ============================================================

const GLOBAL_KEY = "__tcAIThinkingLogs";

// 每个项目+页面的会话状态
interface PageSession {
  sessionId: string; // 当前活跃会话 ID
  logs: AIThinkingLog[]; // 当前会话的日志
}

// 存储结构：Map<projectId, Map<page, PageSession>>
interface AIThinkingStorage {
  storage: Map<string, Map<string, PageSession>>;
  counter: number;
}

function getStorage(): AIThinkingStorage {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: AIThinkingStorage };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      storage: new Map<string, Map<string, PageSession>>(),
      counter: 0,
    };
  }
  return g[GLOBAL_KEY]!;
}

// 每个会话最多保留的日志条数（防止内存无限增长）
const MAX_LOGS_PER_SESSION = 500;

function getPageSession(projectId: string, page: string): PageSession | undefined {
  const { storage } = getStorage();
  const projectMap = storage.get(projectId);
  if (!projectMap) return undefined;
  return projectMap.get(page);
}

function getOrCreatePageSession(projectId: string, page: string): PageSession {
  const { storage } = getStorage();
  let projectMap = storage.get(projectId);
  if (!projectMap) {
    projectMap = new Map();
    storage.set(projectId, projectMap);
  }
  let session = projectMap.get(page);
  if (!session) {
    // 自动创建初始会话
    session = { sessionId: genSessionId(), logs: [] };
    projectMap.set(page, session);
  }
  return session;
}

// ============================================================
// 生成 ID
// ============================================================

function genLogId(): string {
  const { counter } = getStorage();
  getStorage().counter = counter + 1;
  return `ait_${Date.now().toString(36)}_${(counter + 1).toString(36)}`;
}

function genSessionId(): string {
  return `ais_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// 核心函数
// ============================================================

/**
 * 开启新的 AI 思考会话
 * - 清空该页面之前的所有日志
 * - 生成新的 sessionId
 * - 后续 recordAIThinkingLog 会记录到新会话
 * @returns 新的 sessionId
 */
export function startAIThinkingSession(
  projectId: string,
  page: AIThinkingPage,
): string {
  const { storage } = getStorage();
  let projectMap = storage.get(projectId);
  if (!projectMap) {
    projectMap = new Map();
    storage.set(projectId, projectMap);
  }
  const newSession: PageSession = {
    sessionId: genSessionId(),
    logs: [],
  };
  projectMap.set(page, newSession);
  return newSession.sessionId;
}

/**
 * 获取当前活跃会话 ID（刷新页面时用于恢复显示）
 */
export function getCurrentSessionId(
  projectId: string,
  page: AIThinkingPage,
): string | null {
  const session = getPageSession(projectId, page);
  return session?.sessionId ?? null;
}

/**
 * 记录一条 AI 思考日志（记录到当前活跃会话）
 */
export function recordAIThinkingLog(
  projectId: string,
  page: AIThinkingPage,
  phase: AIThinkingPhase,
  content: string,
  options?: {
    level?: AIThinkingLevel;
    context?: AIThinkingLog["context"];
  },
): AIThinkingLog {
  const session = getOrCreatePageSession(projectId, page);
  const log: AIThinkingLog = {
    id: genLogId(),
    timestamp: new Date().toISOString(),
    phase,
    content,
    level: options?.level ?? "info",
    sessionId: session.sessionId,
    context: options?.context,
  };

  session.logs.push(log);

  // 超过上限时丢弃最早的日志
  if (session.logs.length > MAX_LOGS_PER_SESSION) {
    session.logs.splice(0, session.logs.length - MAX_LOGS_PER_SESSION);
  }

  return log;
}

/**
 * 批量记录 AI 思考日志（按顺序追加）
 */
export function recordAIThinkingLogs(
  projectId: string,
  page: AIThinkingPage,
  entries: Array<{
    phase: AIThinkingPhase;
    content: string;
    level?: AIThinkingLevel;
    context?: AIThinkingLog["context"];
  }>,
): AIThinkingLog[] {
  return entries.map((entry) =>
    recordAIThinkingLog(projectId, page, entry.phase, entry.content, {
      level: entry.level,
      context: entry.context,
    }),
  );
}

/**
 * 获取指定项目+页面的当前会话 AI 思考日志
 * - 默认返回当前活跃会话的全部日志（刷新页面时恢复显示）
 * - 支持 afterId 增量轮询
 * - 返回当前 sessionId，供前端判断是否需要清空（sessionId 变化说明开启了新会话）
 */
export function getAIThinkingLogs(
  projectId: string,
  page: AIThinkingPage,
  options?: {
    afterId?: string;
    limit?: number;
  },
): { logs: AIThinkingLog[]; sessionId: string | null } {
  const session = getPageSession(projectId, page);
  if (!session) {
    return { logs: [], sessionId: null };
  }

  let result = session.logs;
  if (options?.afterId) {
    const idx = session.logs.findIndex((l) => l.id === options.afterId);
    if (idx >= 0) {
      result = session.logs.slice(idx + 1);
    } else {
      // afterId 不在当前会话中（可能是旧会话的 ID），返回空
      // 前端会通过 sessionId 变化检测到新会话并重新加载
      result = [];
    }
  }

  const limit = options?.limit ?? 500;
  if (result.length > limit) {
    result = result.slice(-limit);
  }

  return { logs: result, sessionId: session.sessionId };
}

/**
 * 清空指定项目+页面的 AI 思考日志
 */
export function clearAIThinkingLogs(
  projectId: string,
  page?: AIThinkingPage,
): void {
  const { storage } = getStorage();
  if (!page) {
    storage.delete(projectId);
    return;
  }
  const projectMap = storage.get(projectId);
  if (projectMap) {
    projectMap.delete(page);
  }
}

/**
 * 清空指定项目的所有 AI 思考日志（项目删除时调用）
 */
export function clearAllAIThinkingLogs(projectId: string): void {
  const { storage } = getStorage();
  storage.delete(projectId);
}

// ============================================================
// 便捷工具：阶段标签（中文，供前端展示）
// ============================================================

export const phaseLabels: Record<AIThinkingPhase, string> = {
  thinking: "思考",
  acting: "执行",
  observing: "观察",
  judging: "判定",
};

export const phaseColors: Record<AIThinkingPhase, string> = {
  thinking: "info",
  acting: "accent",
  observing: "warning",
  judging: "critical",
};
