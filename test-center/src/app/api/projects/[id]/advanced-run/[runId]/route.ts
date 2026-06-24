import { NextResponse } from "next/server";
import { getAdvancedTestRun, getAdvancedTestResults } from "@/lib/store";
import { getTask, findTaskIdByRunId } from "@/lib/task-manager";

// 查询高级测试运行进度
// GET /api/projects/[id]/advanced-run/[runId]
// 返回 run 状态 + 已完成的 results + 任务进度（含当前执行项名称）
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;

  const run = getAdvancedTestRun(runId);
  if (!run) {
    return NextResponse.json({ error: "测试运行不存在" }, { status: 404 });
  }
  if (run.projectId !== id) {
    return NextResponse.json({ error: "项目不匹配" }, { status: 403 });
  }

  // 获取已保存的结果（实时更新）
  const results = getAdvancedTestResults(runId);

  // 从 task-manager 获取进度（含 currentLabel）
  let progress: { current: number; total: number; currentLabel?: string } = {
    current: results.length,
    total: run.total,
  };
  const taskId = findTaskIdByRunId(runId);
  if (taskId) {
    const task = getTask(taskId);
    if (task) {
      progress = {
        current: task.progress.current,
        total: task.progress.total,
        currentLabel: task.progress.currentLabel,
      };
    }
  }

  return NextResponse.json({
    run,
    results,
    progress,
    // 任务是否仍在运行
    isRunning: run.status === "running",
  });
}
