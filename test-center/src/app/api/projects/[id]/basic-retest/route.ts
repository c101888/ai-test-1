import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { runBasicRetest } from "@/lib/basic-retest";
import { registerTask } from "@/lib/task-manager";

// 执行基础测试复测：异步任务模式
// POST 立即返回 taskId，后台执行，前端轮询 GET /api/tasks/[taskId] 获取进度
export const maxDuration = 300; // 5 分钟上限

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 解析请求体获取 mode 参数
  let mode: "scripted" | "real" = "scripted";
  try {
    const body = await request.json();
    if (body?.mode === "real") {
      mode = "real";
    }
  } catch {
    // 无请求体或解析失败，使用默认 scripted 模式
  }

  // 演示项目一票否决：强制剧本回放，覆盖请求体中的 mode
  // 目的：与 AI 分析/测试执行/修复指令保持一致——演示项目全程剧本
  if (project.isDemo) {
    mode = "scripted";
  }

  const taskId = `basic_retest_${id}_${Date.now()}`;
  registerTask(taskId, async (shouldAbort) => {
    const result = await runBasicRetest(id, mode, shouldAbort);
    if (!result) {
      throw new Error("未找到需要复测的问题");
    }
    return { result };
  });

  return NextResponse.json({
    taskId,
    status: "running",
    message: "复测已启动，请轮询任务状态",
  });
}
