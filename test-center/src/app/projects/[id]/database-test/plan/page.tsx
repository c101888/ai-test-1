"use client";

import { useParams } from "next/navigation";
import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function DatabaseTestPlanPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ModulePlaceholder
      projectId={id}
      moduleName="数据库测试"
      description="针对项目的数据库方案进行分析和测试"
      features={[
        "方案合理性：表结构、索引、外键约束",
        "字段合理性：类型、长度、NULL、默认值",
        "冗余能力：数据量增长扩展性评估",
        "业务 bug：一致性、事务、并发写入",
        "承载能力：批量数据插入性能测试",
      ]}
    />
  );
}
