"use client";

import { useParams } from "next/navigation";
import { ModulePlaceholder } from "@/components/ui/ModulePlaceholder";

export default function UITestRunPage() {
  const params = useParams();
  const id = params.id as string;
  return (
    <ModulePlaceholder
      projectId={id}
      moduleName="UI 测试"
      description="测试 UI 界面的布局合理性、一致性、美观性、响应式、文字截断、边界溢出等"
      features={[
        "布局合理性检测：模块宽高、呼吸感、内宽预留间隙",
        "一致性检测：字体、颜色、间距",
        "美观性检测：文字大小、模块调性",
        "文字截断与边界溢出检测",
        "多终端响应式：手机/平板/电脑三档分辨率",
        "报错类型识别：UI 级 vs 浏览器级",
        "Playwright 实时截图展示",
      ]}
    />
  );
}
