// 高级测试模型异步生成（服务端专用）
// - AI 动态生成为主体（AI 模式下不再补充预设规则，避免引入无关测试项）
// - 本文件 import "server-only"，不能被客户端组件 import
// - 客户端组件通过 /api/projects/[id]/advanced-model API 获取结果

import "server-only";

import type { Project } from "./store";
import {
  getAdvancedTestModelForProject,
  generateInvariantsFromStateMap,
  type AdvancedTestModel,
  type TestPath,
  type PathType,
  type BusinessRule,
  type SeededBug,
  type StateInvariant,
  type AsyncAdvancedTestModel,
  type TestItemSource,
} from "./advanced-test-model";
import {
  generateBusinessTestList,
  type AITestItem,
  type AIBusinessDomain,
} from "./business-test-generator";
import {
  domainLabels as libDomainLabels,
  type BusinessRule as LibBusinessRule,
} from "./business-rule-library";

// AI 业务领域 → 路径类型推断
function inferPathTypeFromDomain(domain: AIBusinessDomain): PathType {
  if (domain === "persistence" || domain === "data_consistency") {
    return "normal";
  }
  return "abnormal";
}

// AI 业务领域 → 中文标签
function aiDomainLabel(domain: AIBusinessDomain): string {
  if (domain === "other") return "其他";
  return libDomainLabels[domain] || domain;
}

// 从 AI 测试项生成 TestPath + SeededBug + BusinessRule
function generatePathsFromAIItems(
  aiItems: AITestItem[],
  presetRules: LibBusinessRule[],
  startPathIndex: number,
): {
  paths: TestPath[];
  bugs: SeededBug[];
  ruleMapping: BusinessRule[];
  pathSources: Record<string, TestItemSource>;
} {
  const paths: TestPath[] = [];
  const bugs: SeededBug[] = [];
  const ruleMapping: BusinessRule[] = [];
  const pathSources: Record<string, TestItemSource> = {};

  // 预设规则 ID → 规则对象映射（用于补充未匹配的预设规则）
  const presetRuleMap = new Map<string, LibBusinessRule>();
  presetRules.forEach((r) => presetRuleMap.set(r.id, r));

  // 已被 AI 标注匹配的预设规则 ID 集合
  const matchedPresetIds = new Set<string>();
  aiItems.forEach((item) => {
    item.matchedPresetRuleIds.forEach((id) => matchedPresetIds.add(id));
  });

  let pathNum = startPathIndex;
  let ruleNum = 1;
  let bugNum = 1;

  // 1. 先生成 AI 动态测试项的路径
  for (const aiItem of aiItems) {
    const pathId = `PATH-${String(pathNum).padStart(3, "0")}`;
    const ruleId = `BR-${String(ruleNum).padStart(3, "0")}`;
    const bugId = `BUG-${String(bugNum).padStart(3, "0")}`;

    const pathType = inferPathTypeFromDomain(aiItem.domain);

    ruleMapping.push({
      id: ruleId,
      rule: `${aiItem.title}：${aiItem.expectedBehavior}`,
      source: "ai_inferred",
      confidence: aiItem.severity === "critical" || aiItem.severity === "high" ? "high" : "medium",
      testStrategies: [aiItem.possibleBug],
      targetBugIds: [bugId],
    });

    paths.push({
      id: pathId,
      type: pathType,
      title: `${aiItem.title}（${aiDomainLabel(aiItem.domain)}）`,
      description: `AI 动态生成。可能 Bug：${aiItem.possibleBug}`,
      steps: aiItem.testSteps,
      expectedBehavior: aiItem.expectedBehavior,
      targetBugIds: [bugId],
      relatedRuleIds: [ruleId],
      relatedInvariantIds: [],
    });

    bugs.push({
      id: bugId,
      number: bugNum,
      title: aiItem.possibleBug,
      detectedByPath: pathId,
      detectedInBasic: false,
    });

    pathSources[pathId] = "ai";
    pathNum++;
    ruleNum++;
    bugNum++;
  }

  // 2. 补充未被 AI 匹配的预设规则（去重，AI 未覆盖的）
  for (const [ruleId, presetRule] of presetRuleMap.entries()) {
    if (matchedPresetIds.has(ruleId)) continue; // AI 已覆盖

    const pathId = `PATH-${String(pathNum).padStart(3, "0")}`;
    const newRuleId = `BR-${String(ruleNum).padStart(3, "0")}`;
    const bugId = `BUG-${String(bugNum).padStart(3, "0")}`;

    const pathType: PathType =
      presetRule.domain === "persistence" || presetRule.domain === "data_consistency"
        ? "normal"
        : "abnormal";

    ruleMapping.push({
      id: newRuleId,
      rule: `${presetRule.ruleName}：${presetRule.expectedBehavior}`,
      source: "industry",
      confidence: presetRule.severity === "critical" || presetRule.severity === "high" ? "high" : "medium",
      testStrategies: [presetRule.testStrategy],
      targetBugIds: [bugId],
    });

    paths.push({
      id: pathId,
      type: pathType,
      title: `${presetRule.ruleName}（${libDomainLabels[presetRule.domain]}）`,
      description: `预设规则补充。可能 Bug：${presetRule.bugPattern}`,
      steps: presetRule.testSteps,
      expectedBehavior: presetRule.expectedBehavior,
      targetBugIds: [bugId],
      relatedRuleIds: [newRuleId],
      relatedInvariantIds: [],
    });

    bugs.push({
      id: bugId,
      number: bugNum,
      title: presetRule.bugPattern,
      detectedByPath: pathId,
      detectedInBasic: false,
    });

    pathSources[pathId] = "preset";
    pathNum++;
    ruleNum++;
    bugNum++;
  }

  return { paths, bugs, ruleMapping, pathSources };
}

// 异步生成高级测试模型（AI 动态生成为主体 + 预设规则辅助）
export async function getAdvancedTestModelForProjectAsync(
  project: Project,
): Promise<AsyncAdvancedTestModel> {
  const analysisModel = project.analysisModel;
  if (!analysisModel) {
    return {
      rules: [],
      invariants: [],
      paths: [],
      seededBugs: [],
      source: "preset_only",
      sourceNote: "项目尚未分析，无法生成测试清单",
      pathSources: {},
    };
  }

  // 状态不变量（保留，与 AI 生成互补）
  const invariants: StateInvariant[] = generateInvariantsFromStateMap(analysisModel);

  // 尝试调用 AI 动态生成
  try {
    const { items: aiItems } = await generateBusinessTestList(project);

    // AI 模式下仅保留 AI 动态生成的测试项，不再补充预设规则。
    // 原因：预设规则库基于关键词匹配，无法精准区分项目实际功能
    // （例如项目有"积分获取"≠有"积分兑换"），强行补充会引入大量无关测试项。
    // 后续若有真正通用的不限制项目的规则，再扩充规则库后启用。
    const { paths, bugs, ruleMapping, pathSources } = generatePathsFromAIItems(
      aiItems,
      [],
      1,
    );

    // 跨功能综合验证路径（保留）
    const coreFuncs = analysisModel.overview.coreFunctions?.slice(0, 3) || ["核心功能"];
    const crossPathId = `PATH-${String(paths.length + 1).padStart(3, "0")}`;
    paths.push({
      id: crossPathId,
      type: "cross_function",
      title: "跨功能综合验证",
      description: "验证多个功能模块协同工作时的数据一致性与状态正确性",
      steps: [
        "登录系统并记录初始状态",
        `依次执行核心功能操作（${coreFuncs.join(" / ")}）`,
        "检查各功能间的数据流转与状态一致性",
        "验证跨功能场景下的业务规则",
      ],
      expectedBehavior: "各功能模块协同工作正常，数据一致",
      targetBugIds: [],
      relatedRuleIds: [],
      relatedInvariantIds: invariants.map((inv) => inv.id).slice(0, 3),
    });
    pathSources[crossPathId] = "ai";

    return {
      rules: ruleMapping,
      invariants,
      paths,
      seededBugs: bugs,
      source: "ai_generated",
      sourceNote: "AI 根据项目业务功能动态生成",
      pathSources,
    };
  } catch (err) {
    // AI 生成失败，降级到预设规则匹配
    const errorMsg = err instanceof Error ? err.message : String(err);

    // 检查是否是"未配置 LLM"
    const isNotConfigured = errorMsg.includes("未配置 LLM");

    // 降级到同步预设规则匹配（现有逻辑）
    const syncModel: AdvancedTestModel = getAdvancedTestModelForProject(project);

    return {
      ...syncModel,
      source: isNotConfigured ? "preset_only" : "preset_fallback",
      sourceNote: isNotConfigured
        ? "未配置 LLM，仅使用预设规则匹配。配置 AI 后可获得针对本项目的动态测试清单。"
        : `AI 动态生成失败（${errorMsg}），已降级到预设规则匹配。`,
      pathSources: Object.fromEntries(
        syncModel.paths.map((p) => [p.id, "preset" as TestItemSource]),
      ),
    };
  }
}
