"use client";

import { useParams } from "next/navigation";
import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function FunctionalPlanPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ModulePlaceholder
      projectId={id}
      moduleName="功能测试"
      description="AI 全栈代码审计 + 运行时功能测试，检测代码错误、功能错误、功能边界"
      features={[
        "AI 代码审计：检测代码错误、功能错误、功能边界",
        "7级结果标签：通过/阻塞/异常/可疑/轻微/中等/严重",
        "运行时功能测试",
        "修复指令包生成",
      ]}
    />
  );
}
