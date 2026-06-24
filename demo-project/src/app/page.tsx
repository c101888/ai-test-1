"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@/lib/client";

type Level = {
  id: string;
  order: number;
  title: string;
  points: number;
  status: string;
};

export default function HomePage() {
  const router = useRouter();
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const token = getToken();
    setLoggedIn(!!token);

    if (!token) {
      setLoading(false);
      return;
    }

    apiFetch<{ levels: Level[] }>("/api/level")
      .then((data) => {
        setLevels(data.levels);
      })
      .catch(() => {
        setLoggedIn(false);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12 text-gray-500">加载中...</div>
    );
  }

  return (
    <div className="space-y-8">
      {/* 演示项目标识 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
        <span className="text-amber-600 text-sm font-semibold">⚠️ 演示项目</span>
        <span className="text-amber-700 text-xs">
          本项目为「AI 项目智能测试中心」的演示项目，预埋 6 个业务 Bug，非独立产品。
        </span>
      </div>

      <section className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl p-8">
        <h1 className="text-3xl font-bold mb-2">闯关学习 + 签到积分</h1>
        <p className="text-indigo-100">
          通过答题闯关获取积分，每日签到领取奖励，兑换精美礼品
        </p>
        {!loggedIn && (
          <div className="mt-4 flex gap-3">
            <Link
              href="/register"
              className="bg-white text-indigo-600 px-4 py-2 rounded-lg font-medium hover:bg-indigo-50"
            >
              立即注册
            </Link>
            <Link
              href="/login"
              className="border border-white text-white px-4 py-2 rounded-lg font-medium hover:bg-white/10"
            >
              已有账号，去登录
            </Link>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-800">关卡列表</h2>
          {loggedIn && (
            <Link
              href="/signin"
              className="text-sm text-indigo-600 hover:underline"
            >
              去签到 &rarr;
            </Link>
          )}
        </div>

        {loggedIn ? (
          <div className="grid gap-4 md:grid-cols-2">
            {levels.map((level) => (
              <div
                key={level.id}
                className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">
                      第 {level.order} 关
                    </div>
                    <h3 className="font-semibold text-gray-800">{level.title}</h3>
                    <div className="mt-2 text-sm text-indigo-600">
                      奖励 {level.points} 积分
                    </div>
                  </div>
                  <Link
                    href={`/level/${level.id}`}
                    className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-indigo-700"
                  >
                    进入
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white border border-dashed border-gray-300 rounded-lg p-12 text-center">
            <p className="text-gray-500 mb-4">登录后即可开始闯关学习</p>
            <Link
              href="/login"
              className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
            >
              去登录
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
