// 规则引擎默认实现（预留）
// 当前为空实现，仅提供框架，未来可添加预设 Bug 规则库
// 通过 createRuleEngine() 工厂函数创建实例

import type {
  BugRule,
  RuleContext,
  RuleEngine,
  RuleResult,
} from "./types";

// 默认规则引擎实现
export class DefaultRuleEngine implements RuleEngine {
  private rules: BugRule[] = [];

  // 注册一条规则
  registerRule(rule: BugRule): void {
    this.rules.push(rule);
  }

  // 执行所有已注册规则，返回结果列表
  // 单条规则执行出错时忽略，不影响其他规则
  async runRules(context: RuleContext): Promise<RuleResult[]> {
    const results: RuleResult[] = [];
    for (const rule of this.rules) {
      try {
        const result = await rule.detect(context);
        results.push(result);
      } catch {
        // 忽略规则执行错误
      }
    }
    return results;
  }

  // 获取所有已注册规则（返回副本，避免外部直接修改）
  getRules(): BugRule[] {
    return [...this.rules];
  }
}

// 创建规则引擎实例的工厂函数
export function createRuleEngine(): RuleEngine {
  return new DefaultRuleEngine();
}

// 导出所有类型
export type {
  BugRule,
  RuleContext,
  RuleResult,
  RuleEngine,
  Severity,
} from "./types";
