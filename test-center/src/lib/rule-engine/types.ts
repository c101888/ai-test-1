// 规则引擎类型定义
// 定义 BugRule 规则引擎的核心接口，供未来添加预设 Bug 规则库
// 当前为预留接口，不实现具体规则

// 问题严重等级
export type Severity = "low" | "medium" | "high" | "critical";

// 规则执行上下文
// 包含规则执行所需的全部依赖：API 驱动、浏览器驱动、数据库读取器等
export interface RuleContext {
  projectId: string; // 项目 ID
  baseUrl: string; // 测试环境基础地址
  authToken?: string; // 认证令牌（可选）
  api: unknown; // IApiDriver（避免循环依赖，使用 unknown）
  browser?: unknown; // IPage（避免循环依赖，使用 unknown）
  db?: unknown; // IDbReader（避免循环依赖，使用 unknown）
}

// 规则执行结果
export interface RuleResult {
  ruleId: string; // 规则 ID
  ruleName: string; // 规则名称
  detected: boolean; // 是否检测到 Bug
  severity: Severity; // 严重等级
  evidence: string; // 证据描述
  description: string; // 结果描述
}

// Bug 检测规则
export interface BugRule {
  id: string; // 规则唯一标识
  name: string; // 规则名称
  description: string; // 规则描述
  severity: Severity; // 严重等级
  // 执行规则检测，返回检测结果
  detect(context: RuleContext): Promise<RuleResult>;
}

// 规则引擎接口
// 负责注册、执行、查询规则
export interface RuleEngine {
  // 注册一条规则
  registerRule(rule: BugRule): void;
  // 执行所有已注册规则，返回结果列表
  runRules(context: RuleContext): Promise<RuleResult[]>;
  // 获取所有已注册规则
  getRules(): BugRule[];
}
