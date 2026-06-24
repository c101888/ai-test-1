import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, signToken } from "@/lib/auth";

// 登录接口
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

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 400 }
      );
    }

    // 校验密码
    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 400 }
      );
    }

    // 生成 JWT
    const token = await signToken(user.id, user.username);

    return NextResponse.json({
      message: "登录成功",
      token,
      user: {
        id: user.id,
        username: user.username,
        points: user.points,
      },
    });
  } catch (error) {
    console.error("登录失败:", error);
    return NextResponse.json(
      { error: "登录失败，请稍后重试" },
      { status: 500 }
    );
  }
}
