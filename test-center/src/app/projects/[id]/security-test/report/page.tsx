"use client";

import { useParams } from "next/navigation";
import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function SecurityTestReportPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ModulePlaceholder
      projectId={id}
      moduleName="入侵安全测试"
      description="AI 分析项目后列出安全漏洞和注入测试清单"
      features={[
        "SQL 注入检测",
        "XSS 跨站脚本检测",
        "CSRF 跨站请求伪造检测",
        "路径遍历检测",
        "认证绕过检测",
        "会话固定/劫持检测",
        "敏感信息泄露检测",
        "IDOR 不安全直接对象引用检测",
      ]}
    />
  );
}
