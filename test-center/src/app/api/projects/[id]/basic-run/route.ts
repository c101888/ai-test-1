import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { runBasicTests } from "@/lib/basic-test-runner";
import { registerTask, updateTaskProgress, associateRunIdWithTask } from "@/lib/task-manager";

// 基础测试执行：异步任务模式
// POST 立即返回 runId，后台执行，前端轮询 GET 获取进度
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

  // 解析请求体（可选 mode 参数）
  let mode: "scripted" | "real" = "scripted";
  try {
    const body = await request.json();
    if (body?.mode === "real" || body?.mode === "scripted") {
      mode = body.mode;
    }
  } catch {
    // 无请求体或解析失败，使用默认值
  }

  // 演示项目一票否决：强制剧本回放，覆盖请求体中的 mode
  // 目的：与 AI 分析/修复指令保持一致——演示项目全程剧本，不调用真实 LLM/Playwright
  if (project.isDemo) {
    mode = "scripted";
  }

  try {
    // 用 Promise 捕获 runId（runBasicTests 创建 run 后立即回调）
    let runIdResolve: (id: string) => void;
    const runIdPromise = new Promise<string>((resolve) => {
      runIdResolve = resolve;
    });

    const taskId = `basic_${id}_${Date.now()}`;
    registerTask(taskId, async (shouldAbort) => {
      const onProgress = (
        current: number,
        total: number,
        currentCase?: { title?: string },
      ) => {
        updateTaskProgress(taskId, current, total, currentCase?.title);
      };
      const onRunCreated = (runId: string) => {
        runIdResolve!(runId);
      };
      const { run, results } = await runBasicTests(
        id,
        mode,
        onProgress,
        shouldAbort,
        onRunCreated,
      );
      return { run, results };
    });

    // 等待 run 创建（10 秒超时）
    const runId = await Promise.race([
      runIdPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("创建测试运行超时")), 10000),
      ),
    ]).catch(() => null);

    if (!runId) {
      return NextResponse.json(
        { error: "启动测试失败：无法创建测试运行" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      runId,
      taskId,
      status: "running",
    });
  } catch (error) {
    console.error("启动基础测试失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "启动基础测试失败" },
      { status: 500 },
    );
  }
}
