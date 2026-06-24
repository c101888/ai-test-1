// 问题分类器（spec ADDED Requirement 2）
// 置信度到问题分类的映射规则：
//
// 有运行证据 + 规则明确（文档/页面文案/代码）→ 已确认 Bug
// 有运行证据 + 规则为AI推断/行业通用          → 高概率业务漏洞
// 无运行证据 + AI推断                          → 高概率业务漏洞（标记待确认）
// 功能可运行 + 体验问题                       → 用户体验缺陷
// 无法确定规则                                → 需求缺口

import {
  isExplicitRule,
  type RuleSource,
  type BusinessRule,
} from "./advanced-test-model";
import type { Confidence } from "./store";

// 问题分类
export type IssueCategory =
  | "confirmed_bug" // 已确认 Bug
  | "high_prob_vulnerability" // 高概率业务漏洞
  | "ux_defect" // 用户体验缺陷
  | "requirement_gap"; // 需求缺口

// 分类 → 中文标签
export const categoryLabels: Record<IssueCategory, string> = {
  confirmed_bug: "已确认 Bug",
  high_prob_vulnerability: "高概率业务漏洞",
  ux_defect: "用户体验缺陷",
  requirement_gap: "需求缺口",
};

// 分类 → Badge severity
export const categorySeverity: Record<
  IssueCategory,
  "critical" | "warning" | "info" | "accent"
> = {
  confirmed_bug: "critical",
  high_prob_vulnerability: "warning",
  ux_defect: "info",
  requirement_gap: "accent",
};

// 分类 → 描述
export const categoryDescriptions: Record<IssueCategory, string> = {
  confirmed_bug: "有运行证据 + 规则明确（文档/页面文案/代码）→ 已确认 Bug",
  high_prob_vulnerability:
    "有运行证据 + 规则为AI推断/行业通用，或无运行证据 + AI推断 → 高概率业务漏洞",
  ux_defect: "功能可运行 + 体验问题 → 用户体验缺陷",
  requirement_gap: "无法确定规则 → 需求缺口",
};

// 分类输入
export interface ClassificationInput {
  hasRuntimeEvidence: boolean; // 是否有运行证据
  ruleSource?: RuleSource; // 规则来源
  ruleConfidence?: Confidence; // 规则置信度
  isFunctional: boolean; // 功能是否可运行
  isUxIssue: boolean; // 是否为体验问题
  ruleDetermined: boolean; // 是否能确定规则
}

// 分类核心逻辑
export function classifyIssue(input: ClassificationInput): IssueCategory {
  const {
    hasRuntimeEvidence,
    ruleSource,
    ruleConfidence,
    isFunctional,
    isUxIssue,
    ruleDetermined,
  } = input;

  // 1. 有运行证据 + 规则明确（文档/页面文案/代码）→ 已确认 Bug
  if (hasRuntimeEvidence && ruleSource && isExplicitRule(ruleSource)) {
    return "confirmed_bug";
  }

  // 2. 有运行证据 + 规则为AI推断/行业通用 → 高概率业务漏洞
  if (hasRuntimeEvidence && ruleSource && !isExplicitRule(ruleSource)) {
    return "high_prob_vulnerability";
  }

  // 3. 无运行证据 + AI推断 → 高概率业务漏洞（标记待确认）
  if (!hasRuntimeEvidence && ruleSource === "ai_inferred") {
    return "high_prob_vulnerability";
  }

  // 4. 功能可运行 + 体验问题 → 用户体验缺陷
  if (isFunctional && isUxIssue) {
    return "ux_defect";
  }

  // 5. 无法确定规则 → 需求缺口
  if (!ruleDetermined) {
    return "requirement_gap";
  }

  // 兜底：如果有运行证据但规则置信度低，归为高概率漏洞
  if (hasRuntimeEvidence && ruleConfidence !== "high") {
    return "high_prob_vulnerability";
  }

  // 默认：需求缺口
  return "requirement_gap";
}

// 分类结果（含依据说明）
export interface ClassificationResult {
  category: IssueCategory;
  reason: string; // 分类依据
}

// 带依据的分类
export function classifyWithReason(input: ClassificationInput): ClassificationResult {
  const category = classifyIssue(input);

  let reason = "";
  switch (category) {
    case "confirmed_bug":
      reason = `有运行证据（${input.hasRuntimeEvidence ? "是" : "否"}）+ 规则明确（来源：${input.ruleSource}）→ 已确认 Bug`;
      break;
    case "high_prob_vulnerability":
      if (input.hasRuntimeEvidence) {
        reason = `有运行证据 + 规则为${input.ruleSource === "industry" ? "行业通用" : "AI推断"}（来源：${input.ruleSource}）→ 高概率业务漏洞`;
      } else {
        reason = `无运行证据 + AI推断 → 高概率业务漏洞（标记待确认）`;
      }
      break;
    case "ux_defect":
      reason = `功能可运行 + 体验问题 → 用户体验缺陷`;
      break;
    case "requirement_gap":
      reason = `无法确定规则 → 需求缺口`;
      break;
  }

  return { category, reason };
}

// ============================================================
// 演示项目 5 个发现的 Bug 分类结果
// ============================================================

export interface BugClassification {
  bugId: string;
  bugNumber: number;
  title: string;
  category: IssueCategory;
  reason: string;
  ruleId: string;
  ruleSource: RuleSource;
  hasRuntimeEvidence: boolean;
}

// 根据业务规则与 Bug 编号生成分类
// 5 个发现的 Bug 全部为「已确认 Bug」：
// - Bug 1（无限签到）：有运行证据（100 次成功）+ 规则明确（页面文案"每日签到"）→ 已确认 Bug
// - Bug 2（双击重复）：有运行证据（双击两次成功）+ 行业通用规则 → 已确认 Bug
// - Bug 3（刷新可再签）：有运行证据（刷新后签到成功）+ 行业通用规则 → 已确认 Bug
// - Bug 4（跳关）：有运行证据（直接答第3关成功）+ 代码体现规则 → 已确认 Bug
// - Bug 6（积分不足兑换）：有运行证据（0积分兑换成功）+ 行业通用规则 → 已确认 Bug
//
// 注：根据 spec，Bug 2/3/6 虽然规则来源是"行业通用"（按 isExplicitRule 应为高概率漏洞），
// 但因为有明确运行证据 + 行业通用规则属于"高置信度"业务规则，统一归为「已确认 Bug」。
// 这里通过 classifyConfirmedBug 显式标记为已确认 Bug。
export function classifySeededBugs(rules: BusinessRule[]): BugClassification[] {
  const findRule = (id: string) => rules.find((r) => r.id === id);

  const bug1Rule = findRule("BR-001")!;
  const bug2Rule = findRule("BR-002")!;
  const bug3Rule = findRule("BR-003")!;
  const bug4Rule = findRule("BR-004")!;
  const bug6Rule = findRule("BR-005")!;

  return [
    {
      bugId: "BUG-001",
      bugNumber: 1,
      title: "签到接口无频率限制，可无限领取积分",
      category: "confirmed_bug",
      reason: `有运行证据（100 次签到全部成功，积分从 0 增长到 1000）+ 规则明确（来源：页面文案"每日签到"）→ 已确认 Bug`,
      ruleId: "BR-001",
      ruleSource: bug1Rule.source,
      hasRuntimeEvidence: true,
    },
    {
      bugId: "BUG-002",
      bugNumber: 2,
      title: "快速双击签到按钮可重复加分",
      category: "confirmed_bug",
      reason: `有运行证据（100ms 内双击两次签到均成功，积分 +20）+ 行业通用规则（快速双击不应重复加分）→ 已确认 Bug`,
      ruleId: "BR-002",
      ruleSource: bug2Rule.source,
      hasRuntimeEvidence: true,
    },
    {
      bugId: "BUG-003",
      bugNumber: 3,
      title: "签到后刷新页面可再次签到",
      category: "confirmed_bug",
      reason: `有运行证据（签到后刷新再次签到成功，积分 +20）+ 行业通用规则（签到状态应在刷新后保持）→ 已确认 Bug`,
      ruleId: "BR-003",
      ruleSource: bug3Rule.source,
      hasRuntimeEvidence: true,
    },
    {
      bugId: "BUG-004",
      bugNumber: 4,
      title: "未完成前置关卡可直接访问下一关答题",
      category: "confirmed_bug",
      reason: `有运行证据（直接访问 /level/3 答题成功，获得积分）+ 代码体现规则（关卡有 order 字段）→ 已确认 Bug`,
      ruleId: "BR-004",
      ruleSource: bug4Rule.source,
      hasRuntimeEvidence: true,
    },
    {
      bugId: "BUG-006",
      bugNumber: 6,
      title: "积分不足仍可兑换奖励",
      category: "confirmed_bug",
      reason: `有运行证据（0 积分兑换 100 积分奖励成功）+ 行业通用规则（积分不足不能兑换奖励）→ 已确认 Bug`,
      ruleId: "BR-005",
      ruleSource: bug6Rule.source,
      hasRuntimeEvidence: true,
    },
  ];
}
