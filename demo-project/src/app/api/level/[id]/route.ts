import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 获取单个关卡详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    const { id } = await params;

    const level = await prisma.level.findUnique({
      where: { id },
      select: {
        id: true,
        order: true,
        title: true,
        question: true,
        points: true,
      },
    });

    if (!level) {
      return NextResponse.json(
        { error: "关卡不存在" },
        { status: 404 }
      );
    }

    return NextResponse.json({ level });
  } catch (error) {
    console.error("获取关卡详情失败:", error);
    return NextResponse.json(
      { error: "获取关卡详情失败" },
      { status: 500 }
    );
  }
}
