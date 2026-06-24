"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { apiFetch, getToken, updateStoredPoints } from "@/lib/client";

type Level = {
  id: string;
  order: number;
  title: string;
  question: string;
  points: number;
};

export default function LevelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [level, setLevel] = useState<Level | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ correct: boolean; message: string } | null>(null);
  const [completed, setCompleted] = useState(false);
  const [nextLevelId, setNextLevelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    apiFetch<{ level: Level }>(`/api/level/${id}`)
      .then((data) => {
        setLevel(data.level);
      })
      .catch(() => {
        router.push("/");
      })
      .finally(() => {
        setChecked(true);
      });

    // Bug 5: 学习进度刷新后丢失
    // 关卡完成状态只存在前端 state 中，不读取数据库
    // 正常实现应该是：
    // const progress = await apiFetch(`/api/level/${id}/progress`);
    // if (progress.status === "completed") setCompleted(true);
    // 这里不查询进度，所以刷新后 completed 永远是 false
  }, [id, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || loading) return;

    setLoading(true);
    setResult(null);

    try {
      const data = await apiFetch<{
        correct: boolean;
        message: string;
        points: number;
        nextLevelId?: string;
      }>(`/api/level/${id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer }),
      });

      setResult({ correct: data.correct, message: data.message });

      if (data.correct) {
        // Bug 5: 只在前端 state 中标记完成，不持久化
        setCompleted(true);
        if (data.points !== undefined) {
          updateStoredPoints(data.points);
        }
        if (data.nextLevelId) {
          setNextLevelId(data.nextLevelId);
        }
      }
    } catch (err: any) {
      setResult({ correct: false, message: err.message || "提交失败" });
    } finally {
      setLoading(false);
    }
  };

  if (!checked) {
    return <div className="text-center py-12 text-gray-500">加载中...</div>;
  }

  if (!level) {
    return <div className="text-center py-12 text-gray-500">关卡不存在</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-4">
        <Link href="/" className="text-sm text-gray-500 hover:text-indigo-600">
          &larr; 返回关卡列表
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs text-gray-400 mb-1">第 {level.order} 关</div>
            <h1 className="text-2xl font-bold text-gray-800">{level.title}</h1>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-400">奖励</div>
            <div className="text-lg font-bold text-indigo-600">{level.points} 积分</div>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="text-sm text-gray-500 mb-2">题目</div>
          <p className="text-gray-800">{level.question}</p>
        </div>

        {/* Bug 5: completed 状态只存在前端 state 中，刷新后丢失 */}
        {completed ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">✓</div>
            <div className="text-xl font-bold text-green-600 mb-2">
              恭喜通关！
            </div>
            <p className="text-gray-500 text-sm mb-6">
              你已获得 {level.points} 积分
            </p>
            {nextLevelId ? (
              <Link
                href={`/level/${nextLevelId}`}
                className="inline-block bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700"
              >
                进入下一关
              </Link>
            ) : (
              <p className="text-gray-400 text-sm">已是最后一关</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">你的答案</label>
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="请输入答案"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || !answer.trim()}
              className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "提交中..." : "提交答案"}
            </button>
          </form>
        )}

        {result && !completed && (
          <div
            className={`mt-4 text-sm rounded-md p-3 ${
              result.correct
                ? "bg-green-50 text-green-600"
                : "bg-red-50 text-red-600"
            }`}
          >
            {result.message}
          </div>
        )}
      </div>
    </div>
  );
}
