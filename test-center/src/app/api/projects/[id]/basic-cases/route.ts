import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getOrGenerateBasicCases } from "@/lib/basic-test-runner";
import { categoryLabels, categoryOrder } from "@/lib/basic-test-cases";

// 获取基础测试用例
// 返回：用例列表 + 按 6 大类分组
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const cases = getOrGenerateBasicCases(id);

  // 按 6 大类分组
  const grouped = categoryOrder.map((cat) => ({
    category: cat,
    label: categoryLabels[cat],
    cases: cases.filter((c) => c.category === cat),
  }));

  return NextResponse.json({
    cases,
    grouped,
    total: cases.length,
  });
}
