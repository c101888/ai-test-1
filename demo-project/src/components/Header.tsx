"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, clearAuth, getStoredUser, getToken, updateStoredPoints } from "@/lib/client";

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; username: string; points: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
      // 拉取最新积分
      apiFetch<{ points: number; username: string }>("/api/points")
        .then((data) => {
          updateStoredPoints(data.points);
          setUser({ ...stored, points: data.points, username: data.username });
        })
        .catch(() => {
          // token 失效则清除
          clearAuth();
          setUser(null);
        });
    }
  }, [pathname]);

  const handleLogout = () => {
    clearAuth();
    setUser(null);
    router.push("/login");
  };

  const navLinks = [
    { href: "/", label: "首页" },
    { href: "/signin", label: "签到" },
    { href: "/rewards", label: "奖励" },
  ];

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-indigo-600">
            闯关学习
          </Link>
          <nav className="flex gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm hover:text-indigo-600 ${
                  pathname === link.href ? "text-indigo-600 font-medium" : "text-gray-600"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {mounted && user ? (
            <>
              <span className="text-sm text-gray-700">
                <span className="font-medium">{user.username}</span>
                <span className="mx-2 text-gray-300">|</span>
                <span className="text-indigo-600 font-medium">{user.points}</span> 积分
              </span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-red-500"
              >
                退出
              </button>
            </>
          ) : mounted ? (
            <>
              <Link href="/login" className="text-sm text-gray-600 hover:text-indigo-600">
                登录
              </Link>
              <Link href="/register" className="text-sm text-gray-600 hover:text-indigo-600">
                注册
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
