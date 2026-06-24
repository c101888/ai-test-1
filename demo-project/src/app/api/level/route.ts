import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 获取关卡列表
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);

    const levels = await prisma.level.findMany({
      orderBy: { order: "asc" },
      select: {
        id: true,
        order: true,
        title: true,
        points: true,
      },
    });

    // 如果用户已登录，查询进度
    let progressMap: Record<string, string> = {};
    if (user) {
      const progress = await prisma.progress.findMany({
        where: { userId: user.id },
        select: { levelId: true, status: true },
      });
      progressMap = Object.fromEntries(
        progress.map((p) => [p.levelId, p.status])
      );
    }

    const result = levels.map((level) => ({
      ...level,
      status: progressMap[level.id] || "locked",
    }));

    return NextResponse.json({ levels: result });
  } catch (error) {
    console.error("获取关卡列表失败:", error);
    return NextResponse.json(
      { error: "获取关卡列表失败" },
      { status: 500 }
    );
  }
}
