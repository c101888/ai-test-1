import { NextResponse } from "next/server";
import {
  getProject,
  getFinalReport,
  getAdvancedRetestResult,
  getProjectRegressionCases,
} from "@/lib/store";
import { runAdvancedRetest } from "@/lib/advanced-retest";
import { registerTask } from "@/lib/task-manager";

// 生成最终质量结论：异步任务模式
// POST 立即返回 taskId，后台执行，前端轮询 GET /api/tasks/[taskId] 获取进度
export const maxDuration = 300; // 5 分钟上限

// 获取最终质量结论（仅查询，不执行副作用操作）
// - 返回：
//   - report: 最终质量报告（结论等级、质量维度、剩余风险、Bug 总览）
//   - retestResult: 三级回归复测结果（第一层/第二层/第三层详情）
//   - regressionCases: 防回归用例列表（沉淀的长期用例）
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const report = getFinalReport(id);
  if (!report) {
    return NextResponse.json(
      { error: "尚未生成最终报告，请先完成高级测试与复测，或点击「生成最终报告」按钮" },
      { status: 404 },
    );
  }

  // 同时返回三级回归复测结果与防回归用例
  const retestResult = getAdvancedRetestResult(id);
  const regressionCases = getProjectRegressionCases(id);

  return NextResponse.json({
    report,
    retestResult,
    regressionCases,
  });
}

// 生成最终质量结论（执行三级回归复测 + 生成报告）：异步任务模式
// - 请求体：{ mode?: "scripted" | "real" }（默认 "scripted"）
// - 立即返回 taskId，前端轮询 GET /api/tasks/[taskId] 获取进度
// - 任务完成后，前端再调用 GET /api/projects/[id]/final-report 获取最终报告
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

  const taskId = `final_report_${id}_${Date.now()}`;
  registerTask(taskId, async (shouldAbort) => {
    await runAdvancedRetest(id, mode, shouldAbort);
    const report = getFinalReport(id);
    if (!report) {
      throw new Error("生成最终报告失败，请先完成高级测试");
    }
    const retestResult = getAdvancedRetestResult(id);
    const regressionCases = getProjectRegressionCases(id);
    return { report, retestResult, regressionCases };
  });

  return NextResponse.json({
    taskId,
    status: "running",
    message: "最终报告生成已启动，请轮询任务状态",
  });
}
