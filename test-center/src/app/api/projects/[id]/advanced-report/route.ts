import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { generateAdvancedReport } from "@/lib/advanced-test-report";

// 获取高级业务测试报告
// - 包含：摘要、发现问题数、按分类统计、问题详情、AI 修复指令
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const report = await generateAdvancedReport(id);
  if (!report) {
    return NextResponse.json(
      { error: "尚未执行高级测试，无法生成报告" },
      { status: 404 },
    );
  }

  return NextResponse.json({ report });
}
