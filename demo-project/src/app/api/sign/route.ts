import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 签到接口
// 预埋 Bug 1: 无频率限制，可无限签到
// 正常实现应该检查今天是否已签到，但这里不检查
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    // Bug 1: 这里没有检查今天是否已签到
    // 正常实现应该是：
    // const today = new Date();
    // const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    // const alreadySigned = await prisma.signRecord.findFirst({
    //   where: {
    //     userId: user.id,
    //     createdAt: { gte: todayStart, lt: todayEnd },
    //   },
    // });
    // if (alreadySigned) {
    //   return NextResponse.json({ error: "今日已签到" }, { status: 400 });
    // }

    // 每次签到 +10 积分
    const SIGN_POINTS = 10;

    // 创建签到记录
    await prisma.signRecord.create({
      data: {
        userId: user.id,
        points: SIGN_POINTS,
      },
    });

    // 增加用户积分
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { points: { increment: SIGN_POINTS } },
      select: { id: true, username: true, points: true },
    });

    return NextResponse.json({
      message: "签到成功，获得 10 积分",
      points: updatedUser.points,
    });
  } catch (error) {
    console.error("签到失败:", error);
    return NextResponse.json(
      { error: "签到失败，请稍后重试" },
      { status: 500 }
    );
  }
}
