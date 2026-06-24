// 后台任务管理器
// 轻量级进程内任务管理，不引入外部队列依赖
// 使用 globalThis 持久化任务状态，避免热重载丢失

export interface BackgroundTask {
  id: string;
  status: "running" | "done" | "failed" | "aborted";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  progress: {
    current: number;
    total: number;
    currentLabel?: string; // 当前执行项的名称（如"连续签到测试"）
  };
  // 任务结果（done 时填充）
  result?: unknown;
}

interface TaskRegistry {
  tasks: Map<string, BackgroundTask>;
  abortFlags: Set<string>; // 已请求中止的任务 id
  runIdToTaskId: Map<string, string>; // runId → taskId 映射
}

const GLOBAL_KEY = "__tcTaskRegistry";

function getRegistry(): TaskRegistry {
  const g = globalThis as unknown as { [GLOBAL_KEY]?: TaskRegistry };
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      tasks: new Map<string, BackgroundTask>(),
      abortFlags: new Set<string>(),
      runIdToTaskId: new Map<string, string>(),
    };
  }
  return g[GLOBAL_KEY]!;
}

/**
 * 注册并启动后台任务（不 await，立即返回 task）
 * 任务函数接收一个 shouldAbort 回调，用于检查是否被请求中止
 * @param timeoutMs 任务级超时（毫秒），默认 300000（5 分钟）。超时后标记 failed 并设置 abortFlag
 */
export function registerTask(
  id: string,
  fn: (shouldAbort: () => boolean) => Promise<unknown>,
  timeoutMs: number = 300000,
): BackgroundTask {
  const registry = getRegistry();
  const task: BackgroundTask = {
    id,
    status: "running",
    startedAt: new Date().toISOString(),
    progress: { current: 0, total: 0 },
  };
  registry.tasks.set(id, task);

  const shouldAbort = () => registry.abortFlags.has(id);

  // 超时 Promise：超时后 reject，触发 catch 分支
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error("任务执行超时"));
    }, timeoutMs);
  });

  // 用 Promise.race 包裹 fn 和超时，防止 fn 内部永不 settle 导致任务卡死
  Promise.race([fn(shouldAbort), timeoutPromise])
    .then((result) => {
      const existing = registry.tasks.get(id);
      if (existing) {
        existing.status = registry.abortFlags.has(id) ? "aborted" : "done";
        existing.finishedAt = new Date().toISOString();
        existing.result = result;
      }
    })
    .catch((err) => {
      const existing = registry.tasks.get(id);
      if (!existing) return;
      const isTimeout =
        err instanceof Error && err.message === "任务执行超时";
      if (isTimeout) {
        // 超时后设置 abortFlag，让 fn 内部的 shouldAbort 检查能感知
        registry.abortFlags.add(id);
        // 标记 task 为 failed，error 设为 "任务执行超时"
        existing.status = "failed";
        existing.finishedAt = new Date().toISOString();
        existing.error = "任务执行超时";
      } else {
        existing.status = registry.abortFlags.has(id) ? "aborted" : "failed";
        existing.finishedAt = new Date().toISOString();
        existing.error = err instanceof Error ? err.message : String(err);
      }
    })
    .finally(() => {
      registry.abortFlags.delete(id);
    });

  return task;
}

/**
 * 注册并启动后台任务，同时建立 runId → taskId 映射（不 await，立即返回 task）
 * 适用于注册时已知 runId 的场景
 * @param taskId 任务 id
 * @param runId 测试运行 id
 * @param fn 任务函数
 * @param timeoutMs 任务级超时（毫秒），默认 300000（5 分钟）
 */
export function registerTaskWithRunId(
  taskId: string,
  runId: string,
  fn: (shouldAbort: () => boolean) => Promise<unknown>,
  timeoutMs: number = 300000,
): BackgroundTask {
  const registry = getRegistry();
  registry.runIdToTaskId.set(runId, taskId);
  return registerTask(taskId, fn, timeoutMs);
}

/**
 * 为已注册的任务建立 runId → taskId 映射
 * 适用于 runId 在任务执行过程中（如 onRunCreated 回调）才获得的场景
 */
export function associateRunIdWithTask(taskId: string, runId: string): void {
  const registry = getRegistry();
  registry.runIdToTaskId.set(runId, taskId);
}

/** 通过 runId 查找 taskId */
export function findTaskIdByRunId(runId: string): string | undefined {
  return getRegistry().runIdToTaskId.get(runId);
}

/** 通过 runId 中止任务（内部查找 taskId 后调用 abortTask） */
export function abortTaskByRunId(runId: string): boolean {
  const taskId = findTaskIdByRunId(runId);
  if (!taskId) {
    return false;
  }
  return abortTask(taskId);
}

/** 查询任务状态 */
export function getTask(id: string): BackgroundTask | undefined {
  return getRegistry().tasks.get(id);
}

/** 列出所有任务 */
export function listTasks(): BackgroundTask[] {
  return Array.from(getRegistry().tasks.values());
}

/** 获取所有活跃任务（status === "running"），用于进程退出清理 */
export function getAllActiveTasks(): BackgroundTask[] {
  return Array.from(getRegistry().tasks.values()).filter(
    (t) => t.status === "running",
  );
}

/** 请求中止任务（runRealAdvancedTests 在循环中检查 abort 标记） */
export function abortTask(id: string): boolean {
  const registry = getRegistry();
  const task = registry.tasks.get(id);
  if (!task || task.status !== "running") {
    return false;
  }
  registry.abortFlags.add(id);
  return true;
}

/** 更新任务进度 */
export function updateTaskProgress(
  id: string,
  current: number,
  total: number,
  currentLabel?: string,
): void {
  const registry = getRegistry();
  const task = registry.tasks.get(id);
  if (task) {
    task.progress = { current, total, currentLabel };
  }
}

/** 检查任务是否已被请求中止 */
export function isTaskAborted(id: string): boolean {
  return getRegistry().abortFlags.has(id);
}
