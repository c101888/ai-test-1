import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import type { NextRequest } from "next/server";

// 获取奖励列表
export async function GET(request: NextRequest) {
  try {
    const rewards = await prisma.reward.findMany({
      orderBy: { cost: "asc" },
      select: {
        id: true,
        title: true,
        cost: true,
        stock: true,
      },
    });

    return NextResponse.json({ rewards });
  } catch (error) {
    console.error("获取奖励列表失败:", error);
    return NextResponse.json(
      { error: "获取奖励列表失败" },
      { status: 500 }
    );
  }
}

// 兑换奖励接口
// 预埋 Bug 6: 不校验积分是否足够，0积分也可兑换
export async function POST(request: NextRequest) {
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "未登录或登录已过期" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { rewardId } = body;

    if (!rewardId) {
      return NextResponse.json(
        { error: "请选择要兑换的奖励" },
        { status: 400 }
      );
    }

    // 查找奖励
    const reward = await prisma.reward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) {
      return NextResponse.json(
        { error: "奖励不存在" },
        { status: 404 }
      );
    }

    // 检查库存
    if (reward.stock <= 0) {
      return NextResponse.json(
        { error: "该奖励库存不足" },
        { status: 400 }
      );
    }

    // Bug 6: 这里没有校验用户积分是否足够
    // 正常实现应该是：
    // if (user.points < reward.cost) {
    //   return NextResponse.json(
    //     { error: `积分不足，需要 ${reward.cost} 积分，当前 ${user.points} 积分` },
    //     { status: 400 }
    //   );
    // }

    // 创建兑换记录
    await prisma.exchange.create({
      data: {
        userId: user.id,
        rewardId: reward.id,
      },
    });

    // 减少库存
    await prisma.reward.update({
      where: { id: reward.id },
      data: { stock: { decrement: 1 } },
    });

    // Bug 6: 不扣减用户积分
    // 正常实现应该是：
    // await prisma.user.update({
    //   where: { id: user.id },
    //   data: { points: { decrement: reward.cost } },
    // });

    // 查询更新后的用户积分（应该不变，因为没扣减）
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { points: true },
    });

    return NextResponse.json({
      message: `兑换成功：${reward.title}`,
      points: updatedUser?.points,
    });
  } catch (error) {
    console.error("兑换失败:", error);
    return NextResponse.json(
      { error: "兑换失败，请稍后重试" },
      { status: 500 }
    );
  }
}
