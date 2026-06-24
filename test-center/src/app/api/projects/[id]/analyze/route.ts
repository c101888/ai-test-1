import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { runAnalysis } from "@/lib/analysis-service";
import { isLLMConfigured } from "@/lib/llm-config";
import { LLMError } from "@/lib/llm-client";

// 触发 AI 分析：调用 LLM 分析项目代码与文档，返回 B1-B7 七类分析结果
// - LLM 未配置时返回 400（演示项目除外，演示项目自动降级到预定义分析）
// - LLM 调用失败时返回 500（演示项目除外，演示项目自动降级到预定义分析）
// - 成功时返回分析结果
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = getProject(id);
  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  // 预检查 LLM 配置：非演示项目未配置时直接返回 400
  if (!isLLMConfigured() && !existing.isDemo) {
    return NextResponse.json(
      {
        error: "LLM 未配置，无法进行 AI 分析。请在设置页配置 LLM API。",
        code: "llm_not_configured",
      },
      { status: 400 },
    );
  }

  try {
    const model = await runAnalysis(id);
    if (!model) {
      return NextResponse.json(
        { error: "分析失败：未生成分析结果" },
        { status: 500 },
      );
    }
    return NextResponse.json({ model });
  } catch (error) {
    // 区分 LLM 错误类型，返回友好的错误信息
    if (error instanceof LLMError) {
      const statusMap: Record<LLMError["code"], number> = {
        config: 400,
        auth: 401,
        quota: 429,
        timeout: 504,
        network: 502,
        server: 502,
        parse: 502,
      };
      const status = statusMap[error.code] ?? 500;
      return NextResponse.json(
        {
          error: `AI 分析失败：${error.message}`,
          code: error.code,
        },
        { status },
      );
    }

    // 其他错误
    const message =
      error instanceof Error ? error.message : "分析失败";
    return NextResponse.json(
      { error: message, code: "unknown" },
      { status: 500 },
    );
  }
}
