import { NextResponse } from "next/server";
import { abortTask, abortTaskByRunId, findTaskIdByRunId } from "@/lib/task-manager";

// 中止正在执行的高级测试
// POST /api/projects/[id]/advanced-run/[runId]/abort
// body: { taskId?: string }
// 支持两种方式：直接传 taskId，或仅传 runId（通过映射查找 taskId）
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { runId } = await params;

  let taskId: string | undefined;
  try {
    const body = await request.json();
    taskId = body?.taskId;
  } catch {
    // 无请求体
  }

  // 优先使用 taskId 中止；若无 taskId，则通过 runId 查找 taskId
  let aborted = false;
  if (taskId) {
    aborted = abortTask(taskId);
  } else {
    aborted = abortTaskByRunId(runId);
    // 通过 runId 查找到 taskId 后回填，便于响应返回
    if (aborted) {
      taskId = findTaskIdByRunId(runId);
    }
  }

  if (!aborted) {
    return NextResponse.json(
      { error: "任务不存在或已结束", runId },
      { status: 400 },
    );
  }

  return NextResponse.json({
    runId,
    taskId,
    status: "aborting",
    message: "已请求中止，任务将在当前路径执行完毕后停止",
  });
}
