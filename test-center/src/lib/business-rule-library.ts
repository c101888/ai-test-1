// 业务功能规则库
// 按业务领域分类的通用规则模板。AI 分析项目时识别有哪些功能 → 激活对应规则 → 生成具体测试清单。
// 设计原则：规则是"功能级预设"（签到功能有哪些通用业务 bug 要测），不是"项目级预设"（不预设具体 Bug ID）。
// 项目特定的测试项由 AI 结合 riskMap 补充，规则库只提供通用业务 bug 检查规则。

import type { RiskLevel, FeatureNode, RiskItem, AnalysisModel } from "./store";

// 业务领域
export type BusinessDomain =
  | "sign_in" // 签到
  | "auth" // 登录/注册
  | "points" // 积分
  | "exchange" // 兑换
  | "payment" // 支付
  | "order" // 订单
  | "inventory" // 库存
  | "permission" // 权限
  | "persistence" // 持久化
  | "concurrency" // 并发
  | "data_consistency"; // 数据一致性

// 业务规则
export interface BusinessRule {
  id: string; // 规则 ID，如 "sign_in_consecutive"
  domain: BusinessDomain; // 业务领域
  featureKeyword: string[]; // 功能关键词，用于匹配项目功能（如 ["签到","check-in","daily"]）
  ruleName: string; // 规则名称，如 "连续签到测试"
  testStrategy: string; // 测试策略描述
  testSteps: string[]; // 具体测试步骤（含变量占位符，由执行器填充）
  expectedBehavior: string; // 预期行为
  bugPattern: string; // 可能的 Bug 模式描述
  severity: RiskLevel; // 严重等级
}

// ============================================================
// 内置规则库（每个领域 3-5 条通用规则）
// ============================================================

const RULE_LIBRARY: BusinessRule[] = [
  // -------------------- 签到领域 --------------------
  {
    id: "sign_in_consecutive",
    domain: "sign_in",
    featureKeyword: ["签到", "check-in", "checkin", "daily", "每日", "打卡"],
    ruleName: "连续签到测试",
    testStrategy: "模拟用户在短时间内连续签到多次，检查是否每次都发放奖励",
    testSteps: [
      "使用测试账号登录系统",
      "导航到签到页面",
      "使用脚本在 10 秒内连续点击签到按钮 100 次",
      "检查每次签到是否都发放了奖励",
      "查询数据库/接口确认签到记录数量",
    ],
    expectedBehavior: "系统应限制每日只能签到一次，重复签到应被拦截并提示'今日已签到'",
    bugPattern: "无限签到漏洞：每次签到都发放奖励，可刷取大量积分",
    severity: "critical",
  },
  {
    id: "sign_in_double_click",
    domain: "sign_in",
    featureKeyword: ["签到", "check-in", "checkin", "daily", "每日", "打卡"],
    ruleName: "签到双击测试",
    testStrategy: "100ms 内双击签到按钮，检查是否重复签到",
    testSteps: [
      "使用测试账号登录系统",
      "导航到签到页面",
      "在 100ms 内连续点击签到按钮 2 次",
      "检查是否产生了 2 条签到记录",
      "检查积分是否增加了 2 次",
    ],
    expectedBehavior: "双击应只生效一次，第二次点击应提示'今日已签到'",
    bugPattern: "双击重复签到：并发请求导致同一日签到多次",
    severity: "high",
  },
  {
    id: "sign_in_refresh",
    domain: "sign_in",
    featureKeyword: ["签到", "check-in", "checkin", "daily", "每日", "打卡"],
    ruleName: "签到后刷新测试",
    testStrategy: "签到成功后刷新页面，检查是否可再次签到",
    testSteps: [
      "使用测试账号登录系统",
      "导航到签到页面并完成签到",
      "刷新页面（F5 或 location.reload）",
      "检查签到按钮是否重新变为可点击状态",
      "尝试再次签到",
    ],
    expectedBehavior: "刷新后签到按钮应保持'已签到'状态，不可再次签到",
    bugPattern: "刷新重置签到状态：前端状态未与后端同步，刷新后可重复签到",
    severity: "high",
  },

  // -------------------- 登录/注册领域 --------------------
  {
    id: "auth_register_length",
    domain: "auth",
    featureKeyword: ["注册", "register", "signup", "sign-up", "账户", "用户名", "密码"],
    ruleName: "注册输入长度测试",
    testStrategy: "注册时输入超长用户名/密码（1000 字符），检查是否有限制",
    testSteps: [
      "导航到注册页面",
      "在用户名输入框填入 1000 字符的长字符串",
      "在密码输入框填入 1000 字符的长字符串",
      "点击注册按钮",
      "检查是否被拦截（前端校验或后端校验）",
    ],
    expectedBehavior: "系统应限制输入长度并提示'用户名/密码过长'",
    bugPattern: "无输入长度限制：超长输入可能导致数据库错误或缓冲区溢出",
    severity: "medium",
  },
  {
    id: "auth_refresh_position",
    domain: "auth",
    featureKeyword: ["登录", "login", "signin", "认证", "会话"],
    ruleName: "登录后刷新位置测试",
    testStrategy: "登录后刷新页面，检查是否跳转到页面顶部而非当前位置",
    testSteps: [
      "使用测试账号登录系统",
      "滚动页面到中部或底部位置",
      "记录当前滚动位置（window.scrollY）",
      "刷新页面（F5）",
      "检查刷新后页面是否跳转到顶部，还是保持在原滚动位置",
    ],
    expectedBehavior: "刷新后应保持在用户原滚动位置附近，不应强制跳转顶部",
    bugPattern: "刷新跳转顶部：未保存滚动状态，用户体验差",
    severity: "low",
  },
  {
    id: "auth_logout_back_button",
    domain: "auth",
    featureKeyword: ["登录", "login", "logout", "登出", "退出", "会话"],
    ruleName: "登出后后退按钮测试",
    testStrategy: "登出后点击浏览器后退按钮，检查是否能访问受保护页面",
    testSteps: [
      "使用测试账号登录系统",
      "导航到需要登录的页面（如个人中心）",
      "点击登出按钮",
      "点击浏览器后退按钮",
      "检查是否能访问刚才的受保护页面",
    ],
    expectedBehavior: "后退后不应能访问受保护页面，应重定向到登录页",
    bugPattern: "登出后后退可访问：会话未正确清除，缓存页面可被访问",
    severity: "high",
  },

  // -------------------- 积分领域 --------------------
  {
    id: "points_exchange_limit",
    domain: "points",
    featureKeyword: ["积分", "points", "score", "兑换", "exchange", "redeem", "奖励"],
    ruleName: "零积分兑换测试",
    testStrategy: "在积分为 0 时尝试兑换，检查是否有余额校验",
    testSteps: [
      "使用测试账号登录（确保积分为 0）",
      "导航到积分兑换页面",
      "选择一个兑换项",
      "点击兑换按钮",
      "检查是否被拦截",
    ],
    expectedBehavior: "系统应提示'积分不足'，拦截兑换请求",
    bugPattern: "零积分兑换：无余额校验，0 积分可兑换商品",
    severity: "critical",
  },
  {
    id: "points_negative",
    domain: "points",
    featureKeyword: ["积分", "points", "score", "兑换", "exchange", "redeem"],
    ruleName: "负数积分测试",
    testStrategy: "构造负数积分兑换请求，检查是否扣减",
    testSteps: [
      "使用测试账号登录",
      "导航到积分兑换页面",
      "通过修改请求参数或直接调用 API，提交负数兑换数量",
      "检查积分是否被扣减为负数",
      "检查数据库中积分字段是否变为负值",
    ],
    expectedBehavior: "系统应拒绝负数兑换，积分不应变为负数",
    bugPattern: "负数积分漏洞：未校验兑换数量为正，导致积分变为负数",
    severity: "critical",
  },
  {
    id: "points_concurrent_deduct",
    domain: "points",
    featureKeyword: ["积分", "points", "score", "兑换", "exchange", "扣减", "消费"],
    ruleName: "积分并发扣减测试",
    testStrategy: "并发提交多次兑换请求，检查积分是否超扣",
    testSteps: [
      "使用测试账号登录（假设积分余额为 100）",
      "选择需要 100 积分的兑换项",
      "使用脚本在 100ms 内并发提交 5 次兑换请求",
      "检查最终积分余额（应为 0，不应为 -400）",
      "检查兑换记录数量（应为 1，不应为 5）",
    ],
    expectedBehavior: "并发请求应只成功 1 次，其余应提示'积分不足'",
    bugPattern: "并发超扣：无事务锁，并发请求都通过余额检查导致超扣",
    severity: "critical",
  },

  // -------------------- 兑换领域 --------------------
  {
    id: "exchange_out_of_stock",
    domain: "exchange",
    featureKeyword: ["兑换", "exchange", "redeem", "库存", "stock", "商品"],
    ruleName: "兑换库存不足测试",
    testStrategy: "兑换库存为 0 的商品，检查是否被拦截",
    testSteps: [
      "使用测试账号登录",
      "导航到兑换页面",
      "选择库存为 0 的商品",
      "尝试兑换",
      "检查是否被拦截",
    ],
    expectedBehavior: "系统应提示'库存不足'，拦截兑换",
    bugPattern: "库存不足仍可兑换：未校验库存，导致超卖",
    severity: "high",
  },
  {
    id: "exchange_concurrent_stock",
    domain: "exchange",
    featureKeyword: ["兑换", "exchange", "redeem", "库存", "stock", "商品"],
    ruleName: "兑换并发库存测试",
    testStrategy: "并发兑换同一库存为 1 的商品，检查是否超卖",
    testSteps: [
      "准备一个库存为 1 的兑换商品",
      "使用 2 个测试账号同时点击兑换",
      "检查最终库存（应为 0，不应为 -1）",
      "检查兑换记录（应为 1 条，不应为 2 条）",
    ],
    expectedBehavior: "并发兑换应只成功 1 次，另一笔应提示'库存不足'",
    bugPattern: "并发超卖：无库存锁，并发请求都通过库存检查导致超卖",
    severity: "critical",
  },

  // -------------------- 支付领域 --------------------
  {
    id: "payment_double_click",
    domain: "payment",
    featureKeyword: ["支付", "pay", "payment", "付款", "订单", "结账", "checkout"],
    ruleName: "支付双击测试",
    testStrategy: "支付时双击确认按钮，检查是否重复扣款",
    testSteps: [
      "创建一个订单",
      "进入支付页面",
      "在 100ms 内双击支付确认按钮",
      "检查是否产生了 2 笔支付记录",
      "检查账户余额是否被扣减 2 次",
    ],
    expectedBehavior: "双击应只发起 1 笔支付，第二次点击应被忽略或提示'正在处理'",
    bugPattern: "支付双击重复扣款：无幂等性控制，双击导致重复扣款",
    severity: "critical",
  },
  {
    id: "payment_amount_tamper",
    domain: "payment",
    featureKeyword: ["支付", "pay", "payment", "金额", "amount", "价格", "price"],
    ruleName: "支付金额篡改测试",
    testStrategy: "通过修改请求参数篡改支付金额为 0.01，检查是否被拦截",
    testSteps: [
      "创建一个金额为 100 的订单",
      "拦截支付请求，将金额参数修改为 0.01",
      "提交篡改后的支付请求",
      "检查订单实际支付金额",
      "检查是否以 0.01 元完成了订单",
    ],
    expectedBehavior: "系统应校验支付金额与订单金额一致，拒绝篡改",
    bugPattern: "金额篡改：前端传入金额未与后端订单金额校验，可低价支付",
    severity: "critical",
  },

  // -------------------- 订单领域 --------------------
  {
    id: "order_concurrent_create",
    domain: "order",
    featureKeyword: ["订单", "order", "下单", "购买", "buy", "purchase"],
    ruleName: "并发下单测试",
    testStrategy: "并发下同一商品订单，检查库存是否超卖",
    testSteps: [
      "准备一个库存为 1 的商品",
      "使用脚本在 100ms 内并发提交 5 次下单请求",
      "检查最终库存（应为 0，不应为 -4）",
      "检查订单数量（应为 1，不应为 5）",
    ],
    expectedBehavior: "并发下单应只成功 1 单，其余应提示'库存不足'",
    bugPattern: "并发超卖：无库存锁，并发下单都通过库存检查导致超卖",
    severity: "critical",
  },
  {
    id: "order_status_skip",
    domain: "order",
    featureKeyword: ["订单", "order", "状态", "status", "流程", "flow"],
    ruleName: "订单状态跳转测试",
    testStrategy: "尝试跳过中间状态直接完成订单，检查状态机是否严格",
    testSteps: [
      "创建一个订单（状态为'待支付'）",
      "不执行支付，直接调用'确认收货' API",
      "检查订单状态是否变为'已完成'",
      "检查是否绕过了支付环节",
    ],
    expectedBehavior: "系统应拒绝跳过支付环节，订单状态不应变为'已完成'",
    bugPattern: "状态跳转漏洞：未校验状态机，可跳过支付直接完成订单",
    severity: "critical",
  },

  // -------------------- 权限领域 --------------------
  {
    id: "permission_idor",
    domain: "permission",
    featureKeyword: ["权限", "permission", "角色", "role", "管理员", "admin", "授权"],
    ruleName: "越权访问测试（IDOR）",
    testStrategy: "普通用户尝试访问管理员 API 或其他用户的数据",
    testSteps: [
      "使用普通用户账号登录",
      "尝试直接访问管理员专属 API（如 /api/admin/*）",
      "尝试通过修改 URL 中的 ID 参数访问其他用户的数据",
      "检查是否能获取到非授权数据",
    ],
    expectedBehavior: "系统应返回 403 Forbidden，拒绝越权访问",
    bugPattern: "IDOR 越权：未校验资源归属，可通过修改 ID 访问他人数据",
    severity: "critical",
  },
  {
    id: "permission_horizontal",
    domain: "permission",
    featureKeyword: ["权限", "permission", "用户", "user", "数据", "data"],
    ruleName: "水平越权测试",
    testStrategy: "用户 A 尝试访问用户 B 的私有数据",
    testSteps: [
      "使用用户 A 登录",
      "获取用户 A 的某条数据 ID",
      "退出，使用用户 B 登录",
      "用户 B 尝试通过 ID 访问用户 A 的数据",
      "检查是否能获取到",
    ],
    expectedBehavior: "系统应拒绝访问，返回 403 或 404",
    bugPattern: "水平越权：只校验登录状态未校验数据归属，可访问他人数据",
    severity: "critical",
  },

  // -------------------- 持久化领域 --------------------
  {
    id: "persistence_refresh_keep",
    domain: "persistence",
    featureKeyword: ["持久化", "persistence", "刷新", "refresh", "状态", "state", "进度"],
    ruleName: "刷新后状态保持测试",
    testStrategy: "操作后刷新页面，检查状态是否保持",
    testSteps: [
      "使用测试账号登录",
      "执行某项操作（如答题、签到、兑换）",
      "记录操作后的状态（如积分、进度）",
      "刷新页面",
      "检查状态是否与刷新前一致",
    ],
    expectedBehavior: "刷新后状态应保持不变，与后端数据一致",
    bugPattern: "刷新丢失状态：前端状态未持久化，刷新后丢失",
    severity: "medium",
  },
  {
    id: "persistence_progress_keep",
    domain: "persistence",
    featureKeyword: ["进度", "progress", "关卡", "level", "答题", "quiz", "学习"],
    ruleName: "进度持久化测试",
    testStrategy: "完成某进度后刷新，检查进度是否保持",
    testSteps: [
      "使用测试账号登录",
      "完成某项进度（如通过第 1 关）",
      "刷新页面",
      "检查进度是否保持在第 1 关已通过状态",
      "退出重新登录，再次检查进度",
    ],
    expectedBehavior: "进度应持久化到后端，刷新和重新登录后保持",
    bugPattern: "进度未持久化：进度只存前端，刷新或重登后丢失",
    severity: "high",
  },

  // -------------------- 并发领域 --------------------
  {
    id: "concurrency_double_submit",
    domain: "concurrency",
    featureKeyword: ["提交", "submit", "表单", "form", "并发", "concurrent"],
    ruleName: "表单并发提交测试",
    testStrategy: "并发提交同一表单，检查是否重复处理",
    testSteps: [
      "导航到一个表单页面（如提交答案）",
      "填写表单",
      "使用脚本在 100ms 内并发点击提交按钮 5 次",
      "检查后端是否处理了 5 次提交",
      "检查是否产生了重复数据",
    ],
    expectedBehavior: "并发提交应只处理 1 次，其余应被忽略或提示'已提交'",
    bugPattern: "并发重复提交：无幂等性控制，并发请求都被处理",
    severity: "high",
  },

  // -------------------- 数据一致性领域 --------------------
  {
    id: "consistency_page_vs_db",
    domain: "data_consistency",
    featureKeyword: ["数据", "data", "一致性", "consistency", "同步", "sync"],
    ruleName: "页面数据与数据库一致性测试",
    testStrategy: "对比页面显示的数据与数据库实际数据，检查是否一致",
    testSteps: [
      "使用测试账号登录",
      "执行某项操作（如签到获取积分）",
      "记录页面显示的积分值",
      "查询数据库中对应用户的积分字段",
      "对比页面值与数据库值是否一致",
    ],
    expectedBehavior: "页面显示的数据应与数据库实际数据完全一致",
    bugPattern: "页面与数据库不一致：前端缓存未更新或后端计算错误",
    severity: "medium",
  },
  {
    id: "consistency_cross_page",
    domain: "data_consistency",
    featureKeyword: ["数据", "data", "一致性", "consistency", "页面", "page"],
    ruleName: "跨页面数据一致性测试",
    testStrategy: "在不同页面查看同一数据，检查是否一致",
    testSteps: [
      "使用测试账号登录",
      "在页面 A 查看某项数据（如积分余额）",
      "导航到页面 B 查看同一数据",
      "对比两个页面显示的值是否一致",
    ],
    expectedBehavior: "不同页面显示的同一数据应完全一致",
    bugPattern: "跨页面不一致：不同接口返回不同数据，未统一数据源",
    severity: "medium",
  },
];

// ============================================================
// 规则激活函数
// ============================================================

// 递归提取功能地图中所有功能名称
function extractFeatureNames(nodes: FeatureNode[]): string[] {
  const names: string[] = [];
  for (const node of nodes) {
    names.push(node.name);
    if (node.children) {
      names.push(...extractFeatureNames(node.children));
    }
  }
  return names;
}

// 检查关键词是否匹配功能名称（不区分大小写）
function keywordMatchesFeature(keywords: string[], featureNames: string[]): boolean {
  const lowerFeatures = featureNames.map((f) => f.toLowerCase());
  return keywords.some((kw) => {
    const lowerKw = kw.toLowerCase();
    return lowerFeatures.some((f) => f.includes(lowerKw) || lowerKw.includes(f));
  });
}

// 检查关键词是否匹配风险区域
function keywordMatchesRisk(keywords: string[], riskMap: RiskItem[]): boolean {
  return keywords.some((kw) => {
    const lowerKw = kw.toLowerCase();
    return riskMap.some((r) => r.area.toLowerCase().includes(lowerKw) || r.reason.toLowerCase().includes(lowerKw));
  });
}

/**
 * 根据项目的功能地图和风险地图，激活匹配的业务规则
 * @param analysisModel 项目分析模型
 * @returns 激活的业务规则列表
 */
export function activateRulesForProject(analysisModel: AnalysisModel): BusinessRule[] {
  const featureNames = extractFeatureNames(analysisModel.featureMap || []);
  const riskMap = analysisModel.riskMap || [];

  // 如果功能地图为空，返回空列表（无法匹配）
  if (featureNames.length === 0) {
    return [];
  }

  const activatedRules: BusinessRule[] = [];
  const activatedIds = new Set<string>();

  for (const rule of RULE_LIBRARY) {
    // 匹配条件：功能关键词匹配功能地图 OR 匹配风险地图
    const matchFeature = keywordMatchesFeature(rule.featureKeyword, featureNames);
    const matchRisk = keywordMatchesRisk(rule.featureKeyword, riskMap);

    if (matchFeature || matchRisk) {
      activatedRules.push(rule);
      activatedIds.add(rule.id);
    }
  }

  return activatedRules;
}

// 获取所有规则（供调试和文档展示）
export function getAllRules(): BusinessRule[] {
  return RULE_LIBRARY;
}

// 按领域分组规则
export function groupRulesByDomain(rules: BusinessRule[]): Record<BusinessDomain, BusinessRule[]> {
  const grouped: Record<BusinessDomain, BusinessRule[]> = {
    sign_in: [],
    auth: [],
    points: [],
    exchange: [],
    payment: [],
    order: [],
    inventory: [],
    permission: [],
    persistence: [],
    concurrency: [],
    data_consistency: [],
  };
  for (const rule of rules) {
    grouped[rule.domain].push(rule);
  }
  return grouped;
}

// 领域中文标签
export const domainLabels: Record<BusinessDomain, string> = {
  sign_in: "签到",
  auth: "登录/注册",
  points: "积分",
  exchange: "兑换",
  payment: "支付",
  order: "订单",
  inventory: "库存",
  permission: "权限",
  persistence: "持久化",
  concurrency: "并发",
  data_consistency: "数据一致性",
};
