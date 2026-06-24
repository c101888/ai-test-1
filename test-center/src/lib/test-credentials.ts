// 测试凭据与关卡答案配置
// 避免在代码中硬编码密码和答案，改为可配置
// 优先级：项目级配置 > 环境变量 > 默认值（仅用于演示项目）

// 测试账号默认密码（可通过环境变量覆盖）
export function getTestPassword(): string {
  return process.env.TEST_DEFAULT_PASSWORD || "Test@123456";
}

// 演示项目关卡答案查找表
// 真实项目中应从项目配置或 LLM 分析结果中读取
const DEMO_LEVEL_ANSWERS: Record<string, string> = {
  // 演示项目闯关学习平台
  "1": "<h1>",
  "2": "#box",
  "3": "const",
};

// 演示项目测试用例到 Bug 编号的映射
// 用于在最终报告中正确标注 Bug 编号
const DEMO_TEST_CASE_BUG_MAP: Record<string, number> = {
  BTC_015: 5, // 基础测试：完成关卡后刷新查进度 → Bug 5
};

// 获取测试用例对应的 Bug 编号
export function getBugNumberForTestCase(
  testCaseId: string,
  isDemo: boolean,
): number | undefined {
  if (!isDemo) return undefined;
  // 标准化 testCaseId（BTC-015 → BTC_015）
  const normalized = testCaseId.replace(/-/g, "_");
  return DEMO_TEST_CASE_BUG_MAP[normalized];
}

// 获取关卡答案
// - 优先从环境变量读取（TEST_LEVEL_ANSWERS，JSON 格式）
// - 其次从演示项目答案表读取
// - 最后返回空字符串
export function getLevelAnswer(levelId: string | null): string {
  if (!levelId) return "";
  // 环境变量覆盖
  const envAnswers = process.env.TEST_LEVEL_ANSWERS;
  if (envAnswers) {
    try {
      const parsed = JSON.parse(envAnswers) as Record<string, string>;
      if (parsed[levelId]) return parsed[levelId];
    } catch {
      // 解析失败时忽略
    }
  }
  // 演示项目默认答案
  return DEMO_LEVEL_ANSWERS[levelId] ?? "";
}

// 从项目信息中推断关卡答案
// - 演示项目（isDemo=true）使用内置答案表
// - 非演示项目返回空字符串，需通过其他方式获取
export function getLevelAnswerForProject(
  levelId: string | null,
  isDemo: boolean,
): string {
  if (!levelId) return "";
  if (isDemo) {
    return getLevelAnswer(levelId);
  }
  // 非演示项目：尝试从环境变量读取
  const envAnswers = process.env.TEST_LEVEL_ANSWERS;
  if (envAnswers) {
    try {
      const parsed = JSON.parse(envAnswers) as Record<string, string>;
      if (parsed[levelId]) return parsed[levelId];
    } catch {
      // 解析失败时忽略
    }
  }
  return "";
}
