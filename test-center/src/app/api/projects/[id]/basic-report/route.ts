import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { generateBasicReport } from "@/lib/basic-test-report";

// 获取基础测试报告
// - 包含：摘要、通过数、失败数、阻断数、失败详情、修复指南包
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const report = await generateBasicReport(id);
  if (!report) {
    return NextResponse.json(
      { error: "尚未执行基础测试，无法生成报告" },
      { status: 404 },
    );
  }

  return NextResponse.json({ report });
}
