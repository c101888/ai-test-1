// 进程退出清理钩子
// 在进程退出时（正常退出 / SIGTERM / SIGINT）清理活跃任务状态，
// 避免任务永远停留在 "running" 状态导致前端无限等待。
import { listTasks } from "./task-manager";

if (typeof process !== "undefined") {
  const cleanup = () => {
    try {
      const tasks = listTasks();
      for (const task of tasks) {
        if (task.status === "running") {
          task.status = "failed";
          task.error = "进程退出时未完成";
          task.finishedAt = new Date().toISOString();
        }
      }
    } catch {
      // 忽略清理错误
    }
  };
  process.on("exit", cleanup);
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
}
