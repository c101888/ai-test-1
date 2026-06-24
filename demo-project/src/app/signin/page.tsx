"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, getToken, updateStoredPoints } from "@/lib/client";

export default function SigninPage() {
  const router = useRouter();
  const [points, setPoints] = useState(0);
  const [signed, setSigned] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    // 拉取最新积分
    apiFetch<{ points: number }>("/api/points")
      .then((data) => {
        setPoints(data.points);
        updateStoredPoints(data.points);
      })
      .catch(() => {
        router.push("/login");
      })
      .finally(() => {
        setChecked(true);
      });

    // Bug 3: 签到状态不持久化在前端
    // 正常实现应该是：
    // const today = new Date().toDateString();
    // if (localStorage.getItem("signed_" + today) === "1") {
    //   setSigned(true);
    // }
    // 这里不读取任何持久化状态，所以刷新后 signed 永远是 false
  }, [router]);

  const handleSign = async () => {
    if (signed) return;

    // Bug 2: 签到按钮前端没有防抖
    // 这里没有使用 loading 状态阻止重复点击
    // 快速双击会发送两次 /api/sign 请求
    // 由于后端也无限制（Bug 1），两次都成功
    setLoading(true);
    setMessage("");

    try {
      const data = await apiFetch<{ points: number; message: string }>(
        "/api/sign",
        {
          method: "POST",
        }
      );
      setPoints(data.points);
      updateStoredPoints(data.points);
      setSigned(true);
      setMessage(data.message);
    } catch (err: any) {
      setMessage(err.message || "签到失败");
    } finally {
      setLoading(false);
    }
  };

  if (!checked) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-2">每日签到</h1>
        <p className="text-gray-500 text-sm mb-8">
          每日签到可获得 10 积分奖励
        </p>

        <div className="mb-8">
          <div className="text-sm text-gray-400 mb-1">当前积分</div>
          <div className="text-4xl font-bold text-indigo-600">{points}</div>
        </div>

        {/* Bug 2: 签到按钮没有防抖，快速双击会发送两次请求 */}
        {/* Bug 3: 刷新后 signed 状态重置为 false，按钮恢复可点击 */}
        <button
          onClick={handleSign}
          disabled={signed}
          className={`w-full py-4 rounded-xl text-lg font-medium transition-colors ${
            signed
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          {signed ? "今日已签到" : loading ? "签到中..." : "每日签到"}
        </button>

        {message && (
          <div className="mt-4 text-sm text-green-600 bg-green-50 rounded-md p-3">
            {message}
          </div>
        )}

        {signed && (
          <div className="mt-4 text-xs text-gray-400">
            提示：刷新页面后可再次签到
          </div>
        )}
      </div>
    </div>
  );
}
