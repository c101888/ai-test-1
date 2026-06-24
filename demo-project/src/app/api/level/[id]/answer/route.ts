import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 答题接口
// 预埋 Bug 4: 不校验前置关卡是否完成，可直接答任意关
// 预埋 Bug 5: 不更新 Progress 状态（积分正常增加，但进度不持久化）
export async function POST(
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
    const body = await request.json();
    const { answer } = body;

    if (!answer) {
      return NextResponse.json(
        { error: "请输入答案" },
        { status: 400 }
      );
    }

    // 查找关卡
    const level = await prisma.level.findUnique({
      where: { id },
    });

    if (!level) {
      return NextResponse.json(
        { error: "关卡不存在" },
        { status: 404 }
      );
    }

    // Bug 4: 这里没有校验该关卡是否已解锁
    // 正常实现应该是：
    // const progress = await prisma.progress.findFirst({
    //   where: { userId: user.id, levelId: level.id },
    // });
    // if (!progress || progress.status !== "unlocked") {
    //   return NextResponse.json({ error: "该关卡尚未解锁" }, { status: 403 });
    // }

    // 校验答案（去除首尾空格，不区分大小写）
    const isCorrect =
      answer.trim().toLowerCase() === level.answer.trim().toLowerCase();

    if (!isCorrect) {
      return NextResponse.json({
        correct: false,
        message: "答案错误，再试试看",
      });
    }

    // 答案正确，增加积分
    await prisma.user.update({
      where: { id: user.id },
      data: { points: { increment: level.points } },
    });

    // Bug 5: 这里不更新 Progress 状态
    // 正常实现应该是：
    // await prisma.progress.upsert({
    //   where: { userId_levelId: { userId: user.id, levelId: level.id } },
    //   update: { status: "completed", completedAt: new Date() },
    //   create: {
    //     userId: user.id,
    //     levelId: level.id,
    //     status: "completed",
    //     completedAt: new Date(),
    //   },
    // });

    // 解锁下一关（这部分保留，但不影响 Bug 4 和 Bug 5）
    const nextLevel = await prisma.level.findFirst({
      where: { order: level.order + 1 },
    });

    if (nextLevel) {
      const existingProgress = await prisma.progress.findFirst({
        where: { userId: user.id, levelId: nextLevel.id },
      });
      if (!existingProgress) {
        await prisma.progress.create({
          data: {
            userId: user.id,
            levelId: nextLevel.id,
            status: "unlocked",
          },
        });
      }
    }

    // 查询更新后的用户积分
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { points: true },
    });

    return NextResponse.json({
      correct: true,
      message: `回答正确！获得 ${level.points} 积分`,
      points: updatedUser?.points,
      nextLevelId: nextLevel?.id,
    });
  } catch (error) {
    console.error("答题失败:", error);
    return NextResponse.json(
      { error: "答题失败，请稍后重试" },
      { status: 500 }
    );
  }
}
