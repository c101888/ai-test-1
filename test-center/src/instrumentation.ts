// Next.js Instrumentation 启动钩子
// 在 Node.js 运行时启动时加载进程退出清理逻辑
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/process-cleanup");
  }
}
