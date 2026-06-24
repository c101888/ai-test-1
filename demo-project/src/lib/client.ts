// 客户端 API 工具函数

const TOKEN_KEY = "demo_token";
const USER_KEY = "demo_user";

// 获取 token
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

// 获取用户信息
export function getStoredUser(): { id: string; username: string; points: number } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 保存登录信息
export function saveAuth(token: string, user: { id: string; username: string; points: number }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// 清除登录信息
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// 更新本地存储中的积分
export function updateStoredPoints(points: number) {
  const user = getStoredUser();
  if (user) {
    user.points = points;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

// 封装 fetch 请求，自动带上 token
export async function apiFetch<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || "请求失败");
  }

  return data;
}
