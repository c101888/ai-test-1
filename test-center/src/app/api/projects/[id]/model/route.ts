import { NextResponse } from "next/server";
import { getProjectModel } from "@/lib/store";

// 获取项目的分析结果模型
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const model = getProjectModel(id);
  if (!model) {
    return NextResponse.json(
      { error: "分析结果不存在或尚未分析" },
      { status: 404 },
    );
  }
  return NextResponse.json({ model });
}
