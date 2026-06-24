// AI 修复指令生成 prompt 模板
// 定义 LLM 角色、任务、输出格式，并注入失败用例详情与证据供修复指令生成使用

import type { Evidence } from "../store";

// ============================================================
// 输出格式定义：严格 JSON
// ============================================================

export const FIX_OUTPUT_FORMAT = `{
  "rootCause": "根本原因分析",
  "fixStrategy": "修复策略",
  "fixInstructions": ["步骤1", "步骤2"],
  "codeExample": "代码示例",
  "verificationMethod": "验证方法"
}`;

// ============================================================
// System Prompt：定义 AI 角色与输出要求
// ============================================================

export const FIX_SYSTEM_PROMPT = `你是一位资深全栈工程师，擅长 Next.js / React / Prisma 技术栈的 Web 应用开发与调试。

你的任务是：基于测试失败用例的详情、证据和相关代码片段，分析根本原因并生成精准的修复指令，供编程 AI 直接执行修复。

【技术栈背景】
- 前端：Next.js (App Router) + React 19 + TypeScript
- 后端：Next.js API Routes (Route Handlers)
- 数据库：Prisma ORM + SQLite
- 认证：JWT + Cookie

【输出要求】
1. 严格输出合法 JSON，不要包含任何解释性文字，不要使用 markdown 代码块包裹。
2. JSON 顶层必须包含以下 5 个字段：rootCause、fixStrategy、fixInstructions、codeExample、verificationMethod。
3. rootCause：基于证据分析根本原因，指出具体是哪个文件 / 接口 / 逻辑存在问题。
4. fixStrategy：概述修复策略，强调服务端校验优先、数据一致性、并发安全。
5. fixInstructions：有序的修复步骤数组，每步明确要修改的文件与操作。
6. codeExample：针对 Next.js + Prisma 技术栈的代码示例（如 API Route 校验、Prisma 事务、唯一约束等）。
7. verificationMethod：修复后的验证方法，包含如何复测失败用例。
8. 不要仅依赖前端作为防线，服务端必须做校验。
9. 不要建议修改无关模块或重构整体架构。

【输出 JSON 格式】
${FIX_OUTPUT_FORMAT}`;

// ============================================================
// User Prompt 构建器：注入失败详情、证据、代码片段
// ============================================================

export interface FixPromptInput {
  // 用例标题
  caseTitle: string;
  // 用例 ID
  caseId?: string;
  // 预期结果
  expected: string;
  // 实际结果
  actual: string;
  // 复现步骤
  reproduceSteps: string[];
  // 证据列表
  evidences: Evidence[];
  // 可能原因（可选）
  possibleCauses?: string[];
  // 相关代码片段（可选）
  codeSnippet?: string;
  // 影响模块（可选）
  impactModules?: string[];
}

export function buildFixUserPrompt(input: FixPromptInput): string {
  const sections: string[] = [];

  // 用例基本信息
  sections.push("【失败用例信息】");
  sections.push(`用例 ID：${input.caseId || "未指定"}`);
  sections.push(`用例标题：${input.caseTitle}`);
  sections.push("");

  // 预期与实际
  sections.push("【预期结果】");
  sections.push(input.expected || "未提供");
  sections.push("");
  sections.push("【实际结果】");
  sections.push(input.actual || "未提供");
  sections.push("");

  // 复现步骤
  if (input.reproduceSteps.length > 0) {
    sections.push("【复现步骤】");
    input.reproduceSteps.forEach((step, i) => {
      sections.push(`${i + 1}. ${step}`);
    });
    sections.push("");
  }

  // 证据
  if (input.evidences.length > 0) {
    sections.push("【证据】");
    input.evidences.forEach((ev, i) => {
      const typeLabel =
        ev.type === "screenshot"
          ? "截图描述"
          : ev.type === "console"
            ? "Console 日志"
            : ev.type === "network"
              ? "网络请求"
              : ev.type;
      sections.push(`证据 ${i + 1}（${typeLabel}）：`);
      sections.push(ev.content);
    });
    sections.push("");
  }

  // 可能原因
  if (input.possibleCauses && input.possibleCauses.length > 0) {
    sections.push("【可能原因】");
    input.possibleCauses.forEach((c, i) => {
      sections.push(`${i + 1}. ${c}`);
    });
    sections.push("");
  }

  // 影响模块
  if (input.impactModules && input.impactModules.length > 0) {
    sections.push("【影响模块】");
    sections.push(input.impactModules.join("、"));
    sections.push("");
  }

  // 相关代码片段
  if (input.codeSnippet && input.codeSnippet.trim()) {
    sections.push("【相关代码片段】");
    sections.push(input.codeSnippet.trim());
    sections.push("");
  }

  // 任务指令
  sections.push("【修复指令生成任务】");
  sections.push(
    "请基于以上失败详情与证据，分析根本原因并生成修复指令。要求：",
  );
  sections.push("1. rootCause：精准定位问题根因（具体到文件 / 接口 / 逻辑）。");
  sections.push("2. fixStrategy：服务端校验优先，确保数据一致性与并发安全。");
  sections.push("3. fixInstructions：每步明确修改的文件路径与操作。");
  sections.push("4. codeExample：提供 Next.js + Prisma 技术栈的代码示例。");
  sections.push("5. verificationMethod：说明如何验证修复有效。");
  sections.push("");
  sections.push("请严格按以下 JSON 格式输出（不要 markdown 代码块包裹）：");
  sections.push(FIX_OUTPUT_FORMAT);

  return sections.join("\n");
}

// ============================================================
// LLM 返回结果类型与解析 / 格式化工具
// ============================================================

export interface FixInstructionResult {
  rootCause: string;
  fixStrategy: string;
  fixInstructions: string[];
  codeExample: string;
  verificationMethod: string;
}

// 将 LLM 返回的原始 JSON 规范化为 FixInstructionResult
// 字段缺失或类型不符时返回 null，由调用方降级到预写模板
export function parseFixInstructionResult(
  raw: unknown,
): FixInstructionResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const rootCause =
    typeof obj.rootCause === "string" ? obj.rootCause : "";
  const fixStrategy =
    typeof obj.fixStrategy === "string" ? obj.fixStrategy : "";
  const fixInstructions = Array.isArray(obj.fixInstructions)
    ? obj.fixInstructions
        .map((s) => (typeof s === "string" ? s : String(s ?? "")))
        .filter((s) => s.length > 0)
    : [];
  const codeExample =
    typeof obj.codeExample === "string" ? obj.codeExample : "";
  const verificationMethod =
    typeof obj.verificationMethod === "string" ? obj.verificationMethod : "";

  // 至少要有 rootCause 或 fixStrategy 才视为有效
  if (!rootCause && !fixStrategy) return null;

  return {
    rootCause,
    fixStrategy,
    fixInstructions,
    codeExample,
    verificationMethod,
  };
}

// 将 FixInstructionResult 格式化为 markdown 修复指令字符串
// 输出格式与现有预写模板保持一致，便于前端统一渲染
export function formatFixInstruction(
  caseTitle: string,
  result: FixInstructionResult,
): string {
  const sections: string[] = [];
  sections.push(`# 修复：${caseTitle}`);
  sections.push("");
  sections.push("## 根本原因");
  sections.push(result.rootCause || "待分析");
  sections.push("");
  sections.push("## 修复策略");
  sections.push(result.fixStrategy || "待补充");
  sections.push("");
  sections.push("## 修复步骤");
  if (result.fixInstructions.length > 0) {
    result.fixInstructions.forEach((step, i) => {
      sections.push(`${i + 1}. ${step}`);
    });
  } else {
    sections.push("待补充");
  }
  sections.push("");
  sections.push("## 代码示例");
  sections.push(result.codeExample || "待补充");
  sections.push("");
  sections.push("## 验证方法");
  sections.push(result.verificationMethod || "待补充");
  return sections.join("\n");
}
