import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getAdvancedTestModelForProject } from "@/lib/advanced-test-model";
import { getAdvancedTestModelForProjectAsync } from "@/lib/advanced-test-model-async";
import { classifySeededBugs } from "@/lib/issue-classifier";

// 获取高级测试模型（业务规则 + 状态不变量 + 测试路径 + Bug 分类）
// 优先调用 AI 动态生成（主体），LLM 未配置或失败时降级到预设规则匹配
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 调用异步版本（AI 动态生成为主体 + 预设规则辅助）
  const asyncModel = await getAdvancedTestModelForProjectAsync(project);
  const bugClassifications = classifySeededBugs(asyncModel.rules);

  return NextResponse.json({
    model: asyncModel,
    bugClassifications,
    // 来源标注（供前端展示徽章）
    source: asyncModel.source,
    sourceNote: asyncModel.sourceNote,
    pathSources: asyncModel.pathSources,
  });
}

// 兼容旧调用：同步版本（仅预设规则，不调用 AI）
// 保留导出供其他模块在无法 await 时使用
export function getSyncModel(projectId: string) {
  const project = getProject(projectId);
  if (!project) return null;
  return getAdvancedTestModelForProject(project);
}
