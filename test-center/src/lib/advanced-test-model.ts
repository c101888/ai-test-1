// 高级业务测试模型（模块 E2 + E3）
// - 业务规则：由业务功能规则库激活生成（非硬编码预设）
// - 状态不变量：任何业务路径下都应成立的不变量
// - 测试路径：基于激活的业务规则生成具体测试项（正常/异常/跨功能）
//
// 架构变更（Phase 1 重构）：
// - 删除演示项目的硬编码 Bug（BUG-001~006），演示项目也走规则库激活流程
// - 测试路径的 steps 改为规则库中的具体测试步骤，而非通用模板
// - seededBugs 字段保留但不再硬编码，改为从规则的 bugPattern 推导

import type { Confidence, SourceType, Project, AnalysisModel, RiskItem } from "./store";
import {
  activateRulesForProject,
  groupRulesByDomain,
  domainLabels,
  type BusinessRule as LibBusinessRule,
  type BusinessDomain,
} from "./business-rule-library";

// ============================================================
// 业务规则来源类型
// ============================================================

// 规则来源（更细粒度，用于置信度映射）
export type RuleSource =
  | "doc" // 文档明确
  | "page_copy" // 页面文案（如"每日签到"）
  | "code" // 代码体现（如关卡有 order 字段）
  | "industry" // 行业通用
  | "ai_inferred"; // AI 推断

// 规则来源 → 中文标签
export const ruleSourceLabels: Record<RuleSource, string> = {
  doc: "文档明确",
  page_copy: "页面文案",
  code: "代码体现",
  industry: "行业通用",
  ai_inferred: "AI 推断",
};

// 规则来源 → Badge severity
export const ruleSourceSeverity: Record<
  RuleSource,
  "accent" | "warning" | "info"
> = {
  doc: "accent",
  page_copy: "accent",
  code: "accent",
  industry: "warning",
  ai_inferred: "info",
};

// 规则来源 → 是否为"明确规则"（用于置信度到分类的映射）
// 明确规则：doc / page_copy / code
// 推断规则：industry / ai_inferred
export function isExplicitRule(source: RuleSource): boolean {
  return source === "doc" || source === "page_copy" || source === "code";
}

// ============================================================
// 业务规则假设
// ============================================================

export interface BusinessRule {
  id: string; // 规则 ID（如 BR-001）
  rule: string; // 规则内容
  source: RuleSource; // 来源
  confidence: Confidence; // 置信度
  testStrategies: string[]; // 测试策略
  targetBugIds: string[]; // 关联的预埋 Bug ID
}

// 演示项目的业务规则假设（6 条）
export const businessRules: BusinessRule[] = [
  {
    id: "BR-001",
    rule: "同一用户每日只能签到一次",
    source: "page_copy",
    confidence: "high",
    testStrategies: [
      "重复点击签到按钮 100 次",
      "签到后刷新页面再次签到",
      "重新登录后再次签到",
      "多窗口同时签到",
      "接口重放（直接调用 /api/sign 100 次）",
    ],
    targetBugIds: ["BUG-001", "BUG-002", "BUG-003"],
  },
  {
    id: "BR-002",
    rule: "快速双击不应重复加分",
    source: "industry",
    confidence: "high",
    testStrategies: ["100ms 内双击签到按钮", "并发发起 2 笔签到请求"],
    targetBugIds: ["BUG-002"],
  },
  {
    id: "BR-003",
    rule: "签到状态应在刷新后保持",
    source: "industry",
    confidence: "high",
    testStrategies: ["签到后刷新页面再签到", "签到后退出登录再登录"],
    targetBugIds: ["BUG-003"],
  },
  {
    id: "BR-004",
    rule: "未完成前置关卡不能进入下一关",
    source: "code",
    confidence: "high",
    testStrategies: [
      "直接访问 /level/3 答题",
      "篡改 URL 参数跳关",
      "未完成关卡 1 直接调用 /api/level/2/answer",
    ],
    targetBugIds: ["BUG-004"],
  },
  {
    id: "BR-005",
    rule: "积分不足不能兑换奖励",
    source: "industry",
    confidence: "high",
    testStrategies: [
      "0 积分兑换 100 积分奖励",
      "10 积分兑换 100 积分奖励",
      "并发兑换绕过余额检查",
    ],
    targetBugIds: ["BUG-006"],
  },
  {
    id: "BR-006",
    rule: "兑换奖励应扣减积分",
    source: "industry",
    confidence: "high",
    testStrategies: ["兑换前后对比积分余额", "兑换后检查积分是否为负数"],
    targetBugIds: ["BUG-006"],
  },
];

// ============================================================
// 状态不变量
// ============================================================

export interface StateInvariant {
  id: string; // 不变量 ID（如 INV-001）
  description: string; // 不变量描述
  checkMethod: string; // 校验方法
  relatedRuleIds: string[]; // 关联规则 ID
}

// 演示项目的状态不变量（5 条）
export const stateInvariants: StateInvariant[] = [
  {
    id: "INV-001",
    description: "积分不能无来源增加（每次增加必须有对应签到记录或答题记录）",
    checkMethod: "对比积分流水表与签到/答题记录，每条 +N 必须有对应业务记录",
    relatedRuleIds: ["BR-001", "BR-002"],
  },
  {
    id: "INV-002",
    description: "同一用户一天不能有多条成功签到记录",
    checkMethod: "查询 SignRecord 表，按 (userId, date) 分组计数应 ≤ 1",
    relatedRuleIds: ["BR-001"],
  },
  {
    id: "INV-003",
    description: "库存不能小于零",
    checkMethod: "查询 Reward 表 stock 字段，所有奖励库存应 ≥ 0",
    relatedRuleIds: ["BR-005"],
  },
  {
    id: "INV-004",
    description: "未完成关卡不能进入完成状态",
    checkMethod: "查询 Progress 表，status=completed 的关卡必须存在对应 AnswerRecord",
    relatedRuleIds: ["BR-004"],
  },
  {
    id: "INV-005",
    description: "用户积分余额必须与签到+答题-兑换的汇总一致",
    checkMethod:
      "sum(签到积分) + sum(答题积分) - sum(兑换扣减) === User.points",
    relatedRuleIds: ["BR-001", "BR-005", "BR-006"],
  },
];

// ============================================================
// 测试路径
// ============================================================

// 路径类型
export type PathType = "normal" | "abnormal" | "cross_function";

export const pathTypeLabels: Record<PathType, string> = {
  normal: "正常路径",
  abnormal: "异常·重复·绕过·滥用",
  cross_function: "跨功能路径",
};

export const pathTypeSeverity: Record<
  PathType,
  "accent" | "warning" | "critical"
> = {
  normal: "accent",
  abnormal: "warning",
  cross_function: "critical",
};

export interface TestPath {
  id: string; // 路径 ID（如 PATH-001）
  type: PathType; // 路径类型
  title: string; // 路径标题
  description: string; // 路径描述
  steps: string[]; // 执行步骤
  expectedBehavior: string; // 预期行为
  targetBugIds: string[]; // 关联的预埋 Bug ID（用于检测）
  relatedRuleIds: string[]; // 关联规则 ID
  relatedInvariantIds: string[]; // 关联不变量 ID
}

// 演示项目的测试路径
// - 正常路径（E4）：1 条
// - 异常·重复·绕过·滥用路径（E5）：4 条（对应 Bug 1/2/3/4）
// - 跨功能路径（E6）：2 条（对应 Bug 6 + 综合验证）
export const testPaths: TestPath[] = [
  // ============================================================
  // 正常路径（E4）
  // ============================================================
  {
    id: "PATH-001",
    type: "normal",
    title: "签到→获得积分→按钮变灰→刷新→状态保持",
    description: "验证签到主路径闭环：登录→查看签到→签到→获得积分→按钮变灰→刷新→状态保持",
    steps: [
      "用户登录",
      "进入签到页，查看当前签到状态（应为「未签到」）",
      "点击签到按钮",
      "观察积分增加（+10）与按钮变灰",
      "刷新页面",
      "确认签到状态保持为「今日已签到」",
    ],
    expectedBehavior:
      "签到成功后积分 +10，按钮变灰不可再次点击，刷新后状态保持",
    targetBugIds: [],
    relatedRuleIds: ["BR-001", "BR-003"],
    relatedInvariantIds: ["INV-001", "INV-002"],
  },

  // ============================================================
  // 异常·重复·绕过·滥用路径（E5）
  // ============================================================
  {
    id: "PATH-002",
    type: "abnormal",
    title: "连续点击签到 100 次（检测 Bug 1：无限签到）",
    description:
      "在签到页连续点击签到按钮 100 次，观察是否每次都成功并增加积分。预期：仅第一次成功，后续 99 次应被拦截。",
    steps: [
      "用户登录，确保今日未签到",
      "进入签到页",
      "在 10 秒内连续点击签到按钮 100 次",
      "观察每次点击的响应与积分变化",
      "查询 SignRecord 表，统计今日签到记录数",
    ],
    expectedBehavior:
      "仅第 1 次签到成功（积分 +10），后续 99 次返回「今日已签到」，SignRecord 表只有 1 条记录",
    targetBugIds: ["BUG-001"],
    relatedRuleIds: ["BR-001"],
    relatedInvariantIds: ["INV-001", "INV-002"],
  },
  {
    id: "PATH-003",
    type: "abnormal",
    title: "100ms 内双击签到（检测 Bug 2：双击重复加分）",
    description:
      "在 100ms 内快速双击签到按钮，观察是否两次都成功。预期：仅一次成功，并发请求应被串行化或拦截。",
    steps: [
      "用户登录，确保今日未签到",
      "进入签到页",
      "使用脚本在 100ms 内连续触发 2 次 POST /api/sign",
      "观察两次请求的响应状态码与积分变化",
      "查询 SignRecord 表，统计今日签到记录数",
    ],
    expectedBehavior:
      "仅 1 次签到成功（积分 +10），另 1 次返回 409「今日已签到」，SignRecord 表只有 1 条记录",
    targetBugIds: ["BUG-002"],
    relatedRuleIds: ["BR-001", "BR-002"],
    relatedInvariantIds: ["INV-001", "INV-002"],
  },
  {
    id: "PATH-004",
    type: "abnormal",
    title: "签到后刷新再签到（检测 Bug 3：刷新可再签）",
    description:
      "签到成功后刷新页面，再次点击签到按钮，观察是否可再次签到。预期：刷新后状态保持「今日已签到」，按钮不可点击。",
    steps: [
      "用户登录，确保今日未签到",
      "进入签到页，点击签到按钮（成功，积分 +10）",
      "刷新浏览器（F5）",
      "观察签到状态是否保持「今日已签到」",
      "若按钮仍可点击，再次点击签到",
      "查询 SignRecord 表，统计今日签到记录数",
    ],
    expectedBehavior:
      "刷新后状态保持「今日已签到」，按钮变灰不可点击，SignRecord 表只有 1 条记录",
    targetBugIds: ["BUG-003"],
    relatedRuleIds: ["BR-001", "BR-003"],
    relatedInvariantIds: ["INV-001", "INV-002"],
  },
  {
    id: "PATH-005",
    type: "abnormal",
    title: "直接访问 /level/3 答题（检测 Bug 4：跳关）",
    description:
      "未完成关卡 1 和 2 的情况下，直接访问 /level/3 答题，观察是否可答题并获得积分。预期：应被拦截或重定向。",
    steps: [
      "用户登录，确保未完成任何关卡",
      "直接访问 /level/3",
      "观察页面是否渲染题目与答题表单",
      "若可答题，输入正确答案并提交",
      "观察是否获得积分与关卡完成状态",
      "查询 Progress 表，检查关卡 3 的 status",
    ],
    expectedBehavior:
      "访问 /level/3 被拦截（403 或重定向到 /level/1），不可答题，Progress 表无关卡 3 的完成记录",
    targetBugIds: ["BUG-004"],
    relatedRuleIds: ["BR-004"],
    relatedInvariantIds: ["INV-004"],
  },

  // ============================================================
  // 跨功能路径（E6）
  // ============================================================
  {
    id: "PATH-006",
    type: "cross_function",
    title: "0 积分兑换 100 积分奖励（检测 Bug 6：积分不足兑换）",
    description:
      "新用户 0 积分，直接调用 /api/exchange 兑换价值 100 积分的奖励，观察是否兑换成功。预期：应返回 400「积分不足」。",
    steps: [
      "用户登录，确保积分为 0（新用户或已清空积分）",
      "进入奖励页，选择价值 100 积分的奖励",
      "点击兑换按钮（或直接调用 POST /api/exchange）",
      "观察响应状态码与响应体",
      "查询 User.points 与 ExchangeRecord 表",
    ],
    expectedBehavior:
      "兑换失败，返回 400「积分不足」，User.points 仍为 0，ExchangeRecord 表无新记录",
    targetBugIds: ["BUG-006"],
    relatedRuleIds: ["BR-005"],
    relatedInvariantIds: ["INV-003", "INV-005"],
  },
  {
    id: "PATH-007",
    type: "cross_function",
    title: "完成关卡→获得积分→兑换奖励→检查积分扣减",
    description:
      "综合验证：完成关卡获得积分 → 兑换奖励 → 检查积分是否正确扣减。预期：积分余额 = 答题积分 - 兑换扣减。",
    steps: [
      "用户登录，记录初始积分 P0",
      "完成关卡 1，获得 10 积分",
      "记录积分 P1 = P0 + 10",
      "兑换价值 5 积分的奖励",
      "记录积分 P2",
      "验证 P2 = P1 - 5",
      "查询 ExchangeRecord 表，确认兑换记录",
    ],
    expectedBehavior:
      "积分正确扣减：P2 = P1 - 5，ExchangeRecord 表新增 1 条记录，Reward 表库存 -1",
    targetBugIds: [],
    relatedRuleIds: ["BR-005", "BR-006"],
    relatedInvariantIds: ["INV-003", "INV-005"],
  },
];

// ============================================================
// 预埋 Bug 矩阵（用于执行引擎按路径检测）
// ============================================================

export interface SeededBug {
  id: string; // Bug ID（如 BUG-001）
  number: number; // Bug 编号（1-6）
  title: string; // Bug 标题
  detectedByPath: string; // 检测路径 ID
  detectedInBasic: boolean; // 是否在基础测试已发现
}

// 演示项目预埋 6 个 Bug
export const seededBugs: SeededBug[] = [
  {
    id: "BUG-001",
    number: 1,
    title: "签到接口无频率限制，可无限领取积分",
    detectedByPath: "PATH-002",
    detectedInBasic: false,
  },
  {
    id: "BUG-002",
    number: 2,
    title: "快速双击签到按钮可重复加分",
    detectedByPath: "PATH-003",
    detectedInBasic: false,
  },
  {
    id: "BUG-003",
    number: 3,
    title: "签到后刷新页面可再次签到",
    detectedByPath: "PATH-004",
    detectedInBasic: false,
  },
  {
    id: "BUG-004",
    number: 4,
    title: "未完成前置关卡可直接访问下一关答题",
    detectedByPath: "PATH-005",
    detectedInBasic: false,
  },
  {
    id: "BUG-005",
    number: 5,
    title: "完成关卡后刷新页面进度丢失",
    detectedByPath: "",
    detectedInBasic: true, // 基础测试已发现
  },
  {
    id: "BUG-006",
    number: 6,
    title: "积分不足仍可兑换奖励",
    detectedByPath: "PATH-006",
    detectedInBasic: false,
  },
];

// ============================================================
// 高级测试模型聚合视图
// ============================================================

export interface AdvancedTestModel {
  rules: BusinessRule[];
  invariants: StateInvariant[];
  paths: TestPath[];
  seededBugs: SeededBug[];
}

// 获取高级测试模型（演示项目固定数据）
export function getAdvancedTestModel(): AdvancedTestModel {
  return {
    rules: businessRules,
    invariants: stateInvariants,
    paths: testPaths,
    seededBugs,
  };
}

// ============================================================
// 基于项目分析动态生成高级测试模型（非演示项目）
// ============================================================

// 风险等级 → 测试路径严重程度
function riskLevelToSeverity(level: string): "low" | "medium" | "high" | "critical" {
  if (level === "critical") return "critical";
  if (level === "high") return "high";
  if (level === "medium") return "medium";
  return "low";
}

// 从风险条目生成测试路径
function generatePathsFromRisks(risks: RiskItem[]): {
  paths: TestPath[];
  bugs: SeededBug[];
  rules: BusinessRule[];
} {
  const paths: TestPath[] = [];
  const bugs: SeededBug[] = [];
  const rules: BusinessRule[] = [];

  // 筛选 critical 和 high 风险作为测试路径
  const highRisks = risks.filter(
    (r) => r.level === "critical" || r.level === "high",
  );

  highRisks.forEach((risk, index) => {
    const pathId = `PATH-${String(index + 1).padStart(3, "0")}`;
    const ruleId = `BR-${String(index + 1).padStart(3, "0")}`;
    const invId = `INV-${String(index + 1).padStart(3, "0")}`;

    const isCritical = risk.level === "critical";

    // 生成业务规则
    // 非演示项目无预埋 Bug，targetBugIds 留空
    rules.push({
      id: ruleId,
      rule: risk.reason,
      source: "ai_inferred",
      confidence: isCritical ? "high" : "medium",
      testStrategies: [
        `针对「${risk.area}」进行异常路径测试`,
        `验证 ${risk.reason}`,
      ],
      targetBugIds: [],
    });

    // 生成状态不变量
    // (不变量在 generateInvariants 中统一生成)

    // 生成测试路径（异常路径）
    // 非演示项目无预埋 Bug，targetBugIds 留空
    paths.push({
      id: pathId,
      type: "abnormal",
      title: `${risk.area} - ${risk.reason.substring(0, 40)}${risk.reason.length > 40 ? "..." : ""}`,
      description: `针对风险区域「${risk.area}」的异常路径测试。风险原因：${risk.reason}。优先级：${risk.priority}`,
      steps: [
        `分析「${risk.area}」的攻击面与异常入口`,
        `构造触发「${risk.reason}」的测试场景`,
        `执行异常操作并观察系统行为`,
        `检查数据一致性与权限边界`,
      ],
      expectedBehavior: `系统应正确拦截异常操作，${risk.reason}不应发生`,
      targetBugIds: [],
      relatedRuleIds: [ruleId],
      relatedInvariantIds: [invId],
    });

    // 非演示项目无预埋 Bug，不生成 seededBugs 条目
  });

  return { paths, bugs, rules };
}

// 从状态机地图生成状态不变量
export function generateInvariantsFromStateMap(
  analysisModel: AnalysisModel,
): StateInvariant[] {
  const invariants: StateInvariant[] = [];

  analysisModel.stateMap.forEach((sm, index) => {
    const invId = `INV-${String(index + 1).padStart(3, "0")}`;
    // 从非法流转生成不变量
    const illegalFlows = sm.illegalFlows || [];
    if (illegalFlows.length > 0) {
      const flowDesc = illegalFlows
        .map((f) => `${f.from}→${f.to}（${f.note}）`)
        .join("；");
      invariants.push({
        id: invId,
        description: `${sm.subject}状态流转约束：${flowDesc}`,
        checkMethod: `查询${sm.subject}的状态变更记录，验证不存在非法流转`,
        relatedRuleIds: [],
      });
    } else {
      // 无非法流转时，基于合法流转生成不变量
      invariants.push({
        id: invId,
        description: `${sm.subject}状态必须按合法路径流转（${sm.flows.map((f) => f.from + "→" + f.to).join("、")}）`,
        checkMethod: `查询${sm.subject}的状态记录，验证所有流转均为合法路径`,
        relatedRuleIds: [],
      });
    }
  });

  return invariants;
}

// 从功能地图生成正常路径
function generateNormalPathsFromFeatures(
  analysisModel: AnalysisModel,
  startPathIndex: number,
): TestPath[] {
  const paths: TestPath[] = [];

  // 提取叶子节点（有 risk 的功能）
  const leafFeatures: { name: string; risk?: string }[] = [];
  function traverse(nodes: { name: string; risk?: string; children?: unknown[] }[]) {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        traverse(node.children as { name: string; risk?: string; children?: unknown[] }[]);
      } else {
        leafFeatures.push({ name: node.name, risk: node.risk });
      }
    }
  }
  traverse(analysisModel.featureMap as { name: string; risk?: string; children?: unknown[] }[]);

  // 筛选 critical 和 high 风险功能作为正常路径
  const highRiskFeatures = leafFeatures.filter(
    (f) => f.risk === "critical" || f.risk === "high",
  );

  // 最多取 2 个作为正常路径
  const selected = highRiskFeatures.slice(0, 2);

  selected.forEach((feature, i) => {
    const pathNum = startPathIndex + i;
    paths.push({
      id: `PATH-${String(pathNum).padStart(3, "0")}`,
      type: "normal",
      title: `${feature.name} 主路径验证`,
      description: `验证「${feature.name}」功能的正常使用路径是否畅通`,
      steps: [
        `登录系统并进入「${feature.name}」功能页面`,
        `按照正常流程操作「${feature.name}」`,
        `验证功能响应正确，数据持久化正常`,
        `刷新页面验证状态保持`,
      ],
      expectedBehavior: `「${feature.name}」功能正常工作，数据正确持久化`,
      targetBugIds: [],
      relatedRuleIds: [],
      relatedInvariantIds: [],
    });
  });

  return paths;
}

// 基于业务规则生成测试路径（核心改造：用规则库的具体步骤替代通用模板）
function generatePathsFromRules(
  rules: LibBusinessRule[],
  startPathIndex: number,
): { paths: TestPath[]; bugs: SeededBug[]; ruleMapping: BusinessRule[] } {
  const paths: TestPath[] = [];
  const bugs: SeededBug[] = [];
  const ruleMapping: BusinessRule[] = [];
  const groupedRules = groupRulesByDomain(rules);

  let pathNum = startPathIndex;
  let ruleNum = 1;
  let bugNum = 1;

  // 按领域遍历激活的规则，为每条规则生成一条具体测试路径
  for (const domain of Object.keys(groupedRules) as BusinessDomain[]) {
    const domainRules = groupedRules[domain];
    if (domainRules.length === 0) continue;

    for (const libRule of domainRules) {
      const pathId = `PATH-${String(pathNum).padStart(3, "0")}`;
      const ruleId = `BR-${String(ruleNum).padStart(3, "0")}`;
      const bugId = `BUG-${String(bugNum).padStart(3, "0")}`;

      // 路径类型：根据领域推断（权限/支付/订单/积分兑换多为异常路径，持久化为正常路径）
      const isNormalPath =
        domain === "persistence" || domain === "data_consistency";
      const pathType: PathType = isNormalPath ? "normal" : "abnormal";

      // 生成业务规则映射（保留原 BusinessRule 接口兼容性）
      ruleMapping.push({
        id: ruleId,
        rule: `${libRule.ruleName}：${libRule.expectedBehavior}`,
        source: "industry", // 规则库为行业通用规则
        confidence: libRule.severity === "critical" || libRule.severity === "high" ? "high" : "medium",
        testStrategies: [libRule.testStrategy],
        targetBugIds: [bugId],
      });

      // 生成测试路径（使用规则库的具体测试步骤，而非通用模板）
      paths.push({
        id: pathId,
        type: pathType,
        title: `${libRule.ruleName}（${domainLabels[domain]}）`,
        description: `${libRule.testStrategy}。可能 Bug：${libRule.bugPattern}`,
        steps: libRule.testSteps,
        expectedBehavior: libRule.expectedBehavior,
        targetBugIds: [bugId],
        relatedRuleIds: [ruleId],
        relatedInvariantIds: [],
      });

      // 从规则的 bugPattern 推导 SeededBug（不再硬编码）
      bugs.push({
        id: bugId,
        number: bugNum,
        title: libRule.bugPattern,
        detectedByPath: pathId,
        detectedInBasic: false,
      });

      pathNum++;
      ruleNum++;
      bugNum++;
    }
  }

  return { paths, bugs, ruleMapping };
}

// 基于项目分析生成高级测试模型（Phase 1 重构：规则库驱动）
export function getAdvancedTestModelForProject(
  project: Project,
): AdvancedTestModel {
  const analysisModel = project.analysisModel;
  if (!analysisModel) {
    // 无分析模型时返回空模型
    return {
      rules: [],
      invariants: [],
      paths: [],
      seededBugs: [],
    };
  }

  // 1. 激活业务规则（演示项目和非演示项目都走规则库激活流程）
  const activatedRules = activateRulesForProject(analysisModel);

  // 如果规则库未激活任何规则（功能地图为空），回退到风险地图生成
  if (activatedRules.length === 0) {
    const { paths: fallbackPaths, bugs: fallbackBugs, rules: fallbackRules } =
      generatePathsFromRisks(analysisModel.riskMap || []);
    const fallbackInvariants = generateInvariantsFromStateMap(analysisModel);
    return {
      rules: fallbackRules,
      invariants: fallbackInvariants,
      paths: fallbackPaths,
      seededBugs: fallbackBugs,
    };
  }

  // 2. 从激活的业务规则生成测试路径 + Bug + 规则映射
  const { paths: rulePaths, bugs, ruleMapping } = generatePathsFromRules(activatedRules, 1);

  // 3. 从状态机地图生成状态不变量（保留，与规则库互补）
  const invariants = generateInvariantsFromStateMap(analysisModel);

  // 4. 添加跨功能综合验证路径（保留，基于核心功能生成）
  const coreFuncs = analysisModel.overview.coreFunctions?.slice(0, 3) || ["核心功能"];
  const crossFunctionPath: TestPath = {
    id: `PATH-${String(rulePaths.length + 1).padStart(3, "0")}`,
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
  };

  return {
    rules: ruleMapping,
    invariants,
    paths: [...rulePaths, crossFunctionPath],
    seededBugs: bugs,
  };
}

// ============================================================
// 异步版本：AI 动态生成为主体 + 预设规则辅助（Phase 1 修复）
// 注意：异步版本实现位于 ./advanced-test-model-async.ts（服务端专用）
// 本文件保留同步版本，供客户端组件 import
// ============================================================

// 测试项来源标签
export type TestItemSource = "ai" | "preset";

export const testItemSourceLabels: Record<TestItemSource, string> = {
  ai: "AI 动态生成",
  preset: "预设规则",
};

export const testItemSourceSeverity: Record<
  TestItemSource,
  "accent" | "info"
> = {
  ai: "accent",
  preset: "info",
};

// 异步生成结果（含来源标注）
export interface AsyncAdvancedTestModel extends AdvancedTestModel {
  // 测试清单来源
  source: "ai_generated" | "preset_only" | "preset_fallback";
  // 来源说明（用于 UI 展示）
  sourceNote: string;
  // 每个测试路径的来源标注（PATH-001 → ai/preset）
  pathSources: Record<string, TestItemSource>;
}

// 置信度 → 中文标签
export const confidenceLabels: Record<Confidence, string> = {
  high: "高概率",
  medium: "中概率",
  low: "低概率",
};

// 置信度 → Badge severity
export const confidenceSeverity: Record<
  Confidence,
  "accent" | "warning" | "info"
> = {
  high: "accent",
  medium: "warning",
  low: "info",
};

// SourceType → 中文标签（用于通用展示）
export const sourceTypeLabels: Record<SourceType, string> = {
  doc: "文档",
  code: "代码",
  runtime: "运行",
  ai: "AI 推断",
  unknown: "未知",
};
