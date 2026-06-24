import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword, signToken } from "@/lib/auth";

// 注册接口
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "用户名和密码不能为空" },
        { status: 400 }
      );
    }

    if (username.length < 2) {
      return NextResponse.json(
        { error: "用户名至少需要 2 个字符" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "密码至少需要 6 个字符" },
        { status: 400 }
      );
    }

    // 检查用户名是否已存在
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      return NextResponse.json(
        { error: "用户名已被注册" },
        { status: 400 }
      );
    }

    // 创建用户
    const hashedPassword = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    // 为新用户创建第一关的进度记录（解锁第一关）
    const firstLevel = await prisma.level.findFirst({
      where: { order: 1 },
    });

    if (firstLevel) {
      await prisma.progress.create({
        data: {
          userId: user.id,
          levelId: firstLevel.id,
          status: "unlocked",
        },
      });
    }

    // 生成 JWT
    const token = await signToken(user.id, user.username);

    return NextResponse.json({
      message: "注册成功",
      token,
      user: {
        id: user.id,
        username: user.username,
        points: user.points,
      },
    });
  } catch (error) {
    console.error("注册失败:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
