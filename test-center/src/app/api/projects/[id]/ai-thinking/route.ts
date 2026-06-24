import { NextResponse } from "next/server";
import { getAIThinkingLogs, clearAIThinkingLogs, startAIThinkingSession, type AIThinkingPage } from "@/lib/ai-thinking-log";

// AI 思考过程日志 API（会话模式）
// GET /api/projects/[id]/ai-thinking?page=advanced-run&afterId=xxx&limit=500
// - 获取指定项目+页面的当前会话 AI 思考日志
// - 返回 sessionId，前端据此判断是否开启新会话（sessionId 变化时清空旧日志重新加载）
// - 刷新页面时不传 afterId，获取当前会话全部日志（不消失）
// POST /api/projects/[id]/ai-thinking?page=advanced-run
// - 开启新会话（清空旧日志，生成新 sessionId）
// - 用于"开始分析/开始执行/生成报告"等操作触发
// DELETE /api/projects/[id]/ai-thinking?page=advanced-run
// - 清空指定项目+页面的所有日志

const VALID_PAGES: AIThinkingPage[] = [
  "advanced-run",
  "analysis",
  "advanced-plan",
  "advanced-report",
  "basic-report",
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const url = new URL(_request.url);
  const page = url.searchParams.get("page") as AIThinkingPage | null;
  const afterId = url.searchParams.get("afterId") || undefined;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 500, 1000) : 500;

  if (!page) {
    return NextResponse.json(
      { error: "缺少 page 参数" },
      { status: 400 },
    );
  }

  if (!VALID_PAGES.includes(page)) {
    return NextResponse.json(
      { error: `无效的 page 参数：${page}，支持：${VALID_PAGES.join(", ")}` },
      { status: 400 },
    );
  }

  const { logs, sessionId } = getAIThinkingLogs(id, page, { afterId, limit });

  return NextResponse.json({
    projectId: id,
    page,
    sessionId,
    logs,
    count: logs.length,
    lastId: logs.length > 0 ? logs[logs.length - 1].id : null,
  });
}

// 开启新会话（用于"开始分析/开始执行/生成报告"等操作触发）
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const url = new URL(_request.url);
  const page = url.searchParams.get("page") as AIThinkingPage | null;

  if (!page) {
    return NextResponse.json(
      { error: "缺少 page 参数" },
      { status: 400 },
    );
  }

  if (!VALID_PAGES.includes(page)) {
    return NextResponse.json(
      { error: `无效的 page 参数：${page}` },
      { status: 400 },
    );
  }

  const sessionId = startAIThinkingSession(id, page);
  return NextResponse.json({ ok: true, sessionId, page });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const url = new URL(_request.url);
  const page = url.searchParams.get("page") as AIThinkingPage | null;

  if (page) {
    if (!VALID_PAGES.includes(page)) {
      return NextResponse.json(
        { error: `无效的 page 参数：${page}` },
        { status: 400 },
      );
    }
    clearAIThinkingLogs(id, page);
    return NextResponse.json({ ok: true, cleared: page });
  }

  clearAIThinkingLogs(id);
  return NextResponse.json({ ok: true, cleared: "all" });
}
