import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { runAdvancedTests } from "@/lib/advanced-test-runner";
import { precheckProjectForExecution } from "@/lib/project-health-check";
import { registerTask, updateTaskProgress, associateRunIdWithTask } from "@/lib/task-manager";

// 高级测试执行：异步任务模式
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

  // 解析请求体（可选 mode 参数，仅用于演示项目兼容）
  let mode: "scripted" | "real" = "real";
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

  // 演示项目或 scripted 模式：跳过预检（剧本回放是纯模拟，不需要真实访问被测项目）
  const skipPrecheck = project.isDemo || mode === "scripted";

  // 执行前预检：探测项目 testUrl 可达性，必要时尝试自动启动本地项目
  // - 可达：使用真实执行（real）
  // - 不可达：返回错误（不降级到剧本回放），提示用户启动项目或配置启动命令
  // - 演示项目 / scripted 模式：跳过预检（剧本回放是纯模拟）
  if (!skipPrecheck) {
    const precheck = await precheckProjectForExecution(project);

    if (!precheck.canExecuteReal) {
      // 预检失败：返回错误原因和解决方案，不创建 run，不降级
      return NextResponse.json(
        {
          error: precheck.reason ?? "项目无法访问",
          solution: precheck.solution ?? "请启动被测项目后重新执行测试。",
        },
        { status: 503 },
      );
    }

    try {
      // 用 Promise 捕获 runId（runAdvancedTests 创建 run 后立即回调）
      let runIdResolve: (id: string) => void;
      const runIdPromise = new Promise<string>((resolve) => {
        runIdResolve = resolve;
      });

      const taskId = `adv_${id}_${Date.now()}`;
      registerTask(taskId, async (shouldAbort) => {
        const onProgress = (
          current: number,
          total: number,
          path?: { title?: string },
        ) => {
          updateTaskProgress(taskId, current, total, path?.title);
        };
        const onRunCreated = (runId: string) => {
          runIdResolve!(runId);
        };
        const { run, results } = await runAdvancedTests(
          id,
          "real",
          onProgress,
          shouldAbort,
          onRunCreated,
        );
        return { run, results };
      });

      // 等待 run 创建（120 秒超时，覆盖 AI 动态生成测试清单的时间，通常 30-60 秒）
      const runId = await Promise.race([
        runIdPromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("创建测试运行超时（AI 生成测试清单耗时过长）")), 120000),
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
        executionMode: "real",
        startedByUs: precheck.startedByUs ?? false,
      });
    } catch (error) {
      console.error("启动高级测试失败:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "启动高级测试失败" },
        { status: 500 },
      );
    }
  }

  // 演示项目 / scripted 模式：直接执行剧本回放（同步完成，无需预检）
  try {
    let runIdResolve: (id: string) => void;
    const runIdPromise = new Promise<string>((resolve) => {
      runIdResolve = resolve;
    });

    const taskId = `adv_${id}_${Date.now()}`;
    registerTask(taskId, async (shouldAbort) => {
      const onProgress = (
        current: number,
        total: number,
        path?: { title?: string },
      ) => {
        updateTaskProgress(taskId, current, total, path?.title);
      };
      const onRunCreated = (runId: string) => {
        runIdResolve!(runId);
      };
      const { run, results } = await runAdvancedTests(
        id,
        "scripted",
        onProgress,
        shouldAbort,
        onRunCreated,
      );
      return { run, results };
    });

    // 等待 run 创建（演示项目剧本回放通常很快，60 秒超时）
    const runId = await Promise.race([
      runIdPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("创建测试运行超时")), 60000),
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
      executionMode: "scripted",
      startedByUs: false,
    });
  } catch (error) {
    console.error("启动高级测试失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "启动高级测试失败" },
      { status: 500 },
    );
  }
}
