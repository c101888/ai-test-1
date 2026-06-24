import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 查询积分接口
export async function GET(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      points: user.points,
      username: user.username,
    });
  } catch (error) {
    console.error("查询积分失败:", error);
    return NextResponse.json(
      { error: "查询失败，请稍后重试" },
      { status: 500 }
    );
  }
}
