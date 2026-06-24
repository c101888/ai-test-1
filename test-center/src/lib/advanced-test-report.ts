// 高级业务测试报告生成（模块 E8）
// - 生成报告：摘要、发现问题数、严重等级、分类、规则来源、置信度、复现步骤、证据、影响范围、修复建议、AI修复指令
// - 每个问题的修复指南包（RepairGuide）：
//   - 业务规则、规则来源、置信度
//   - 复现步骤、实际行为、业务影响
//   - 可能原因、修复方向
//   - AI 修复指令（优先通过 LLM 动态生成，未配置或调用失败时降级到预写模板）
//   - 禁止事项、修复后验收标准、回归范围

import "server-only";

import {
  getLatestAdvancedTestRun,
  getAdvancedTestResults,
  getRunAdvancedIssues,
  saveAdvancedIssue,
  getProject,
  type AdvancedTestRun,
  type AdvancedPathResult,
  type AdvancedIssue,
  type AdvancedTestReport,
  type AdvancedIssueCategory,
  type Evidence,
  type RiskLevel,
  type Confidence,
} from "./store";
import {
  getAdvancedTestModel,
  getAdvancedTestModelForProject,
  ruleSourceLabels,
  type BusinessRule,
  type TestPath,
} from "./advanced-test-model";
import { classifySeededBugs, type BugClassification } from "./issue-classifier";
import {
  chatCompletionJSON,
  ANALYSIS_TIMEOUT,
  type LLMMessage,
} from "./llm-client";
import { isLLMConfigured } from "./llm-config";
import {
  FIX_SYSTEM_PROMPT,
  buildFixUserPrompt,
  parseFixInstructionResult,
  formatFixInstruction,
  type FixPromptInput,
} from "./prompts/fix-prompt";
import { recordAIThinkingLog, startAIThinkingSession } from "./ai-thinking-log";

// ============================================================
// AI 修复指令生成器
// ============================================================

// Bug 1：签到接口无频率限制
function buildBug1AiInstruction(): string {
  return `# 修复 ISSUE-001：签到接口缺少频率限制，可无限领取积分

## 当前唯一目标
为 /api/sign 接口添加每日频率限制

## 已确认问题
同一用户可在一天内连续调用 /api/sign 接口100次，全部成功，积分从0增长到1000

## 复现路径
1. 登录用户
2. 调用 POST /api/sign
3. 重复调用100次
4. 观察返回结果与积分变化

## 允许修改范围
- src/app/api/sign/route.ts
- src/prisma/schema.prisma（添加唯一索引）

## 禁止事项
- 不要修改前端按钮逻辑作为唯一防线
- 不要修改积分计算逻辑
- 不要重构整体架构

## 必须验证用例
1. 首次签到成功，积分+10
2. 当天第二次签到返回409"今日已签到"
3. 快速双击只成功一次
4. 刷新后不能再领
5. 并发请求只成功一次
6. 第二天可再次签到

## 修复后输出
- 修改的文件列表
- 新增的频率限制逻辑
- 数据库唯一索引DDL`;
}

// Bug 2：双击重复加分
function buildBug2AiInstruction(): string {
  return `# 修复 ISSUE-002：签到接口缺少并发幂等控制，快速双击可重复加分

## 当前唯一目标
为 /api/sign 接口添加并发幂等控制，确保 100ms 内双击只成功一次

## 已确认问题
100ms 内连续触发 2 次 POST /api/sign，两次均返回 200 成功，积分 +20（应 +10），SignRecord 表新增 2 条记录

## 复现路径
1. 登录用户，确保今日未签到
2. 使用脚本在 100ms 内连续发起 2 次 POST /api/sign
3. 观察两次请求的响应状态码与积分变化
4. 查询 SignRecord 表

## 允许修改范围
- src/app/api/sign/route.ts
- src/lib/db.ts（事务/锁封装）

## 禁止事项
- 不要仅依赖前端禁用按钮作为防线
- 不要修改积分计算逻辑
- 不要引入新的中间件依赖

## 必须验证用例
1. 首次签到成功，积分 +10
2. 100ms 内双击只成功一次，第二次返回 409
3. 并发 5 个请求只成功一次
4. 串行第二次签到返回 409
5. 服务端校验通过数据库唯一约束，不依赖内存锁

## 修复后输出
- 修改的文件列表
- 新增的并发控制逻辑（事务/唯一约束/乐观锁）
- 数据库 Schema 变更（如新增唯一索引）`;
}

// Bug 3：刷新可再签
function buildBug3AiInstruction(): string {
  return `# 修复 ISSUE-003：签到状态刷新后丢失，可再次签到

## 当前唯一目标
修复签到状态在页面刷新后丢失的问题，确保前端正确读取后端签到状态

## 已确认问题
签到成功后刷新页面，GET /api/sign/status 返回 signed=false（应为 true），按钮恢复可点击，可再次签到，积分再次 +10

## 复现路径
1. 登录用户，确保今日未签到
2. 点击签到按钮（成功，积分 +10）
3. 刷新浏览器（F5）
4. 观察签到状态是否保持「今日已签到」
5. 若按钮仍可点击，再次点击签到

## 允许修改范围
- src/app/api/sign/status/route.ts（GET 签到状态接口）
- src/app/signin/page.tsx（前端状态读取逻辑）

## 禁止事项
- 不要将签到状态仅存在前端内存/localStorage
- 不要修改积分计算逻辑
- 不要修改签到接口的核心逻辑

## 必须验证用例
1. 签到成功后刷新页面，signed=true
2. 签到成功后按钮保持灰色
3. 刷新后再次点击签到返回 409
4. 退出登录再登录，signed=true
5. 第二天 00:00 后 signed=false

## 修复后输出
- 修改的文件列表
- GET /api/sign/status 的查询逻辑
- 前端状态初始化逻辑`;
}

// Bug 4：跳关
function buildBug4AiInstruction(): string {
  return `# 修复 ISSUE-004：关卡解锁校验缺失，可直接访问下一关答题

## 当前唯一目标
为关卡详情页与答题接口添加前置关卡完成校验

## 已确认问题
未完成关卡 1 和 2 的情况下，直接访问 /level/3 可正常渲染题目并答题成功，获得积分，Progress 表新增关卡 3 的 completed 记录

## 复现路径
1. 登录用户，确保未完成任何关卡
2. 直接访问 /level/3
3. 观察页面是否渲染题目与答题表单
4. 输入正确答案并提交
5. 查询 Progress 表

## 允许修改范围
- src/app/level/[id]/page.tsx（关卡详情页服务端校验）
- src/app/api/level/[id]/answer/route.ts（答题接口校验）
- src/lib/level.ts（关卡解锁逻辑）

## 禁止事项
- 不要仅依赖前端按钮隐藏作为防线
- 不要修改积分计算逻辑
- 不要修改关卡数据结构

## 必须验证用例
1. 未完成关卡 1，访问 /level/2 被拦截（403 或重定向）
2. 未完成关卡 1，访问 /level/3 被拦截
3. 完成关卡 1 后，/level/2 可访问
4. 完成关卡 1 后，直接访问 /level/3 仍被拦截
5. 调用 POST /api/level/3/answer 未完成前置关卡返回 403
6. 服务端校验通过 Progress 表，不依赖前端传参

## 修复后输出
- 修改的文件列表
- 新增的前置关卡校验逻辑
- 关卡解锁规则文档`;
}

// Bug 6：积分不足兑换
function buildBug6AiInstruction(): string {
  return `# 修复 ISSUE-006：兑换接口缺少积分余额校验，0 积分可兑换奖励

## 当前唯一目标
为 /api/exchange 接口添加积分余额校验与原子扣减，确保积分不足时兑换失败

## 已确认问题
0 积分用户调用 POST /api/exchange 兑换价值 100 积分的奖励，返回 200 成功，积分未扣减（仍为 0），ExchangeRecord 表新增 1 条记录，库存 -1

## 复现路径
1. 登录用户，确保积分为 0
2. 进入奖励页，选择价值 100 积分的奖励
3. 点击兑换按钮（或直接调用 POST /api/exchange）
4. 观察响应状态码与积分变化
5. 查询 User.points 与 ExchangeRecord 表

## 允许修改范围
- src/app/api/exchange/route.ts
- src/lib/exchange.ts（兑换业务逻辑）

## 禁止事项
- 不要仅依赖前端按钮禁用作为防线
- 不要修改积分计算逻辑
- 不要修改奖励数据结构
- 不要使用"先查积分再扣减"的非原子操作（存在并发风险）

## 必须验证用例
1. 0 积分兑换 100 积分奖励返回 400"积分不足"
2. 10 积分兑换 100 积分奖励返回 400"积分不足"
3. 100 积分兑换 100 积分奖励成功，积分扣减为 0
4. 并发兑换：100 积分并发兑换 2 个 100 积分奖励，只成功 1 次
5. 库存为 0 时兑换返回 400"库存不足"
6. 兑换后 ExchangeRecord 表新增 1 条，User.points 正确扣减
7. 服务端校验通过原子事务（UPDATE ... WHERE points >= cost）

## 修复后输出
- 修改的文件列表
- 新增的积分余额校验逻辑
- 原子扣减 SQL（UPDATE User SET points = points - cost WHERE id = ? AND points >= cost）`;
}

// 根据 Bug ID 获取 AI 修复指令
function getAiInstructionForBug(bugId: string): string {
  switch (bugId) {
    case "BUG-001":
      return buildBug1AiInstruction();
    case "BUG-002":
      return buildBug2AiInstruction();
    case "BUG-003":
      return buildBug3AiInstruction();
    case "BUG-004":
      return buildBug4AiInstruction();
    case "BUG-006":
      return buildBug6AiInstruction();
    default:
      return `# 修复 ISSUE：未知问题\n\n## 当前唯一目标\n修复检测到的问题`;
  }
}

// ============================================================
// LLM 动态生成修复指令
// - 检查 LLM 是否配置，未配置时直接降级到预写模板
// - 调用 chatCompletionJSON 生成修复指令，失败时降级到预写模板
// ============================================================

async function generateFixInstruction(
  fallback: string,
  input: FixPromptInput,
  projectId?: string,
): Promise<string> {
  // 演示项目一票否决：跳过 LLM，直接使用预写模板
  // 目的：与 AI 分析/测试执行保持一致——演示项目全程剧本，不调用真实 LLM
  if (projectId) {
    const project = getProject(projectId);
    if (project?.isDemo) {
      recordAIThinkingLog(
        projectId,
        "advanced-report",
        "thinking",
        `演示项目走预置剧本：跳过 LLM，使用预写模板生成「${input.caseTitle}」的修复指令`,
      );
      return fallback;
    }
  }
  if (!isLLMConfigured()) {
    if (projectId) {
      recordAIThinkingLog(
        projectId,
        "advanced-report",
        "judging",
        `LLM 未配置，使用预写模板生成「${input.caseTitle}」的修复指令`,
        { level: "warning" },
      );
    }
    return fallback;
  }
  if (projectId) {
    recordAIThinkingLog(
      projectId,
      "advanced-report",
      "thinking",
      `正在为「${input.caseTitle}」(${input.caseId}) 生成 AI 修复指令…`,
    );
  }
  try {
    const messages: LLMMessage[] = [
      { role: "system", content: FIX_SYSTEM_PROMPT },
      { role: "user", content: buildFixUserPrompt(input) },
    ];
    const raw = await chatCompletionJSON(messages, {
      timeout: ANALYSIS_TIMEOUT,
      retries: 1,
    });
    const result = parseFixInstructionResult(raw);
    if (!result) {
      if (projectId) {
        recordAIThinkingLog(
          projectId,
          "advanced-report",
          "judging",
          `LLM 返回格式错误，降级到预写模板：${input.caseTitle}`,
          { level: "warning" },
        );
      }
      return fallback;
    }
    if (projectId) {
      recordAIThinkingLog(
        projectId,
        "advanced-report",
        "observing",
        `AI 修复指令生成完成：${input.caseTitle}`,
      );
    }
    return formatFixInstruction(input.caseTitle, result);
  } catch {
    // LLM 调用失败，降级到预写模板
    if (projectId) {
      recordAIThinkingLog(
        projectId,
        "advanced-report",
        "judging",
        `LLM 调用失败，降级到预写模板：${input.caseTitle}`,
        { level: "warning" },
      );
    }
    return fallback;
  }
}

// ============================================================
// 根据 Bug ID 构建完整 Issue
// ============================================================

interface BugIssueTemplate {
  bugId: string;
  bugNumber: number;
  issueId: string;
  title: string;
  severity: RiskLevel;
  confidence: Confidence;
  ruleId: string;
  ruleSourceLabel: string;
  impactModules: string[];
  possibleCauses: string[];
  fixDirections: string[];
  prohibitions: string[];
  acceptanceCriteria: string[];
  regressionScope: string[];
}

// 5 个 Bug 的修复指南模板
function getBugIssueTemplates(): BugIssueTemplate[] {
  return [
    {
      bugId: "BUG-001",
      bugNumber: 1,
      issueId: "ISSUE-001",
      title: "签到接口无频率限制，可无限领取积分",
      severity: "critical",
      confidence: "high",
      ruleId: "BR-001",
      ruleSourceLabel: ruleSourceLabels.page_copy,
      impactModules: ["激励系统", "签到模块", "积分模块"],
      possibleCauses: [
        "/api/sign 接口未校验今日是否已签到，每次调用都成功",
        "SignRecord 表缺少 (userId, date) 唯一索引，允许重复插入",
        "签到接口未做频率限制（rate limit），可被脚本批量调用",
      ],
      fixDirections: [
        "在 /api/sign 接口开头查询 SignRecord 表今日是否已有记录，有则返回 409",
        "在 SignRecord 表添加 (userId, date) 唯一索引，数据库层兜底防重",
        "添加服务端频率限制（如 1 次/分钟），防止脚本批量调用",
      ],
      prohibitions: [
        "不要修改前端按钮逻辑作为唯一防线",
        "不要修改积分计算逻辑",
        "不要重构整体架构",
        "不要仅依赖内存锁（多实例部署失效）",
      ],
      acceptanceCriteria: [
        "首次签到成功，积分 +10",
        "当天第二次签到返回 409「今日已签到」",
        "快速双击只成功一次",
        "刷新后不能再领",
        "并发请求只成功一次",
        "第二天可再次签到",
      ],
      regressionScope: [
        "签到主路径（首次签到成功）",
        "积分增加逻辑",
        "签到状态查询接口",
        "连续签到奖励（如有）",
        "重新登录后签到状态",
      ],
    },
    {
      bugId: "BUG-002",
      bugNumber: 2,
      issueId: "ISSUE-002",
      title: "签到接口缺少并发幂等控制，快速双击可重复加分",
      severity: "critical",
      confidence: "high",
      ruleId: "BR-002",
      ruleSourceLabel: ruleSourceLabels.industry,
      impactModules: ["激励系统", "签到模块", "积分模块"],
      possibleCauses: [
        "/api/sign 接口未做并发控制，两个请求同时到达时都通过了「今日未签到」校验",
        "签到校验与签到写入非原子操作（先 SELECT 再 INSERT，存在 TOCTOU 竞态）",
        "缺少数据库唯一约束作为兜底",
      ],
      fixDirections: [
        "使用数据库事务 + 唯一约束确保签到原子性",
        "在 SignRecord 表添加 (userId, date) 唯一索引，INSERT 失败即返回 409",
        "考虑使用乐观锁或 SELECT FOR UPDATE 防止并发竞态",
      ],
      prohibitions: [
        "不要仅依赖前端禁用按钮作为防线",
        "不要修改积分计算逻辑",
        "不要引入新的中间件依赖",
        "不要使用内存锁（多实例部署失效）",
      ],
      acceptanceCriteria: [
        "首次签到成功，积分 +10",
        "100ms 内双击只成功一次，第二次返回 409",
        "并发 5 个请求只成功一次",
        "串行第二次签到返回 409",
        "服务端校验通过数据库唯一约束",
      ],
      regressionScope: [
        "签到主路径",
        "积分增加逻辑",
        "并发签到场景",
        "签到状态查询",
      ],
    },
    {
      bugId: "BUG-003",
      bugNumber: 3,
      issueId: "ISSUE-003",
      title: "签到状态刷新后丢失，可再次签到",
      severity: "high",
      confidence: "high",
      ruleId: "BR-003",
      ruleSourceLabel: ruleSourceLabels.industry,
      impactModules: ["激励系统", "签到模块", "前端状态管理"],
      possibleCauses: [
        "GET /api/sign/status 接口查询逻辑错误，未正确返回今日签到状态",
        "前端签到状态仅存在组件 state 中，刷新后丢失，未从后端重新拉取",
        "签到状态查询接口与签到接口的数据源不一致",
      ],
      fixDirections: [
        "修复 GET /api/sign/status 接口，正确查询 SignRecord 表今日记录",
        "前端页面加载时主动调用 /api/sign/status 初始化签到状态",
        "签到成功后更新前端状态，但刷新后必须以服务端状态为准",
      ],
      prohibitions: [
        "不要将签到状态仅存在前端内存/localStorage",
        "不要修改积分计算逻辑",
        "不要修改签到接口的核心逻辑",
      ],
      acceptanceCriteria: [
        "签到成功后刷新页面，signed=true",
        "签到成功后按钮保持灰色",
        "刷新后再次点击签到返回 409",
        "退出登录再登录，signed=true",
        "第二天 00:00 后 signed=false",
      ],
      regressionScope: [
        "签到状态查询接口",
        "签到主路径",
        "前端签到页初始化",
        "重新登录后状态",
      ],
    },
    {
      bugId: "BUG-004",
      bugNumber: 4,
      issueId: "ISSUE-004",
      title: "关卡解锁校验缺失，可直接访问下一关答题",
      severity: "high",
      confidence: "high",
      ruleId: "BR-004",
      ruleSourceLabel: ruleSourceLabels.code,
      impactModules: ["学习系统", "关卡模块", "进度模块", "积分模块"],
      possibleCauses: [
        "关卡详情页 /level/[id] 未在服务端校验前置关卡是否完成",
        "答题接口 /api/level/[id]/answer 未校验前置关卡完成状态",
        "关卡解锁逻辑仅在前端按钮隐藏，未做服务端校验",
      ],
      fixDirections: [
        "在关卡详情页服务端组件中查询前置关卡完成状态，未完成则重定向",
        "在答题接口中校验前置关卡是否已完成，未完成返回 403",
        "服务端校验通过 Progress 表，不依赖前端传参",
      ],
      prohibitions: [
        "不要仅依赖前端按钮隐藏作为防线",
        "不要修改积分计算逻辑",
        "不要修改关卡数据结构",
      ],
      acceptanceCriteria: [
        "未完成关卡 1，访问 /level/2 被拦截",
        "未完成关卡 1，访问 /level/3 被拦截",
        "完成关卡 1 后，/level/2 可访问",
        "完成关卡 1 后，直接访问 /level/3 仍被拦截",
        "调用 POST /api/level/3/answer 未完成前置关卡返回 403",
      ],
      regressionScope: [
        "关卡详情页访问",
        "答题接口",
        "关卡解锁逻辑",
        "进度记录",
        "积分发放",
      ],
    },
    {
      bugId: "BUG-006",
      bugNumber: 6,
      issueId: "ISSUE-006",
      title: "兑换接口缺少积分余额校验，0 积分可兑换奖励",
      severity: "critical",
      confidence: "high",
      ruleId: "BR-005",
      ruleSourceLabel: ruleSourceLabels.industry,
      impactModules: ["激励系统", "兑换模块", "积分模块", "奖励库存"],
      possibleCauses: [
        "/api/exchange 接口未校验用户积分余额是否足够",
        "积分扣减与兑换记录写入非原子操作，存在并发风险",
        "前端按钮未禁用，但服务端也未校验",
      ],
      fixDirections: [
        "在 /api/exchange 接口校验 User.points >= reward.cost，不足返回 400",
        "使用原子事务扣减积分：UPDATE User SET points = points - cost WHERE id = ? AND points >= cost",
        "兑换记录写入与积分扣减在同一事务中",
        "添加库存校验：UPDATE Reward SET stock = stock - 1 WHERE id = ? AND stock > 0",
      ],
      prohibitions: [
        "不要仅依赖前端按钮禁用作为防线",
        "不要修改积分计算逻辑",
        "不要修改奖励数据结构",
        "不要使用「先查积分再扣减」的非原子操作",
      ],
      acceptanceCriteria: [
        "0 积分兑换 100 积分奖励返回 400「积分不足」",
        "10 积分兑换 100 积分奖励返回 400「积分不足」",
        "100 积分兑换 100 积分奖励成功，积分扣减为 0",
        "并发兑换：100 积分并发兑换 2 个 100 积分奖励，只成功 1 次",
        "库存为 0 时兑换返回 400「库存不足」",
        "兑换后 ExchangeRecord 表新增 1 条，User.points 正确扣减",
      ],
      regressionScope: [
        "兑换主路径",
        "积分扣减逻辑",
        "库存扣减逻辑",
        "兑换记录查询",
        "积分余额查询",
      ],
    },
  ];
}

// ============================================================
// 根据路径结果与 Bug 分类生成 Issue
// ============================================================

async function buildIssueFromPathResult(
  projectId: string,
  runId: string,
  result: AdvancedPathResult,
  bugClassification: BugClassification,
  template: BugIssueTemplate,
): Promise<AdvancedIssue> {
  // 从路径结果中提取证据（截图/Console/网络请求/数据变化）
  const evidences: Evidence[] = [];
  for (const step of result.steps) {
    if (step.screenshotDesc) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "screenshot",
        content: `步骤 ${step.index}：${step.screenshotDesc}`,
      });
    }
    if (step.consoleLog) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "console",
        content: `步骤 ${step.index} Console：\n${step.consoleLog}`,
      });
    }
    if (step.networkRequest) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "network",
        content: `步骤 ${step.index} 网络请求：\n${step.networkRequest}`,
      });
    }
  }

  // 复现步骤（从路径结果的步骤中提取 action）
  const reproduceSteps = result.steps.map(
    (s) => `步骤 ${s.index}：${s.action}`,
  );

  // LLM 动态生成修复指令，未配置或失败时降级到预写模板
  const fallbackInstruction = getAiInstructionForBug(template.bugId);
  const aiInstruction = await generateFixInstruction(fallbackInstruction, {
    caseTitle: template.title,
    caseId: template.bugId,
    expected: result.expectedBehavior,
    actual: result.actualBehavior,
    reproduceSteps,
    evidences,
    possibleCauses: template.possibleCauses,
    impactModules: template.impactModules,
  }, projectId);

  return {
    id: template.issueId,
    projectId,
    runId,
    pathId: result.pathId,
    resultId: result.id,
    detectedBugId: template.bugId,
    bugNumber: template.bugNumber,
    title: template.title,
    category: bugClassification.category,
    categoryReason: bugClassification.reason,
    severity: template.severity,
    confidence: template.confidence,
    ruleId: template.ruleId,
    ruleSource: template.ruleSourceLabel,
    impactModules: template.impactModules,
    reproduceSteps,
    expected: result.expectedBehavior,
    actual: result.actualBehavior,
    evidences,
    possibleCauses: template.possibleCauses,
    fixDirections: template.fixDirections,
    aiInstruction,
    prohibitions: template.prohibitions,
    acceptanceCriteria: template.acceptanceCriteria,
    regressionScope: template.regressionScope,
    status: "open",
    retestRounds: 0,
    maxRetestRounds: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// 为没有预定义模板的失败结果生成通用 Issue
async function buildGenericIssueFromPathResult(
  projectId: string,
  runId: string,
  result: AdvancedPathResult,
  dynamicBugId: string,
  bugNumber: number,
): Promise<AdvancedIssue> {
  // 从路径结果中提取证据
  const evidences: Evidence[] = [];
  for (const step of result.steps) {
    if (step.screenshotDesc) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "screenshot",
        content: `步骤 ${step.index}：${step.screenshotDesc}`,
      });
    }
    if (step.consoleLog) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "console",
        content: `步骤 ${step.index} Console：\n${step.consoleLog}`,
      });
    }
    if (step.networkRequest) {
      evidences.push({
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "network",
        content: `步骤 ${step.index} 网络请求：\n${step.networkRequest}`,
      });
    }
  }

  const reproduceSteps = result.steps.map(
    (s) => `步骤 ${s.index}：${s.action}`,
  );

  // 根据严重程度推断分类
  const severity = result.severity || "medium";
  const category: AdvancedIssueCategory = severity === "critical" || severity === "high"
    ? "high_prob_vulnerability"
    : "ux_defect";

  // 生成 AI 修复指令
  const fallbackInstruction = `针对路径「${result.title || result.pathId}」的失败进行修复。\n\n预期行为：${result.expectedBehavior}\n实际行为：${result.actualBehavior}\n\n请根据执行证据分析根因并修复。`;
  const aiInstruction = await generateFixInstruction(fallbackInstruction, {
    caseTitle: result.title || `路径 ${result.pathId} 执行失败`,
    caseId: dynamicBugId,
    expected: result.expectedBehavior,
    actual: result.actualBehavior,
    reproduceSteps,
    evidences,
    possibleCauses: ["需根据执行证据分析具体原因"],
    impactModules: [result.title || "相关功能模块"],
  }, projectId);

  return {
    id: `ISSUE-DYN-${bugNumber}`,
    projectId,
    runId,
    pathId: result.pathId,
    resultId: result.id,
    detectedBugId: dynamicBugId,
    bugNumber,
    title: result.title || `路径 ${result.pathId} 执行失败`,
    category,
    categoryReason: `基于路径执行结果动态生成（严重等级：${severity}）`,
    severity,
    confidence: "medium",
    ruleId: "DYNAMIC",
    ruleSource: "AI 动态生成",
    impactModules: [result.title || "相关功能模块"],
    reproduceSteps,
    expected: result.expectedBehavior,
    actual: result.actualBehavior,
    evidences,
    possibleCauses: ["需根据执行证据分析具体原因"],
    fixDirections: ["根据执行证据和实际行为分析根因", "修复后重新执行该路径验证"],
    aiInstruction,
    prohibitions: ["不要在未理解根因的情况下盲目修改代码"],
    acceptanceCriteria: ["重新执行该路径，结果为通过"],
    regressionScope: [result.title || "相关功能模块"],
    status: "open",
    retestRounds: 0,
    maxRetestRounds: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
// 生成高级测试报告
// ============================================================

export async function generateAdvancedReport(
  projectId: string,
): Promise<AdvancedTestReport | undefined> {
  const project = getProject(projectId);
  if (!project) return undefined;

  // 开启新的 AI 思考会话（生成报告时的思考过程）
  startAIThinkingSession(projectId, "advanced-report");

  const run = getLatestAdvancedTestRun(projectId);
  if (!run) return undefined;

  const results = getAdvancedTestResults(run.id);

  // 收集失败结果（检测到 Bug 的路径）
  const failedResults = results.filter((r) => r.status === "fail");

  // 检查是否已生成过 Issue
  const existingIssues = getRunAdvancedIssues(run.id);
  const existingIssueMap = new Map(
    existingIssues.map((i) => [i.detectedBugId ?? i.id, i]),
  );

  // 获取 Bug 分类（基于项目动态生成的测试模型）
  const model = getAdvancedTestModelForProject(project);
  const bugClassifications = classifySeededBugs(model.rules);
  const classificationMap = new Map(
    bugClassifications.map((c) => [c.bugId, c]),
  );

  // 获取 Bug Issue 模板
  const templates = getBugIssueTemplates();
  const templateMap = new Map(templates.map((t) => [t.bugId, t]));

  // 为新的失败结果生成 Issue
  const issues: AdvancedIssue[] = [];
  let dynamicBugCounter = 100; // 动态 Bug 编号从 100 开始，避免与预定义 BUG-001~006 冲突
  for (const result of failedResults) {
    // 如果有 detectedBugId 且匹配预定义模板，使用模板生成
    if (result.detectedBugId) {
      const existing = existingIssueMap.get(result.detectedBugId);
      if (existing) {
        issues.push(existing);
        continue;
      }

      const classification = classificationMap.get(result.detectedBugId);
      const template = templateMap.get(result.detectedBugId);
      if (classification && template) {
        const issue = await buildIssueFromPathResult(
          projectId,
          run.id,
          result,
          classification,
          template,
        );
        saveAdvancedIssue(issue);
        issues.push(issue);
        continue;
      }
    }

    // 没有 detectedBugId 或模板不匹配：生成通用 Issue
    const existing = existingIssueMap.get(result.pathId);
    if (existing) {
      issues.push(existing);
      continue;
    }

    const dynamicBugId = `BUG-DYN-${++dynamicBugCounter}`;
    const genericIssue = await buildGenericIssueFromPathResult(
      projectId,
      run.id,
      result,
      dynamicBugId,
      dynamicBugCounter,
    );
    saveAdvancedIssue(genericIssue);
    issues.push(genericIssue);
  }

  // 合并已存在的 Issue
  for (const existing of existingIssues) {
    if (!issues.find((i) => i.id === existing.id)) {
      issues.push(existing);
    }
  }

  // 按 bugNumber 排序
  issues.sort((a, b) => (a.bugNumber ?? 0) - (b.bugNumber ?? 0));

  // 统计分类
  const confirmedBugCount = issues.filter(
    (i) => i.category === "confirmed_bug",
  ).length;
  const highProbVulnerabilityCount = issues.filter(
    (i) => i.category === "high_prob_vulnerability",
  ).length;
  const uxDefectCount = issues.filter(
    (i) => i.category === "ux_defect",
  ).length;
  const requirementGapCount = issues.filter(
    (i) => i.category === "requirement_gap",
  ).length;

  // 从结果直接计算 skipped，兼容旧数据（run.skipped 可能未设置）
  const skippedFromResults = results.filter((r) => r.status === "skip").length;
  const skipped = run.skipped ?? skippedFromResults;

  return {
    projectId,
    runId: run.id,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    skipped,
    detectedBugCount: run.detectedBugCount,
    confirmedBugCount,
    highProbVulnerabilityCount,
    uxDefectCount,
    requirementGapCount,
    issues,
    generatedAt: new Date().toISOString(),
  };
}

// 获取报告（不重新生成，仅读取已有数据）
export async function getAdvancedReport(
  projectId: string,
): Promise<AdvancedTestReport | undefined> {
  return generateAdvancedReport(projectId);
}
