// 高级业务测试 AI 动态生成服务
// - 调用 LLM，输入项目 analysisModel + 预设规则库摘要
// - 输出针对本项目具体业务的测试清单
// - 服务端运行（API 路由调用），不能在客户端直接调用

import "server-only";

import type { Project, AnalysisModel, RiskLevel } from "./store";
import { isLLMConfiguredAsync, getLLMConfigAsync } from "./llm-config";
import {
  chatCompletionJSONWithConfig,
  ANALYSIS_TIMEOUT,
  type LLMMessage,
} from "./llm-client";
import {
  BUSINESS_TEST_SYSTEM_PROMPT,
  buildBusinessTestUserPrompt,
} from "./prompts/business-test-prompt";
import { getAllRules, type BusinessRule as LibBusinessRule } from "./business-rule-library";
import { recordAIThinkingLog, startAIThinkingSession } from "./ai-thinking-log";

// ============================================================
// AI 生成的测试项类型
// ============================================================

// 业务领域（扩展 other，兼容 AI 可能返回的未分类领域）
export type AIBusinessDomain =
  | "sign_in"
  | "auth"
  | "points"
  | "exchange"
  | "payment"
  | "order"
  | "inventory"
  | "permission"
  | "persistence"
  | "concurrency"
  | "data_consistency"
  | "other";

// AI 生成的单个测试项
export interface AITestItem {
  id: string; // 生成时分配，如 AIT-001
  title: string; // 测试项名称
  domain: AIBusinessDomain; // 业务领域
  testSteps: string[]; // 具体测试步骤
  expectedBehavior: string; // 预期行为
  possibleBug: string; // 可能的 Bug
  severity: RiskLevel; // 严重等级
  source: "ai"; // 来源标记（AI 动态生成）
  matchedPresetRuleIds: string[]; // AI 判断适用的预设规则 ID
}

// LLM 返回的原始结构（字段可能缺失或类型不符，需校验）
interface LLMResponse {
  testItems?: unknown;
}

// ============================================================
// 类型转换与校验工具
// ============================================================

// 校验并转换业务领域
function normalizeDomain(value: unknown): AIBusinessDomain {
  if (typeof value !== "string") return "other";
  const valid: AIBusinessDomain[] = [
    "sign_in", "auth", "points", "exchange", "payment", "order",
    "inventory", "permission", "persistence", "concurrency", "data_consistency", "other",
  ];
  return (valid as string[]).includes(value) ? (value as AIBusinessDomain) : "other";
}

// 校验并转换严重等级
function normalizeSeverity(value: unknown): RiskLevel {
  if (typeof value !== "string") return "medium";
  const valid: RiskLevel[] = ["critical", "high", "medium", "low"];
  return (valid as string[]).includes(value) ? (value as RiskLevel) : "medium";
}

// 校验并转换字符串数组
function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : String(v ?? "")))
      .filter((s) => s.length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return fallback;
}

// 校验并转换单个测试项
function normalizeTestItem(raw: unknown, index: number): AITestItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) return null; // 无标题的项丢弃

  return {
    id: `AIT-${String(index + 1).padStart(3, "0")}`,
    title,
    domain: normalizeDomain(obj.domain),
    testSteps: normalizeStringArray(obj.testSteps),
    expectedBehavior:
      typeof obj.expectedBehavior === "string" ? obj.expectedBehavior.trim() : "",
    possibleBug:
      typeof obj.possibleBug === "string" ? obj.possibleBug.trim() : "",
    severity: normalizeSeverity(obj.severity),
    source: "ai",
    matchedPresetRuleIds: normalizeStringArray(obj.matchedPresetRuleIds),
  };
}

// ============================================================
// 主函数：调用 LLM 生成业务测试清单
// ============================================================

export interface GenerateOptions {
  // 自定义预设规则库（默认使用内置 RULE_LIBRARY）
  presetRules?: LibBusinessRule[];
  // 超时毫秒（默认使用 ANALYSIS_TIMEOUT）
  timeout?: number;
}

export interface GenerateResult {
  items: AITestItem[];
  source: "ai_generated";
}

// 生成业务测试清单
export async function generateBusinessTestList(
  project: Project,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const analysisModel = project.analysisModel;
  if (!analysisModel) {
    recordAIThinkingLog(
      project.id,
      "advanced-plan",
      "judging",
      "项目尚未分析，无法生成业务测试清单",
      { level: "error" },
    );
    throw new Error("项目尚未分析，无法生成业务测试清单");
  }

  // 开启新的 AI 思考会话（清空旧日志，刷新页面时保留本次生成的思考过程）
  startAIThinkingSession(project.id, "advanced-plan");

  // AI 思考日志：开始生成
  recordAIThinkingLog(
    project.id,
    "advanced-plan",
    "thinking",
    `开始为项目「${project.name}」动态生成业务测试清单，基于 ${analysisModel.featureMap?.length ?? 0} 个功能模块、${analysisModel.riskMap?.length ?? 0} 个风险点`,
  );

  // 检查 LLM 是否配置
  const configured = await isLLMConfiguredAsync();
  if (!configured) {
    recordAIThinkingLog(
      project.id,
      "advanced-plan",
      "judging",
      "未配置 LLM，无法动态生成业务测试清单",
      { level: "error" },
    );
    throw new Error("未配置 LLM，无法动态生成业务测试清单。请在设置页配置 AI 后重试。");
  }

  const config = await getLLMConfigAsync();
  if (!config) {
    recordAIThinkingLog(
      project.id,
      "advanced-plan",
      "judging",
      "LLM 配置读取失败",
      { level: "error" },
    );
    throw new Error("LLM 配置读取失败");
  }

  // 预设规则库（供 AI 语义匹配）
  const presetRules = options?.presetRules ?? getAllRules();
  recordAIThinkingLog(
    project.id,
    "advanced-plan",
    "thinking",
    `已加载预设规则库 ${presetRules.length} 条，AI 将基于项目业务语义匹配并补充`,
  );

  // 构建 prompt
  recordAIThinkingLog(
    project.id,
    "advanced-plan",
    "acting",
    `正在构建 prompt 并调用 LLM（${config.modelName || config.modelId}）生成针对项目具体业务的测试清单…`,
  );
  const userPrompt = buildBusinessTestUserPrompt(analysisModel, presetRules);
  const messages: LLMMessage[] = [
    { role: "system", content: BUSINESS_TEST_SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  // 调用 LLM
  const timeout = options?.timeout ?? ANALYSIS_TIMEOUT;
  const raw = await chatCompletionJSONWithConfig<LLMResponse>(
    config,
    messages,
    { timeout, temperature: 0.4 },
  );

  // 校验并转换返回结果
  if (!raw || !Array.isArray(raw.testItems)) {
    recordAIThinkingLog(
      project.id,
      "advanced-plan",
      "judging",
      "LLM 返回格式错误：缺少 testItems 数组",
      { level: "error" },
    );
    throw new Error("LLM 返回格式错误：缺少 testItems 数组");
  }

  const items: AITestItem[] = [];
  raw.testItems.forEach((rawItem, index) => {
    const item = normalizeTestItem(rawItem, index);
    if (item) items.push(item);
  });

  if (items.length === 0) {
    recordAIThinkingLog(
      project.id,
      "advanced-plan",
      "judging",
      "LLM 未生成有效测试项",
      { level: "error" },
    );
    throw new Error("LLM 未生成有效测试项");
  }

  recordAIThinkingLog(
    project.id,
    "advanced-plan",
    "observing",
    `AI 生成了 ${items.length} 条测试项，覆盖 ${Array.from(new Set(items.map((i) => i.domain))).join("、")} 等领域`,
  );
  recordAIThinkingLog(
    project.id,
    "advanced-plan",
    "judging",
    `业务测试清单生成完成 · 来源：AI 动态生成（${items.length} 条）`,
  );

  return { items, source: "ai_generated" };
}

// ============================================================
// 辅助：获取预设规则库（供 UI 展示"内置默认规则"）
// ============================================================

export function getPresetRules(): LibBusinessRule[] {
  return getAllRules();
}
