import { NextResponse } from "next/server";
import { getTask } from "@/lib/task-manager";

// 查询通用后台任务状态
// GET /api/tasks/[taskId]
// 返回 task 状态 + result + error + progress
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;

  const task = getTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  return NextResponse.json({
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    result: task.result,
    error: task.error,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    isRunning: task.status === "running",
  });
}
