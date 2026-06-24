"use client";

import { useParams } from "next/navigation";
import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function ConcurrencyTestRunPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ModulePlaceholder
      projectId={id}
      moduleName="并发测试"
      description="模拟并发访问测试项目最大承载能力（仅支持公网部署项目）"
      features={[
        "最大同时在线：10/50/100/500 并发访问",
        "同时操作页面：并发点击签到/提交表单",
        "数据库最大承载：并发写入测试",
        "DDoS 模拟：渐进式压力测试",
        "安全性能：速率限制、防 CC 机制检测",
        "注意：仅支持公网部署项目",
      ]}
    />
  );
}
