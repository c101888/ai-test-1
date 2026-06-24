import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { NextRequest } from "next/server";

// JWT 密钥（演示用，实际项目应从环境变量读取）
const JWT_SECRET = new TextEncoder().encode(
  "demo-project-jwt-secret-key-for-testing-2024"
);

const TOKEN_COOKIE = "token";

// 哈希密码
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// 校验密码
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// 生成 JWT
export async function signToken(userId: string, username: string): Promise<string> {
  return new SignJWT({ userId, username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);
}

// 验证 JWT 并返回 payload
export async function verifyToken(token: string): Promise<{
  userId: string;
  username: string;
} | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as string,
      username: payload.username as string,
    };
  } catch {
    return null;
  }
}

// 从请求中获取当前用户（API 路由用）
export async function getUserFromRequest(request: NextRequest) {
  // 优先从 Authorization 头读取
  const authHeader = request.headers.get("authorization");
  let token: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return null;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, points: true },
  });

  return user;
}

export { TOKEN_COOKIE };
