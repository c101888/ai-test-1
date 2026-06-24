// 高级业务测试 AI 动态生成 prompt
// - 输入：项目 analysisModel（功能地图、角色地图、状态机、风险地图、数据地图）+ 预设规则库摘要
// - 输出：针对本项目具体业务的测试清单（JSON 数组）
// 设计原则：AI 动态生成为主体，预设规则为辅助（AI 语义判断哪些预设规则适用）

import type { AnalysisModel } from "../store";
import type { BusinessRule as LibBusinessRule } from "../business-rule-library";

// ============================================================
// 输出格式定义：AI 生成的测试项结构
// ============================================================

export const BUSINESS_TEST_OUTPUT_FORMAT = `{
  "testItems": [
    {
      "title": "测试项名称，如：零积分兑换测试",
      "domain": "业务领域，从以下选一：sign_in|auth|points|exchange|payment|order|inventory|permission|persistence|concurrency|data_consistency|other",
      "testSteps": [
        "具体可执行的测试步骤1，如：使用测试账号登录",
        "具体可执行的测试步骤2，如：导航到兑换页面",
        "具体可执行的测试步骤3，如：尝试用 0 积分兑换 100 积分奖励"
      ],
      "expectedBehavior": "预期行为，如：系统应提示'积分不足'，兑换失败",
      "possibleBug": "可能存在的 Bug，如：未校验积分余额，0 积分也能兑换成功",
      "severity": "严重等级：critical|high|medium|low",
      "matchedPresetRuleIds": ["适用的预设规则ID数组，如 sign_in_consecutive，可为空数组"]
    }
  ]
}`;

// ============================================================
// System Prompt：定义 AI 角色与输出要求
// ============================================================

export const BUSINESS_TEST_SYSTEM_PROMPT = `你是一位资深业务测试专家，擅长针对 Web 项目的具体业务功能设计业务 bug 测试清单。

你的任务是：根据给定的项目分析结果（功能地图、角色地图、状态机、风险地图、数据地图），针对该项目的【具体业务功能】生成业务 bug 测试清单。

【核心要求】
1. 必须针对项目的【具体业务功能】生成测试项，不要生成通用模板。
   - 错误示例：「分析攻击面→构造场景→执行→检查」（太通用，无业务针对性）
   - 正确示例：「零积分兑换测试：尝试用 0 积分兑换 100 积分奖励，检查是否未校验积分余额」
2. 每个测试项的步骤必须具体可执行，包含具体的操作对象（如页面名、API 路径、按钮名）。
3. 重点关注业务规则漏洞：频率限制、重复操作、并发竞争、边界值、权限绕过、状态持久化、数据一致性。
4. 结合项目的 riskMap（风险地图）重点测试高风险区域。
5. 结合项目的 stateMap（状态机）测试非法状态流转。
6. 对于预设规则库中适用于本项目的规则，在 matchedPresetRuleIds 中标注其 ID（语义判断，不是关键词匹配）。
7. 生成的测试项数量建议 8-20 条，覆盖项目主要业务功能。

【输出要求】
1. 严格输出合法 JSON，不要包含任何解释性文字，不要使用 markdown 代码块包裹。
2. JSON 顶层为对象，含 testItems 数组。
3. 每个测试项必须包含：title、domain、testSteps（数组）、expectedBehavior、possibleBug、severity、matchedPresetRuleIds（数组，可为空）。

【输出 JSON 格式】
${BUSINESS_TEST_OUTPUT_FORMAT}`;

// ============================================================
// User Prompt 构建器：注入项目分析结果 + 预设规则库摘要
// ============================================================

export function buildBusinessTestUserPrompt(
  analysisModel: AnalysisModel,
  presetRules: LibBusinessRule[],
): string {
  const sections: string[] = [];

  // 项目概览
  sections.push("【项目概览】");
  sections.push(`项目类型：${analysisModel.overview.projectType || "未识别"}`);
  sections.push(`目标用户：${analysisModel.overview.targetUser || "未识别"}`);
  sections.push(
    `核心功能：${(analysisModel.overview.coreFunctions || []).join("、") || "未识别"}`,
  );
  sections.push(
    `业务对象：${(analysisModel.overview.businessObjects || []).join("、") || "未识别"}`,
  );
  sections.push(
    `技术栈：${(analysisModel.overview.techStack || []).join("、") || "未识别"}`,
  );
  sections.push(`数据库：${analysisModel.overview.database || "未识别"}`);
  sections.push(
    `API 列表：${(analysisModel.overview.apis || []).join("、") || "未识别"}`,
  );
  sections.push(`登录方式：${analysisModel.overview.authMethod || "未识别"}`);
  sections.push(
    `权限体系：${analysisModel.overview.permissionSystem || "未识别"}`,
  );
  sections.push("");

  // 功能地图
  sections.push("【功能地图】");
  sections.push(JSON.stringify(analysisModel.featureMap, null, 2));
  sections.push("");

  // 角色地图
  sections.push("【角色地图】");
  sections.push(JSON.stringify(analysisModel.roleMap, null, 2));
  sections.push("");

  // 状态机地图
  sections.push("【状态机地图】");
  sections.push(JSON.stringify(analysisModel.stateMap, null, 2));
  sections.push("");

  // 数据地图
  sections.push("【数据地图】");
  sections.push(JSON.stringify(analysisModel.dataMap, null, 2));
  sections.push("");

  // 风险地图
  sections.push("【风险地图】");
  sections.push(JSON.stringify(analysisModel.riskMap, null, 2));
  sections.push("");

  // 一致性风险
  if (
    analysisModel.consistencyRisks &&
    analysisModel.consistencyRisks.length > 0
  ) {
    sections.push("【一致性风险】");
    analysisModel.consistencyRisks.forEach((risk) => {
      sections.push(`- ${risk}`);
    });
    sections.push("");
  }

  // 预设规则库摘要（供 AI 语义判断哪些适用）
  sections.push("【预设规则库（供语义匹配，适用的在 matchedPresetRuleIds 标注）】");
  if (presetRules.length === 0) {
    sections.push("（无预设规则）");
  } else {
    presetRules.forEach((rule) => {
      sections.push(
        `- ID: ${rule.id} | 领域: ${rule.domain} | 规则: ${rule.ruleName} | 策略: ${rule.testStrategy}`,
      );
    });
  }
  sections.push("");

  sections.push(
    "请基于以上项目分析结果，针对该项目的具体业务功能生成业务 bug 测试清单。",
  );

  return sections.join("\n");
}
