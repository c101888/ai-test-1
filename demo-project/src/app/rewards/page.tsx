"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, getToken, updateStoredPoints } from "@/lib/client";

type Reward = {
  id: string;
  title: string;
  cost: number;
  stock: number;
};

export default function RewardsPage() {
  const router = useRouter();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    Promise.all([
      apiFetch<{ rewards: Reward[] }>("/api/exchange"),
      apiFetch<{ points: number }>("/api/points"),
    ])
      .then(([rewardData, pointsData]) => {
        setRewards(rewardData.rewards);
        setPoints(pointsData.points);
        updateStoredPoints(pointsData.points);
      })
      .catch(() => {
        router.push("/login");
      })
      .finally(() => {
        setChecked(true);
      });
  }, [router]);

  const handleExchange = async (rewardId: string) => {
    setLoadingId(rewardId);
    setMessage(null);

    try {
      const data = await apiFetch<{ message: string; points: number }>(
        "/api/exchange",
        {
          method: "POST",
          body: JSON.stringify({ rewardId }),
        }
      );

      setMessage({ type: "success", text: data.message });
      // 更新积分（Bug 6: 积分不扣减，所以积分不变）
      if (data.points !== undefined) {
        setPoints(data.points);
        updateStoredPoints(data.points);
      }

      // 刷新奖励列表（库存减少）
      const rewardData = await apiFetch<{ rewards: Reward[] }>("/api/exchange");
      setRewards(rewardData.rewards);
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "兑换失败" });
    } finally {
      setLoadingId(null);
    }
  };

  if (!checked) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">奖励兑换</h1>
        <div className="text-sm text-gray-600">
          当前积分：<span className="text-indigo-600 font-bold text-lg">{points}</span>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 text-sm rounded-md p-3 ${
            message.type === "success"
              ? "bg-green-50 text-green-600"
              : "bg-red-50 text-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {rewards.map((reward) => (
          <div
            key={reward.id}
            className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col"
          >
            <h3 className="font-semibold text-gray-800 mb-2">{reward.title}</h3>
            <div className="text-sm text-gray-500 mb-1">
              需要 <span className="text-indigo-600 font-medium">{reward.cost}</span> 积分
            </div>
            <div className="text-sm text-gray-500 mb-4">
              剩余库存：<span className="font-medium">{reward.stock}</span>
            </div>

            <button
              onClick={() => handleExchange(reward.id)}
              disabled={loadingId === reward.id || reward.stock <= 0}
              className="mt-auto w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingId === reward.id
                ? "兑换中..."
                : reward.stock <= 0
                ? "库存不足"
                : "立即兑换"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
