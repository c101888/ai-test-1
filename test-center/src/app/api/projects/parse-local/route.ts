import { NextResponse } from "next/server";
import { parseLocalProject } from "@/lib/project-parser";

// 本地路径解析 API（不绑定到特定项目，用于接入页预览）
// POST：接收 { path: string }，返回 ParsedProjectInfo
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const projectPath = body.path;

    if (!projectPath || typeof projectPath !== "string") {
      return NextResponse.json(
        { error: "未提供项目路径" },
        { status: 400 },
      );
    }

    const parsedInfo = await parseLocalProject(projectPath);
    return NextResponse.json({ parsedInfo });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "解析项目失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
