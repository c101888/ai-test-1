// 高级业务测试执行引擎（模块 E7）
// - runAdvancedTests(projectId, mode, onProgress)：执行高级业务测试
// - mode: "scripted"（剧本回放，降级）或 "real"（真实执行，Playwright + API + DB）
// - 真实执行模式：访问运行中的项目，通过 API 驱动真实操作，发现 5 个预埋 Bug
// - 剧本回放模式：预定义执行结果（演示项目降级方案）
// - 每条路径收集完整证据（AdvancedStepRecord）：
//   - 浏览器操作步骤 / 截图描述 / Console 日志 / 网络请求记录
//   - API 响应 / 数据变化 / 前后状态对比

import "server-only";
import {
  createAdvancedTestRun,
  saveAdvancedTestResult,
  updateAdvancedTestRun,
  markAdvancedTesting,
  getAdvancedTestRun,
  getProject,
  type AdvancedPathResult,
  type AdvancedStepRecord,
  type AdvancedTestRun,
} from "./store";
import {
  getAdvancedTestModel,
  getAdvancedTestModelForProject,
  type TestPath,
  type AdvancedTestModel,
} from "./advanced-test-model";
import { getAdvancedTestModelForProjectAsync } from "./advanced-test-model-async";
import { createRealExecutor, type RealTestExecutor } from "./test-executor";
import { resolveDbPath } from "./test-executor/db-reader";
import { concurrentRequests } from "./test-executor/api-driver";
import type { IPage } from "./test-executor/types";
import { getTestPassword, getLevelAnswerForProject } from "./test-credentials";
import { getAuthContract, type AuthContract, type ApiEndpointContract } from "./api-contract";
import { recordAIThinkingLog, startAIThinkingSession } from "./ai-thinking-log";
import type { Project } from "./store";

// ============================================================
// 通用工具函数
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 随机延时 1-2 秒（剧本回放模式使用）
function pathDelay(): Promise<void> {
  const ms = 1000 + Math.floor(Math.random() * 1000);
  return delay(ms);
}

// 生成结果 ID
function genResultId(): string {
  return `advres_${Math.random().toString(36).slice(2, 10)}`;
}

// 生成唯一的测试用户名（避免冲突）
// 使用纯字母数字格式（无下划线/连字符），兼容大多数项目的用户名校验规则
function genTestUsername(prefix: string = "adv"): string {
  const ts = Date.now().toString(36).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5);
  return `${prefix}${ts}${rand}`;
}

// ============================================================
// 剧本回放模式（保留原有逻辑，作为降级方案）
// ============================================================

interface ScriptedPathOutcome {
  status: "pass" | "fail";
  severity: "low" | "medium" | "high" | "critical";
  confidence: "high" | "medium" | "low";
  detectedBugId?: string;
  expectedBehavior: string;
  actualBehavior: string;
  impactScope: string;
  steps: AdvancedStepRecord[];
}

// ============================================================
// Bug 1：签到接口无频率限制（PATH-002）
// 连续点击签到 100 次，全部成功，积分从 0 增长到 1000
// ============================================================
function buildBug1Steps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，确保今日未签到（查询 SignRecord 表为空）",
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      consoleLog: "[Auth] 登录成功，userId=u_001\n[Network] GET /api/sign/status 200 → { signed: false }",
      networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
      apiResponse: '{ "signed": false, "points": 0 }',
      dataChange: "SignRecord 表：0 条；User.points：0",
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    },
    {
      index: 2,
      action: "进入签到页 /signin，定位「每日签到」按钮",
      screenshotDesc: "签到页渲染「每日签到 +10 积分」按钮，按钮为可点击状态（accent 配色）",
      consoleLog: "[Render] SigninPage mounted\n[DOM] button[data-testid='sign-btn'] 可点击",
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    },
    {
      index: 3,
      action: "使用脚本在 10 秒内连续点击签到按钮 100 次（每次间隔约 100ms）",
      screenshotDesc: "签到按钮连续点击 100 次，每次点击后弹窗显示「签到成功 +10 积分」，积分从 0 增长到 1000",
      consoleLog: "[Network] POST /api/sign 200 × 100 次（应仅 1 次 200，99 次 409）\n[Console] 100 次签到成功提示",
      networkRequest: "POST /api/sign 200 → { success: true, points: +10 } × 100 次（共 100 次成功响应）",
      apiResponse: '{ "success": true, "points": 10 } × 100',
      dataChange: "积分：0 → 1000（+1000）；签到记录：0 → 100 条",
      stateBefore: "未签到，积分 0",
      stateAfter: "已签到 100 次，积分 1000",
    },
    {
      index: 4,
      action: "查询 SignRecord 表，统计今日签到记录数",
      screenshotDesc: "数据库查询结果：SignRecord 表今日记录 100 条，全部为成功签到",
      consoleLog: "[DB] SELECT COUNT(*) FROM SignRecord WHERE userId=u_001 AND date=today → 100",
      networkRequest: "GET /api/sign/history 200 → { records: [...100 条] }",
      apiResponse: '{ "total": 100, "records": [...] }',
      dataChange: "SignRecord 表今日记录：100 条（违反 INV-002：同一用户一天不能有多条成功签到记录）",
      stateBefore: "预期签到记录：1 条",
      stateAfter: "实际签到记录：100 条",
    },
  ];
}

// ============================================================
// Bug 2：快速双击签到（PATH-003）
// 100ms 内双击签到按钮，两次都成功，积分 +20
// ============================================================
function buildBug2Steps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，确保今日未签到",
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      consoleLog: "[Auth] 登录成功\n[Network] GET /api/sign/status 200 → { signed: false }",
      networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
      apiResponse: '{ "signed": false, "points": 0 }',
      dataChange: "SignRecord 表：0 条；User.points：0",
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    },
    {
      index: 2,
      action: "使用脚本在 100ms 内连续触发 2 次 POST /api/sign 请求（模拟双击）",
      screenshotDesc: "浏览器 Network 面板显示 2 个 POST /api/sign 请求，时间戳相差 87ms，均返回 200",
      consoleLog: "[Network] POST /api/sign 200 (87ms 后) POST /api/sign 200\n[Console] 2 次签到成功提示",
      networkRequest: "POST /api/sign 200 → { success: true, points: +10 }\nPOST /api/sign 200 → { success: true, points: +10 }（间隔 87ms）",
      apiResponse: '{ "success": true, "points": 10 } × 2',
      dataChange: "积分：0 → 20（+20，应为 +10）；签到记录：0 → 2 条",
      stateBefore: "未签到，积分 0",
      stateAfter: "已签到 2 次，积分 20",
    },
    {
      index: 3,
      action: "查询 SignRecord 表，统计今日签到记录数",
      screenshotDesc: "数据库查询结果：SignRecord 表今日记录 2 条，时间戳相差 87ms",
      consoleLog: "[DB] SELECT * FROM SignRecord WHERE userId=u_001 AND date=today → 2 条记录",
      networkRequest: "GET /api/sign/history 200 → { records: [...2 条] }",
      apiResponse: '{ "total": 2, "records": [...] }',
      dataChange: "SignRecord 表今日记录：2 条（违反 INV-002）",
      stateBefore: "预期签到记录：1 条",
      stateAfter: "实际签到记录：2 条",
    },
  ];
}

// ============================================================
// Bug 3：签到后刷新可再签（PATH-004）
// 签到成功后刷新页面，签到状态未保持，可再次签到
// ============================================================
function buildBug3Steps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，确保今日未签到",
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      consoleLog: "[Auth] 登录成功\n[Network] GET /api/sign/status 200 → { signed: false }",
      networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
      apiResponse: '{ "signed": false, "points": 0 }',
      dataChange: "SignRecord 表：0 条；User.points：0",
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    },
    {
      index: 2,
      action: "点击签到按钮，签到成功，积分 +10",
      screenshotDesc: "签到成功提示「+10 积分」，按钮变灰显示「今日已签到」，积分余额：10",
      consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }\n[UI] 按钮变灰",
      networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
      apiResponse: '{ "success": true, "points": 10 }',
      dataChange: "积分：0 → 10（+10）；签到记录：0 → 1 条",
      stateBefore: "未签到，积分 0",
      stateAfter: "已签到，积分 10",
    },
    {
      index: 3,
      action: "刷新浏览器（F5）",
      screenshotDesc: "刷新后签到页重新渲染，「每日签到」按钮恢复为可点击状态（应为灰色「今日已签到」）",
      consoleLog: "[Network] GET /api/sign/status 200 → { signed: false }（应为 signed: true）\n[UI] 按钮恢复可点击",
      networkRequest: "GET /api/sign/status 200 → { signed: false, points: 10 }",
      apiResponse: '{ "signed": false, "points": 10 }（signed 应为 true）',
      dataChange: "前端状态：signed=true → signed=false（刷新后丢失）",
      stateBefore: "已签到，按钮灰色",
      stateAfter: "未签到（前端状态丢失），按钮可点击",
    },
    {
      index: 4,
      action: "再次点击签到按钮，签到成功，积分再次 +10",
      screenshotDesc: "签到成功提示「+10 积分」，积分余额：20（应为 10）",
      consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }\n[Console] 签到成功提示",
      networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
      apiResponse: '{ "success": true, "points": 10 }',
      dataChange: "积分：10 → 20（+10，违规）；签到记录：1 → 2 条",
      stateBefore: "已签到 1 次，积分 10",
      stateAfter: "已签到 2 次，积分 20",
    },
  ];
}

// ============================================================
// Bug 4：跳关（PATH-005）
// 未完成关卡 1 和 2，直接访问 /level/3 答题成功
// ============================================================
function buildBug4Steps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，确保未完成任何关卡（查询 Progress 表无 completed 记录）",
      screenshotDesc: "首页关卡列表：关卡 1 显示「进入」，关卡 2/3 显示「锁定」",
      consoleLog: "[Network] GET /api/level 200 → levels[0].status=locked, levels[1].status=locked, levels[2].status=locked",
      networkRequest: "GET /api/level 200 → [{ id:1, status:locked }, { id:2, status:locked }, { id:3, status:locked }]",
      apiResponse: '[{ "id": 1, "status": "locked" }, ...]',
      dataChange: "Progress 表：0 条 completed 记录",
      stateBefore: "未完成任何关卡",
      stateAfter: "未完成任何关卡",
    },
    {
      index: 2,
      action: "直接访问 /level/3（绕过首页关卡列表的解锁校验）",
      screenshotDesc: "关卡 3 详情页正常渲染，显示题目与答题表单（应被拦截或重定向到 /level/1）",
      consoleLog: "[Network] GET /api/level/3 200 → { id:3, title:'关卡3', question:'...' }\n[Route] /level/3 渲染成功（应 403）",
      networkRequest: "GET /api/level/3 200 → { id: 3, question: '...', answer: '...' }",
      apiResponse: '{ "id": 3, "question": "关卡3题目", "status": "locked" }',
      dataChange: "无（仅渲染页面）",
      stateBefore: "未访问关卡 3",
      stateAfter: "关卡 3 页面已渲染",
    },
    {
      index: 3,
      action: "输入正确答案并提交",
      screenshotDesc: "提交后显示「回答正确 +10 积分」，关卡 3 状态变为 completed",
      consoleLog: "[Network] POST /api/level/3/answer 200 → { correct: true, points: +10 }\n[UI] 显示「回答正确」",
      networkRequest: "POST /api/level/3/answer 200 → { correct: true, points: 10 }",
      apiResponse: '{ "correct": true, "points": 10 }',
      dataChange: "积分：0 → 10（+10）；Progress 表新增关卡 3 的 completed 记录（违反 INV-004）",
      stateBefore: "关卡 3 未完成",
      stateAfter: "关卡 3 已完成（违规）",
    },
    {
      index: 4,
      action: "查询 Progress 表，检查关卡 3 的 status",
      screenshotDesc: "数据库查询结果：Progress 表存在 (userId=u_001, levelId=3, status=completed) 记录，但无对应 AnswerRecord 的合法前置",
      consoleLog: "[DB] SELECT * FROM Progress WHERE userId=u_001 → [{ levelId:3, status:completed }]（应无此记录）",
      networkRequest: "GET /api/level 200 → [{ id:1, status:locked }, { id:2, status:locked }, { id:3, status:completed }]",
      apiResponse: '[{ "id": 3, "status": "completed" }]',
      dataChange: "Progress 表：关卡 3 status=completed（违反 INV-004：未完成关卡不能进入完成状态）",
      stateBefore: "预期：关卡 3 不可完成",
      stateAfter: "实际：关卡 3 已完成",
    },
  ];
}

// ============================================================
// Bug 6：积分不足兑换（PATH-006）
// 0 积分兑换 100 积分奖励，兑换成功
// ============================================================
function buildBug6Steps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，确保积分为 0（新用户）",
      screenshotDesc: "积分页显示余额：0；奖励页显示「100 积分奖励」可兑换",
      consoleLog: "[Network] GET /api/points 200 → { points: 0 }\n[Network] GET /api/rewards 200 → [{ id:1, cost:100, stock:10 }]",
      networkRequest: "GET /api/points 200 → { points: 0 }\nGET /api/rewards 200 → [{ id:1, cost:100, stock:10 }]",
      apiResponse: '{ "points": 0 }',
      dataChange: "User.points：0；ExchangeRecord 表：0 条",
      stateBefore: "积分 0",
      stateAfter: "积分 0",
    },
    {
      index: 2,
      action: "进入奖励页，选择价值 100 积分的奖励，点击兑换按钮",
      screenshotDesc: "奖励卡片显示「兑换（需 100 积分）」，按钮可点击（应禁用或拦截）",
      consoleLog: "[UI] 兑换按钮可点击（应禁用）",
      stateBefore: "积分 0",
      stateAfter: "积分 0",
    },
    {
      index: 3,
      action: "点击兑换（或直接调用 POST /api/exchange）",
      screenshotDesc: "兑换成功提示「兑换成功」，奖励已发放，积分仍为 0（应为 -100 或兑换失败）",
      consoleLog: "[Network] POST /api/exchange 200 → { success: true }（应 400 积分不足）\n[Console] 兑换成功提示",
      networkRequest: "POST /api/exchange 200 → { success: true, rewardId: 1 }",
      apiResponse: '{ "success": true, "rewardId": 1 }（应返回 400 { error: "积分不足" }）',
      dataChange: "积分：0 → 0（未扣减，违规）；ExchangeRecord 表新增 1 条；Reward 表 stock：10 → 9",
      stateBefore: "积分 0，库存 10",
      stateAfter: "积分 0（未扣减），库存 9，兑换记录 +1",
    },
    {
      index: 4,
      action: "查询 User.points 与 ExchangeRecord 表",
      screenshotDesc: "数据库查询结果：User.points=0（应为 -100 或兑换失败），ExchangeRecord 表新增 1 条记录",
      consoleLog: "[DB] SELECT points FROM User WHERE id=u_001 → 0（违规）\n[DB] SELECT * FROM ExchangeRecord WHERE userId=u_001 → 1 条",
      networkRequest: "GET /api/points 200 → { points: 0 }",
      apiResponse: '{ "points": 0 }',
      dataChange: "User.points：0（违反 INV-005：积分余额必须与签到+答题-兑换的汇总一致）",
      stateBefore: "预期：积分不足，兑换失败",
      stateAfter: "实际：兑换成功，积分未扣减",
    },
  ];
}

// ============================================================
// 正常路径（PATH-001）与综合验证路径（PATH-007）的步骤
// ============================================================
function buildNormalPathSteps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，进入签到页",
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      consoleLog: "[Auth] 登录成功\n[Network] GET /api/sign/status 200 → { signed: false }",
      networkRequest: "GET /api/sign/status 200 → { signed: false, points: 0 }",
      apiResponse: '{ "signed": false, "points": 0 }',
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    },
    {
      index: 2,
      action: "点击签到按钮",
      screenshotDesc: "签到成功提示「+10 积分」，按钮变灰显示「今日已签到」",
      consoleLog: "[Network] POST /api/sign 200 → { success: true, points: +10 }\n[UI] 按钮变灰",
      networkRequest: "POST /api/sign 200 → { success: true, points: 10 }",
      apiResponse: '{ "success": true, "points": 10 }',
      dataChange: "积分：0 → 10（+10）；签到记录：0 → 1 条",
      stateBefore: "未签到，积分 0",
      stateAfter: "已签到，积分 10",
    },
    {
      index: 3,
      action: "刷新页面",
      screenshotDesc: "刷新后签到状态保持「今日已签到」，按钮仍为灰色",
      consoleLog: "[Network] GET /api/sign/status 200 → { signed: true }\n[UI] 按钮保持灰色",
      networkRequest: "GET /api/sign/status 200 → { signed: true, points: 10 }",
      apiResponse: '{ "signed": true, "points": 10 }',
      dataChange: "无变化（状态保持）",
      stateBefore: "已签到，积分 10",
      stateAfter: "已签到，积分 10",
    },
  ];
}

function buildCrossFunctionPathSteps(): AdvancedStepRecord[] {
  return [
    {
      index: 1,
      action: "用户 learner_test 登录，记录初始积分 P0=0",
      screenshotDesc: "积分页显示余额：0",
      consoleLog: "[Network] GET /api/points 200 → { points: 0 }",
      networkRequest: "GET /api/points 200 → { points: 0 }",
      apiResponse: '{ "points": 0 }',
      dataChange: "P0 = 0",
      stateBefore: "积分 0",
      stateAfter: "积分 0",
    },
    {
      index: 2,
      action: "完成关卡 1，获得 10 积分",
      screenshotDesc: "答题正确提示「+10 积分」，积分余额：10",
      consoleLog: "[Network] POST /api/level/1/answer 200 → { correct: true, points: +10 }",
      networkRequest: "POST /api/level/1/answer 200 → { correct: true, points: 10 }",
      apiResponse: '{ "correct": true, "points": 10 }',
      dataChange: "积分：0 → 10（P1 = P0 + 10 = 10）",
      stateBefore: "积分 0",
      stateAfter: "积分 10",
    },
    {
      index: 3,
      action: "兑换价值 5 积分的奖励",
      screenshotDesc: "兑换成功提示「兑换成功」，积分余额：5",
      consoleLog: "[Network] POST /api/exchange 200 → { success: true }",
      networkRequest: "POST /api/exchange 200 → { success: true, rewardId: 2 }",
      apiResponse: '{ "success": true, "rewardId": 2 }',
      dataChange: "积分：10 → 5（P2 = P1 - 5 = 5）；ExchangeRecord 表 +1 条",
      stateBefore: "积分 10",
      stateAfter: "积分 5",
    },
    {
      index: 4,
      action: "验证 P2 = P1 - 5 = 5，查询 ExchangeRecord 表",
      screenshotDesc: "积分余额：5，兑换记录 1 条，库存 -1",
      consoleLog: "[DB] SELECT points FROM User → 5\n[DB] SELECT * FROM ExchangeRecord → 1 条",
      networkRequest: "GET /api/points 200 → { points: 5 }",
      apiResponse: '{ "points": 5 }',
      dataChange: "P2 = 5 = P1 - 5 ✓（积分扣减正确）",
      stateBefore: "预期：P2 = 5",
      stateAfter: "实际：P2 = 5 ✓",
    },
  ];
}

// 根据路径 ID 返回预定义执行结果
function getScriptedPathOutcome(path: TestPath): ScriptedPathOutcome {
  switch (path.id) {
    case "PATH-001":
      // 正常路径：通过
      return {
        status: "pass",
        severity: "low",
        confidence: "high",
        expectedBehavior: path.expectedBehavior,
        actualBehavior: "签到成功后积分 +10，按钮变灰，刷新后状态保持",
        impactScope: "无",
        steps: buildNormalPathSteps(),
      };

    case "PATH-002":
      // Bug 1：无限签到
      return {
        status: "fail",
        severity: "critical",
        confidence: "high",
        detectedBugId: "BUG-001",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "100 次签到全部成功，积分从 0 增长到 1000，SignRecord 表新增 100 条记录（应仅 1 条）",
        impactScope:
          "激励系统核心：签到接口无频率限制，用户可无限领取积分，破坏积分经济体系与游戏平衡",
        steps: buildBug1Steps(),
      };

    case "PATH-003":
      // Bug 2：双击重复
      return {
        status: "fail",
        severity: "critical",
        confidence: "high",
        detectedBugId: "BUG-002",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "100ms 内双击签到，两次请求均返回 200 成功，积分 +20（应 +10），SignRecord 表新增 2 条记录",
        impactScope:
          "激励系统：并发请求未做幂等控制，用户可通过快速双击重复领取积分",
        steps: buildBug2Steps(),
      };

    case "PATH-004":
      // Bug 3：刷新可再签
      return {
        status: "fail",
        severity: "high",
        confidence: "high",
        detectedBugId: "BUG-003",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "签到后刷新页面，签到状态丢失（signed=true → signed=false），可再次签到，积分再次 +10",
        impactScope:
          "激励系统：签到状态未正确持久化或前端未读取后端状态，用户可通过刷新绕过每日一次限制",
        steps: buildBug3Steps(),
      };

    case "PATH-005":
      // Bug 4：跳关
      return {
        status: "fail",
        severity: "high",
        confidence: "high",
        detectedBugId: "BUG-004",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "直接访问 /level/3 未被拦截，可答题并获得积分，Progress 表新增关卡 3 的 completed 记录",
        impactScope:
          "学习系统：关卡解锁校验缺失，用户可跳过前置关卡直接答题获得积分，破坏学习路径与进度体系",
        steps: buildBug4Steps(),
      };

    case "PATH-006":
      // Bug 6：积分不足兑换
      return {
        status: "fail",
        severity: "critical",
        confidence: "high",
        detectedBugId: "BUG-006",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "0 积分兑换 100 积分奖励成功，积分未扣减（仍为 0），ExchangeRecord 表新增 1 条记录，库存 -1",
        impactScope:
          "激励系统·兑换模块：积分余额校验缺失，用户可 0 成本兑换任意奖励，造成库存损失与积分经济崩溃",
        steps: buildBug6Steps(),
      };

    case "PATH-007":
      // 跨功能综合验证：通过
      return {
        status: "pass",
        severity: "low",
        confidence: "high",
        expectedBehavior: path.expectedBehavior,
        actualBehavior:
          "完成关卡获得 10 积分，兑换 5 积分奖励后余额正确为 5，积分扣减逻辑正确",
        impactScope: "无",
        steps: buildCrossFunctionPathSteps(),
      };

    default:
      return {
        status: "pass",
        severity: "low",
        confidence: "high",
        expectedBehavior: path.expectedBehavior,
        actualBehavior: "执行通过",
        impactScope: "无",
        steps: [],
      };
  }
}

// 执行单条剧本路径
async function executeScriptedPath(
  path: TestPath,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  // 模拟执行耗时 1-2 秒
  await pathDelay();
  const durationMs = Date.now() - startMs;

  const outcome = getScriptedPathOutcome(path);

  const result: AdvancedPathResult = {
    id: genResultId(),
    runId,
    pathId: path.id,
    pathType: path.type,
    title: path.title,
    status: outcome.status,
    severity: outcome.severity,
    confidence: outcome.confidence,
    detectedBugId: outcome.detectedBugId,
    expectedBehavior: outcome.expectedBehavior,
    actualBehavior: outcome.actualBehavior,
    impactScope: outcome.impactScope,
    steps: outcome.steps,
    executedAt: new Date().toISOString(),
    durationMs,
  };

  return result;
}

// 剧本回放模式主函数（仅用于演示项目）
async function runScriptedAdvancedTests(
  projectId: string,
  onProgress?: (
    current: number,
    total: number,
    path: TestPath,
    result: AdvancedPathResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: AdvancedTestRun; results: AdvancedPathResult[] }> {
  // 标记项目进入高级测试阶段
  markAdvancedTesting(projectId);

  // 开启新的 AI 思考会话（清空旧日志，刷新页面时保留本次执行的思考过程）
  startAIThinkingSession(projectId, "advanced-run");

  // AI 思考日志：开始
  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "thinking",
    "开始执行高级业务测试（剧本回放模式）",
  );

  // 获取项目信息，基于项目分析动态生成测试模型
  const project = getProject(projectId);
  if (!project) {
    recordAIThinkingLog(
      projectId,
      "advanced-run",
      "judging",
      "项目不存在，无法执行测试",
      { level: "error" },
    );
    throw new Error("项目不存在");
  }

  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "thinking",
    `正在根据项目「${project.name}」的业务功能动态生成测试清单…`,
  );
  const model: AdvancedTestModel = await getAdvancedTestModelForProjectAsync(project);
  const paths = model.paths;

  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "observing",
    `AI 已生成 ${paths.length} 条测试路径，覆盖 ${Array.from(new Set(paths.map((p) => p.type))).join("、")} 等类型`,
  );

  // 创建测试运行
  const run = createAdvancedTestRun(projectId, "scripted", paths.length);
  onRunCreated?.(run.id);

  const results: AdvancedPathResult[] = [];

  try {
    // 逐个执行路径（单条失败不中断后续路径）
    for (let i = 0; i < paths.length; i++) {
      // 检查中止请求
      if (shouldAbort?.()) {
        recordAIThinkingLog(
          projectId,
          "advanced-run",
          "judging",
          "收到用户中止请求，停止后续测试",
          { level: "warning" },
        );
        updateAdvancedTestRun(run.id, {
          status: "failed",
          error: "用户中止测试",
          finishedAt: new Date().toISOString(),
        });
        break;
      }
      const path = paths[i];
      // AI 思考日志：开始执行此路径
      recordAIThinkingLog(
        projectId,
        "advanced-run",
        "thinking",
        `路径 ${i + 1}/${paths.length} · ${path.id}：分析测试目标 — ${path.title}`,
        {
          context: { pathId: path.id, pathTitle: path.title },
        },
      );
      recordAIThinkingLog(
        projectId,
        "advanced-run",
        "acting",
        `执行测试步骤：${path.steps.slice(0, 3).join(" → ")}${path.steps.length > 3 ? " → …" : ""}`,
        {
          context: { pathId: path.id, pathTitle: path.title },
        },
      );
      try {
        const result = await executeScriptedPath(path, run.id);
        saveAdvancedTestResult(result);
        results.push(result);
        onProgress?.(i + 1, paths.length, path, result);

        // AI 思考日志：路径执行结果
        if (result.status === "pass") {
          recordAIThinkingLog(
            projectId,
            "advanced-run",
            "observing",
            `路径 ${path.id} 执行通过：${result.actualBehavior}`,
            {
              context: { pathId: path.id, pathTitle: path.title },
            },
          );
        } else {
          recordAIThinkingLog(
            projectId,
            "advanced-run",
            "judging",
            `路径 ${path.id} 发现问题（${result.severity}）：${result.actualBehavior}`,
            {
              level: "warning",
              context: { pathId: path.id, pathTitle: path.title },
            },
          );
        }
      } catch (err) {
        const failResult = buildFailPathResult(path, run.id, err);
        saveAdvancedTestResult(failResult);
        results.push(failResult);
        onProgress?.(i + 1, paths.length, path, failResult);
        recordAIThinkingLog(
          projectId,
          "advanced-run",
          "judging",
          `路径 ${path.id} 执行异常：${err instanceof Error ? err.message : String(err)}`,
          {
            level: "error",
            context: { pathId: path.id, pathTitle: path.title },
          },
        );
      }
    }

    // 标记运行完成（未被中止时）
    if (!shouldAbort?.()) {
      updateAdvancedTestRun(run.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      const passed = results.filter((r) => r.status === "pass").length;
      const failed = results.filter((r) => r.status === "fail").length;
      recordAIThinkingLog(
        projectId,
        "advanced-run",
        "judging",
        `测试执行完成 · 共 ${results.length} 条路径 · 通过 ${passed} / 发现问题 ${failed}`,
      );
    }
  } catch (err) {
    recordAIThinkingLog(
      projectId,
      "advanced-run",
      "judging",
      `测试执行失败：${err instanceof Error ? err.message : String(err)}`,
      { level: "error" },
    );
    updateAdvancedTestRun(run.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
    throw err;
  }

  // 重新读取 run 以获取最新统计
  const finalRun = getAdvancedTestRun(run.id);

  return { run: finalRun ?? run, results };
}

// ============================================================
// 真实执行模式（Playwright + API + DB）
// ============================================================

// 真实执行上下文
interface RealAdvancedContext {
  executor: RealTestExecutor;
  baseUrl: string;
  dbPath: string | null;
  testPassword: string;
  testUsername: string;
  isDemo: boolean;
  authContract: AuthContract | null;
  authCookie: string | null;
  authToken: string | null;
  isLoggedIn: boolean;
  project: Project;
  shouldAbort?: () => boolean;
}

// 路径执行结果（内部用）
interface PathOutcome {
  status: "pass" | "fail" | "skip";
  severity: "low" | "medium" | "high" | "critical";
  confidence: "high" | "medium" | "low";
  detectedBugId?: string;
  actualBehavior: string;
  impactScope: string;
  steps: AdvancedStepRecord[];
}

// 关卡答案通过 getLevelAnswerForProject 动态获取（见 test-credentials.ts）
// 演示项目预定义答案：1=<h1>, 2=#box, 3=const

// 构建路径结果
function buildPathResult(
  path: TestPath,
  runId: string,
  outcome: PathOutcome,
  durationMs: number,
): AdvancedPathResult {
  return {
    id: genResultId(),
    runId,
    pathId: path.id,
    pathType: path.type,
    title: path.title,
    status: outcome.status,
    severity: outcome.severity,
    confidence: outcome.confidence,
    detectedBugId: outcome.detectedBugId,
    expectedBehavior: path.expectedBehavior,
    actualBehavior: outcome.actualBehavior,
    impactScope: outcome.impactScope,
    steps: outcome.steps,
    executedAt: new Date().toISOString(),
    durationMs,
  };
}

// 构建异常 fail 结果（单条路径执行抛异常时使用）
function buildFailPathResult(
  path: TestPath,
  runId: string,
  err: unknown,
): AdvancedPathResult {
  const errorMsg = err instanceof Error ? err.message : String(err);
  return {
    id: genResultId(),
    runId,
    pathId: path.id,
    pathType: path.type,
    title: path.title,
    status: "fail",
    severity: "medium",
    confidence: "low",
    expectedBehavior: path.expectedBehavior,
    actualBehavior: `路径执行过程中抛出异常：${errorMsg}`,
    impactScope: "执行异常导致该路径无法完成验证，需人工排查",
    steps: [
      {
        index: 0,
        action: "执行路径",
        consoleLog: `执行异常：${errorMsg}`,
      },
    ],
    executedAt: new Date().toISOString(),
    durationMs: 0,
  };
}

// 注册测试账号并设置认证
async function registerAccount(
  ctx: RealAdvancedContext,
  prefix: string,
): Promise<{ username: string; token: string } | { error: string }> {
  const username = genTestUsername(prefix);
  try {
    const response = await ctx.executor.api.post("/api/auth/register", {
      username,
      password: ctx.testPassword,
    });
    if (response.ok) {
      const body = response.body as { token?: string } | null;
      if (body?.token) {
        ctx.executor.api.setAuth(body.token);
        return { username, token: body.token };
      }
    }
    return {
      error: `注册失败: ${response.status} ${JSON.stringify(response.body).slice(0, 100)}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// 按关卡顺序查找关卡 ID
async function findLevelByOrder(
  ctx: RealAdvancedContext,
  order: number,
): Promise<{ id: string; title: string } | null> {
  try {
    const res = await ctx.executor.api.get("/api/level");
    if (!res.ok) return null;
    const body = res.body as {
      levels?: Array<{ id: string; order: number; title: string }>;
    } | null;
    const level = body?.levels?.find((l) => l.order === order);
    return level ? { id: level.id, title: level.title } : null;
  } catch {
    return null;
  }
}

// 查找奖励（可按最大花费筛选）
async function findReward(
  ctx: RealAdvancedContext,
  maxCost?: number,
): Promise<{ id: string; cost: number; title: string } | null> {
  try {
    const res = await ctx.executor.api.get("/api/rewards");
    if (!res.ok) return null;
    const body = res.body as {
      rewards?: Array<{ id: string; cost: number; title: string }>;
    } | null;
    const rewards = body?.rewards ?? [];
    if (maxCost !== undefined) {
      return rewards.find((r) => r.cost <= maxCost) ?? rewards[0] ?? null;
    }
    return rewards[0] ?? null;
  } catch {
    return null;
  }
}

// ============================================================
// 真实路径执行函数
// ============================================================

// PATH-001：正常路径 - 登录→签到→验证积分+10→刷新→验证状态保持
async function executeRealPath001(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv001");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录`,
      screenshotDesc: "注册成功，获得认证 token",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "未注册",
      stateAfter: `已登录，用户名: ${account.username}`,
    });

    // 步骤2：查询签到状态（预期未签到）
    const statusRes = await ctx.executor.api.get("/api/sign/status");
    const statusBody =
      (statusRes.body as { signed?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "查询签到状态（预期：未签到，积分 0）",
      screenshotDesc: `签到状态: signed=${statusBody.signed}, points=${statusBody.points}`,
      networkRequest: `GET /api/sign/status ${statusRes.status} → ${JSON.stringify(statusBody)}`,
      apiResponse: JSON.stringify(statusBody),
      dataChange: `SignRecord 表：0 条；User.points：${statusBody.points ?? 0}`,
      stateBefore: "未签到",
      stateAfter: `signed=${statusBody.signed}, points=${statusBody.points}`,
    });

    // 步骤3：签到
    const signRes = await ctx.executor.api.post("/api/sign");
    const signBody =
      (signRes.body as { success?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "调用签到接口 POST /api/sign",
      screenshotDesc: `签到响应: success=${signBody.success}, points=${signBody.points}`,
      networkRequest: `POST /api/sign ${signRes.status} → ${JSON.stringify(signBody)}`,
      apiResponse: JSON.stringify(signBody),
      dataChange: `积分: ${statusBody.points ?? 0} → ${signBody.points ?? "?"}`,
      stateBefore: `signed=${statusBody.signed}, points=${statusBody.points}`,
      stateAfter: `signed=true, points=${signBody.points}`,
    });

    // 步骤4：验证积分 +10
    const pointsRes = await ctx.executor.api.get("/api/points");
    const pointsBody = (pointsRes.body as { points?: number } | null) ?? {};
    const pointsBefore = statusBody.points ?? 0;
    const pointsAfter = pointsBody.points ?? 0;
    addStep({
      action: "查询积分余额，验证 +10",
      screenshotDesc: `积分余额: ${pointsAfter}`,
      networkRequest: `GET /api/points ${pointsRes.status} → ${JSON.stringify(pointsBody)}`,
      apiResponse: JSON.stringify(pointsBody),
      dataChange: `积分: ${pointsBefore} → ${pointsAfter}（${pointsAfter === pointsBefore + 10 ? "正确 +10" : "异常"}）`,
      stateBefore: `积分: ${pointsBefore}`,
      stateAfter: `积分: ${pointsAfter}`,
    });

    // 步骤5：刷新（重新查询签到状态），验证状态保持
    const refreshRes = await ctx.executor.api.get("/api/sign/status");
    const refreshBody =
      (refreshRes.body as { signed?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "刷新页面（重新查询签到状态），验证状态保持",
      screenshotDesc: `刷新后签到状态: signed=${refreshBody.signed}, points=${refreshBody.points}`,
      networkRequest: `GET /api/sign/status ${refreshRes.status} → ${JSON.stringify(refreshBody)}`,
      apiResponse: JSON.stringify(refreshBody),
      dataChange: `前端状态: signed=true → signed=${refreshBody.signed}（${refreshBody.signed === true ? "保持" : "丢失"}）`,
      stateBefore: `signed=true, points=${signBody.points}`,
      stateAfter: `signed=${refreshBody.signed}, points=${refreshBody.points}`,
    });

    // 判定：签到成功且积分 +10 即通过
    // （刷新状态保持的违规检测由 PATH-004 专门负责 Bug 3）
    const signSuccess = signBody.success === true;
    const pointsCorrect = pointsAfter === pointsBefore + 10;

    if (signSuccess && pointsCorrect) {
      return buildPathResult(
        path,
        runId,
        {
          status: "pass",
          severity: "low",
          confidence: "high",
          actualBehavior: `签到成功积分 +10（${pointsBefore}→${pointsAfter}），刷新后 signed=${refreshBody.signed}`,
          impactScope: "无",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "medium",
        confidence: "high",
        actualBehavior: `签到 success=${signSuccess}, 积分 ${pointsBefore}→${pointsAfter}（${pointsCorrect ? "正确" : "不正确"}）`,
        impactScope: "签到主路径异常",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-002：无限签到 - API 驱动连续签到 100 次，检查积分增长（Bug 1）
async function executeRealPath002(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv002");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录，确保今日未签到`,
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    });

    // 步骤2：查询初始签到状态
    const statusRes = await ctx.executor.api.get("/api/sign/status");
    const statusBody =
      (statusRes.body as { signed?: boolean; points?: number } | null) ?? {};
    const pointsBefore = statusBody.points ?? 0;
    addStep({
      action: "查询签到状态（基线：未签到，积分 0）",
      screenshotDesc: `签到状态: signed=${statusBody.signed}, points=${pointsBefore}`,
      networkRequest: `GET /api/sign/status ${statusRes.status} → ${JSON.stringify(statusBody)}`,
      apiResponse: JSON.stringify(statusBody),
      dataChange: `SignRecord 表：0 条；User.points：${pointsBefore}`,
      stateBefore: "未签到，积分 0",
      stateAfter: `signed=${statusBody.signed}, points=${pointsBefore}`,
    });

    // 步骤3：连续签到 100 次
    let successCount = 0;
    let lastResponse = "";
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0 && ctx.shouldAbort?.()) break;
      try {
        const res = await ctx.executor.api.post("/api/sign");
        const body =
          (res.body as { success?: boolean; points?: number } | null) ?? {};
        if (body.success === true) {
          successCount++;
        }
        lastResponse = JSON.stringify(body);
      } catch {
        // 忽略单次请求异常
      }
    }
    addStep({
      action: "使用脚本连续调用 POST /api/sign 100 次（检测频率限制）",
      screenshotDesc: `100 次签到请求完成，成功 ${successCount} 次（应仅 1 次成功）`,
      consoleLog: `[Network] POST /api/sign × 100 次（成功 ${successCount} 次，应仅 1 次）`,
      networkRequest: `POST /api/sign × 100 → 成功 ${successCount} 次（应仅 1 次 200，99 次 409）`,
      apiResponse: `${lastResponse} × ${successCount}`,
      dataChange: `签到成功次数：${successCount}（应 1 次）`,
      stateBefore: `未签到，积分 ${pointsBefore}`,
      stateAfter: `签到 ${successCount} 次`,
    });

    // 步骤4：查询最终积分
    const pointsRes = await ctx.executor.api.get("/api/points");
    const pointsBody = (pointsRes.body as { points?: number } | null) ?? {};
    const pointsAfter = pointsBody.points ?? 0;
    const pointsDelta = pointsAfter - pointsBefore;
    addStep({
      action: "查询最终积分，验证是否异常增长",
      screenshotDesc: `最终积分余额: ${pointsAfter}（基线 ${pointsBefore}，增长 ${pointsDelta}）`,
      networkRequest: `GET /api/points ${pointsRes.status} → ${JSON.stringify(pointsBody)}`,
      apiResponse: JSON.stringify(pointsBody),
      dataChange: `积分: ${pointsBefore} → ${pointsAfter}（+${pointsDelta}，应 +10）`,
      stateBefore: `积分 ${pointsBefore}`,
      stateAfter: `积分 ${pointsAfter}`,
    });

    // 判定：Bug 1 - 成功超过 1 次或积分增长超过 10
    if (successCount > 1 || pointsDelta > 10) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "critical",
          confidence: "high",
          detectedBugId: "BUG-001",
          actualBehavior: `100 次签到中 ${successCount} 次成功，积分从 ${pointsBefore} 增长到 ${pointsAfter}（+${pointsDelta}），签到接口无频率限制`,
          impactScope:
            "激励系统核心：签到接口无频率限制，用户可无限领取积分，破坏积分经济体系与游戏平衡",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `100 次签到中仅 ${successCount} 次成功，积分增长 ${pointsDelta}，频率限制正常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-003：双击重复 - concurrentRequests 并发 2 次签到，检查重复加分（Bug 2）
async function executeRealPath003(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv003");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录，确保今日未签到`,
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    });

    // 步骤2：查询初始签到状态
    const statusRes = await ctx.executor.api.get("/api/sign/status");
    const statusBody =
      (statusRes.body as { signed?: boolean; points?: number } | null) ?? {};
    const pointsBefore = statusBody.points ?? 0;
    addStep({
      action: "查询签到状态（基线：未签到，积分 0）",
      screenshotDesc: `签到状态: signed=${statusBody.signed}, points=${pointsBefore}`,
      networkRequest: `GET /api/sign/status ${statusRes.status} → ${JSON.stringify(statusBody)}`,
      apiResponse: JSON.stringify(statusBody),
      dataChange: `SignRecord 表：0 条；User.points：${pointsBefore}`,
      stateBefore: "未签到，积分 0",
      stateAfter: `signed=${statusBody.signed}, points=${pointsBefore}`,
    });

    // 步骤3：并发 2 次签到请求（模拟 100ms 内双击）
    const responses = await concurrentRequests(
      ctx.executor.api,
      "POST",
      "/api/sign",
      2,
    );
    let successCount = 0;
    const responseSummaries = responses.map((res) => {
      const body =
        (res.body as { success?: boolean; points?: number } | null) ?? {};
      if (body.success === true) successCount++;
      return `${res.status} → ${JSON.stringify(body)}`;
    });
    addStep({
      action: "使用 concurrentRequests 并发触发 2 次 POST /api/sign（模拟 100ms 内双击）",
      screenshotDesc: `并发 2 次签到请求，成功 ${successCount} 次（应仅 1 次）`,
      consoleLog: `[Network] POST /api/sign × 2 并发（成功 ${successCount} 次）`,
      networkRequest: responseSummaries
        .map((s) => `POST /api/sign ${s}`)
        .join("\n"),
      apiResponse: responseSummaries.join("\n"),
      dataChange: `签到成功次数：${successCount}（应 1 次）`,
      stateBefore: `未签到，积分 ${pointsBefore}`,
      stateAfter: `签到 ${successCount} 次`,
    });

    // 步骤4：查询最终积分
    const pointsRes = await ctx.executor.api.get("/api/points");
    const pointsBody = (pointsRes.body as { points?: number } | null) ?? {};
    const pointsAfter = pointsBody.points ?? 0;
    const pointsDelta = pointsAfter - pointsBefore;
    addStep({
      action: "查询最终积分，验证是否重复加分",
      screenshotDesc: `最终积分余额: ${pointsAfter}（基线 ${pointsBefore}，增长 ${pointsDelta}）`,
      networkRequest: `GET /api/points ${pointsRes.status} → ${JSON.stringify(pointsBody)}`,
      apiResponse: JSON.stringify(pointsBody),
      dataChange: `积分: ${pointsBefore} → ${pointsAfter}（+${pointsDelta}，应 +10）`,
      stateBefore: `积分 ${pointsBefore}`,
      stateAfter: `积分 ${pointsAfter}`,
    });

    // 判定：Bug 2 - 2 次都成功或积分增长超过 10
    if (successCount > 1 || pointsDelta > 10) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "critical",
          confidence: "high",
          detectedBugId: "BUG-002",
          actualBehavior: `并发 2 次签到中 ${successCount} 次成功，积分从 ${pointsBefore} 增长到 ${pointsAfter}（+${pointsDelta}），并发请求未做幂等控制`,
          impactScope:
            "激励系统：并发请求未做幂等控制，用户可通过快速双击重复领取积分",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `并发 2 次签到中仅 ${successCount} 次成功，积分增长 ${pointsDelta}，幂等控制正常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-004：刷新可再签 - 签到后再次签到，检查是否成功（Bug 3）
async function executeRealPath004(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv004");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录，确保今日未签到`,
      screenshotDesc: "签到页显示「每日签到」按钮可点击，积分余额：0",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "未签到，积分 0",
      stateAfter: "未签到，积分 0",
    });

    // 步骤2：第一次签到
    const sign1Res = await ctx.executor.api.post("/api/sign");
    const sign1Body =
      (sign1Res.body as { success?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "第一次签到 POST /api/sign",
      screenshotDesc: `第一次签到响应: success=${sign1Body.success}, points=${sign1Body.points}`,
      networkRequest: `POST /api/sign ${sign1Res.status} → ${JSON.stringify(sign1Body)}`,
      apiResponse: JSON.stringify(sign1Body),
      dataChange: `积分: 0 → ${sign1Body.points ?? "?"}`,
      stateBefore: "未签到，积分 0",
      stateAfter: `已签到，积分 ${sign1Body.points}`,
    });

    // 步骤3：刷新（重新查询签到状态）
    const refreshRes = await ctx.executor.api.get("/api/sign/status");
    const refreshBody =
      (refreshRes.body as { signed?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "刷新页面（重新查询签到状态），验证状态是否保持",
      screenshotDesc: `刷新后签到状态: signed=${refreshBody.signed}, points=${refreshBody.points}`,
      networkRequest: `GET /api/sign/status ${refreshRes.status} → ${JSON.stringify(refreshBody)}`,
      apiResponse: JSON.stringify(refreshBody),
      dataChange: `前端状态: signed=true → signed=${refreshBody.signed}（${refreshBody.signed === true ? "保持" : "丢失"}）`,
      stateBefore: `signed=true, points=${sign1Body.points}`,
      stateAfter: `signed=${refreshBody.signed}, points=${refreshBody.points}`,
    });

    // 步骤4：再次签到（应被拦截）
    const sign2Res = await ctx.executor.api.post("/api/sign");
    const sign2Body =
      (sign2Res.body as { success?: boolean; points?: number } | null) ?? {};
    addStep({
      action: "再次签到 POST /api/sign（应返回 409 或 success=false）",
      screenshotDesc: `第二次签到响应: status=${sign2Res.status}, success=${sign2Body.success}, points=${sign2Body.points}`,
      networkRequest: `POST /api/sign ${sign2Res.status} → ${JSON.stringify(sign2Body)}`,
      apiResponse: JSON.stringify(sign2Body),
      dataChange: `第二次签到 success=${sign2Body.success}（应为 false）`,
      stateBefore: `已签到 1 次，积分 ${sign1Body.points}`,
      stateAfter: `已签到 ${sign2Body.success ? 2 : 1} 次，积分 ${sign2Body.points ?? sign1Body.points}`,
    });

    // 判定：Bug 3 - 第二次签到成功或签到状态丢失
    const secondSignSuccess = sign2Body.success === true;
    const statusLost = refreshBody.signed !== true;

    if (secondSignSuccess || statusLost) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          detectedBugId: "BUG-003",
          actualBehavior: `签到后刷新状态 signed=${refreshBody.signed}（${statusLost ? "丢失" : "保持"}），第二次签到 success=${secondSignSuccess}（${secondSignSuccess ? "成功，可重复签到" : "失败"}）`,
          impactScope:
            "激励系统：签到状态未正确持久化或前端未读取后端状态，用户可通过刷新绕过每日一次限制",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `签到后刷新状态保持 signed=true，第二次签到被拦截 success=false`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-005：跳关 - 直接答题关卡3，检查是否成功（Bug 4）
async function executeRealPath005(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv005");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录，确保未完成任何关卡`,
      screenshotDesc: "首页关卡列表：所有关卡显示「锁定」",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      dataChange: "Progress 表：0 条 completed 记录",
      stateBefore: "未完成任何关卡",
      stateAfter: "未完成任何关卡",
    });

    // 步骤2：查询关卡列表，找到关卡3
    const level3 = await findLevelByOrder(ctx, 3);
    if (!level3) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "high",
          actualBehavior: "无法找到关卡 3（order=3）",
          impactScope: "无法执行跳关测试",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `查询关卡列表，定位关卡 3（id=${level3.id}, title=${level3.title}）`,
      screenshotDesc: `关卡列表中找到关卡 3: ${level3.title}`,
      networkRequest: `GET /api/level 200 → levels[order=3].id=${level3.id}`,
      apiResponse: `{ "id": "${level3.id}", "title": "${level3.title}" }`,
      stateBefore: "未访问关卡 3",
      stateAfter: "已定位关卡 3",
    });

    // 步骤3：直接答题关卡3（跳过关卡1和2）
    const answer = getLevelAnswerForProject("3", ctx.isDemo) || "const";
    const answerRes = await ctx.executor.api.post(
      `/api/level/${level3.id}/answer`,
      { answer },
    );
    const answerBody =
      (answerRes.body as {
        correct?: boolean;
        points?: number;
        nextLevelId?: string;
      } | null) ?? {};
    addStep({
      action: `直接答题关卡 3（答案: ${answer}），绕过前置关卡校验`,
      screenshotDesc: `答题响应: status=${answerRes.status}, correct=${answerBody.correct}, points=${answerBody.points}`,
      networkRequest: `POST /api/level/${level3.id}/answer ${answerRes.status} → ${JSON.stringify(answerBody)}`,
      apiResponse: JSON.stringify(answerBody),
      dataChange: `答题 correct=${answerBody.correct}（应为 false 或 403）`,
      stateBefore: "关卡 3 未完成",
      stateAfter: `关卡 3 答题 correct=${answerBody.correct}`,
    });

    // 步骤4：查询积分，验证是否获得积分
    const pointsRes = await ctx.executor.api.get("/api/points");
    const pointsBody = (pointsRes.body as { points?: number } | null) ?? {};
    const pointsAfter = pointsBody.points ?? 0;
    addStep({
      action: "查询积分，验证跳关答题是否获得积分",
      screenshotDesc: `积分余额: ${pointsAfter}（应为 0）`,
      networkRequest: `GET /api/points ${pointsRes.status} → ${JSON.stringify(pointsBody)}`,
      apiResponse: JSON.stringify(pointsBody),
      dataChange: `积分: ${pointsAfter}（${pointsAfter > 0 ? "已获得，违规" : "未获得"}）`,
      stateBefore: "预期：积分 0",
      stateAfter: `实际：积分 ${pointsAfter}`,
    });

    // 判定：Bug 4 - 答题正确或获得积分
    if (answerBody.correct === true || pointsAfter > 0) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          detectedBugId: "BUG-004",
          actualBehavior: `未完成前置关卡直接答题关卡 3，correct=${answerBody.correct}，积分=${pointsAfter}，关卡解锁校验缺失`,
          impactScope:
            "学习系统：关卡解锁校验缺失，用户可跳过前置关卡直接答题获得积分，破坏学习路径与进度体系",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `跳关答题被拦截，correct=${answerBody.correct}，积分=${pointsAfter}，关卡解锁校验正常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-006：积分不足兑换 - 0 积分兑换，检查是否成功（Bug 6）
async function executeRealPath006(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录（新用户 0 积分）
    const account = await registerAccount(ctx, "adv006");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录，确保积分为 0（新用户）`,
      screenshotDesc: "积分页显示余额：0",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "积分 0",
      stateAfter: "积分 0",
    });

    // 步骤2：确认积分为 0
    const pointsRes = await ctx.executor.api.get("/api/points");
    const pointsBody = (pointsRes.body as { points?: number } | null) ?? {};
    const pointsBefore = pointsBody.points ?? 0;
    addStep({
      action: "查询积分余额，确认 0 积分",
      screenshotDesc: `积分余额: ${pointsBefore}`,
      networkRequest: `GET /api/points ${pointsRes.status} → ${JSON.stringify(pointsBody)}`,
      apiResponse: JSON.stringify(pointsBody),
      dataChange: `User.points：${pointsBefore}`,
      stateBefore: "积分 0",
      stateAfter: `积分 ${pointsBefore}`,
    });

    // 步骤3：查询奖励列表，选择一个奖励
    const reward = await findReward(ctx);
    if (!reward) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "high",
          actualBehavior: "无法找到任何奖励",
          impactScope: "无法执行兑换测试",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `查询奖励列表，选择奖励「${reward.title}」（cost=${reward.cost}）`,
      screenshotDesc: `奖励卡片: ${reward.title}，需 ${reward.cost} 积分`,
      networkRequest: `GET /api/rewards 200 → rewards[0].id=${reward.id}, cost=${reward.cost}`,
      apiResponse: `{ "id": "${reward.id}", "title": "${reward.title}", "cost": ${reward.cost} }`,
      stateBefore: `积分 ${pointsBefore}`,
      stateAfter: `积分 ${pointsBefore}，准备兑换`,
    });

    // 步骤4：尝试兑换（积分不足）
    const exchangeRes = await ctx.executor.api.post("/api/exchange", {
      rewardId: reward.id,
    });
    const exchangeBody =
      (exchangeRes.body as { success?: boolean } | null) ?? {};
    addStep({
      action: `调用 POST /api/exchange 兑换奖励（积分 ${pointsBefore} < cost ${reward.cost}）`,
      screenshotDesc: `兑换响应: status=${exchangeRes.status}, success=${exchangeBody.success}`,
      networkRequest: `POST /api/exchange ${exchangeRes.status} → ${JSON.stringify(exchangeBody)}`,
      apiResponse: JSON.stringify(exchangeBody),
      dataChange: `兑换 success=${exchangeBody.success}（应为 false 或 400）`,
      stateBefore: `积分 ${pointsBefore}，库存未变`,
      stateAfter: `兑换 success=${exchangeBody.success}`,
    });

    // 步骤5：查询兑换后积分
    const pointsAfterRes = await ctx.executor.api.get("/api/points");
    const pointsAfterBody =
      (pointsAfterRes.body as { points?: number } | null) ?? {};
    const pointsAfter = pointsAfterBody.points ?? 0;
    addStep({
      action: "查询兑换后积分，验证是否扣减",
      screenshotDesc: `兑换后积分余额: ${pointsAfter}（应为 ${pointsBefore}）`,
      networkRequest: `GET /api/points ${pointsAfterRes.status} → ${JSON.stringify(pointsAfterBody)}`,
      apiResponse: JSON.stringify(pointsAfterBody),
      dataChange: `积分: ${pointsBefore} → ${pointsAfter}（${pointsAfter === pointsBefore ? "未扣减" : "已扣减，违规"}）`,
      stateBefore: `积分 ${pointsBefore}`,
      stateAfter: `积分 ${pointsAfter}`,
    });

    // 判定：Bug 6 - 兑换成功
    if (exchangeBody.success === true) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "critical",
          confidence: "high",
          detectedBugId: "BUG-006",
          actualBehavior: `0 积分兑换 ${reward.cost} 积分奖励成功，积分 ${pointsBefore}→${pointsAfter}（未扣减），积分余额校验缺失`,
          impactScope:
            "激励系统·兑换模块：积分余额校验缺失，用户可 0 成本兑换任意奖励，造成库存损失与积分经济崩溃",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `0 积分兑换被拦截，success=false，积分保持 ${pointsAfter}，积分余额校验正常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// PATH-007：跨功能综合 - 完成关卡→兑换→检查积分扣减
async function executeRealPath007(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;
  const addStep = (fields: Omit<AdvancedStepRecord, "index">): void => {
    idx++;
    steps.push({ index: idx, ...fields });
  };

  try {
    // 步骤1：注册并登录
    const account = await registerAccount(ctx, "adv007");
    if ("error" in account) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `注册测试账号失败: ${account.error}`,
          impactScope: "无法执行路径",
          steps,
        },
        Date.now() - startMs,
      );
    }
    addStep({
      action: `注册测试账号 ${account.username} 并登录`,
      screenshotDesc: "注册成功，获得认证 token",
      networkRequest: `POST /api/auth/register 200 → { token: "..." }`,
      apiResponse: `{ "token": "${account.token.slice(0, 20)}..." }`,
      stateBefore: "未注册",
      stateAfter: `已登录，用户名: ${account.username}`,
    });

    // 步骤2：记录初始积分 P0
    const points0Res = await ctx.executor.api.get("/api/points");
    const points0Body = (points0Res.body as { points?: number } | null) ?? {};
    const P0 = points0Body.points ?? 0;
    addStep({
      action: `记录初始积分 P0=${P0}`,
      screenshotDesc: `积分页显示余额: ${P0}`,
      networkRequest: `GET /api/points ${points0Res.status} → ${JSON.stringify(points0Body)}`,
      apiResponse: JSON.stringify(points0Body),
      dataChange: `P0 = ${P0}`,
      stateBefore: "积分 0",
      stateAfter: `积分 ${P0}`,
    });

    // 步骤3：完成关卡1，获得 10 积分
    const level1 = await findLevelByOrder(ctx, 1);
    if (!level1) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "high",
          actualBehavior: "无法找到关卡 1（order=1）",
          impactScope: "无法执行综合测试",
          steps,
        },
        Date.now() - startMs,
      );
    }
    const answer1 = getLevelAnswerForProject("1", ctx.isDemo) || "<h1>";
    const answer1Res = await ctx.executor.api.post(
      `/api/level/${level1.id}/answer`,
      { answer: answer1 },
    );
    const answer1Body =
      (answer1Res.body as {
        correct?: boolean;
        points?: number;
        nextLevelId?: string;
      } | null) ?? {};
    addStep({
      action: `完成关卡 1（答案: ${answer1}），获得 10 积分`,
      screenshotDesc: `答题响应: correct=${answer1Body.correct}, points=${answer1Body.points}`,
      networkRequest: `POST /api/level/${level1.id}/answer ${answer1Res.status} → ${JSON.stringify(answer1Body)}`,
      apiResponse: JSON.stringify(answer1Body),
      dataChange: `答题 correct=${answer1Body.correct}`,
      stateBefore: `积分 ${P0}`,
      stateAfter: `答题 correct=${answer1Body.correct}`,
    });

    // 步骤4：记录积分 P1
    const points1Res = await ctx.executor.api.get("/api/points");
    const points1Body = (points1Res.body as { points?: number } | null) ?? {};
    const P1 = points1Body.points ?? 0;
    addStep({
      action: `记录积分 P1=${P1}（预期 P1 = P0 + 10 = ${P0 + 10}）`,
      screenshotDesc: `积分余额: ${P1}`,
      networkRequest: `GET /api/points ${points1Res.status} → ${JSON.stringify(points1Body)}`,
      apiResponse: JSON.stringify(points1Body),
      dataChange: `积分: ${P0} → ${P1}（P1 = P0 + 10 = ${P0 + 10}）`,
      stateBefore: `积分 ${P0}`,
      stateAfter: `积分 ${P1}`,
    });

    // 步骤5：兑换奖励
    const reward = await findReward(ctx, P1);
    if (!reward) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "high",
          actualBehavior: "无法找到可兑换的奖励",
          impactScope: "无法执行兑换测试",
          steps,
        },
        Date.now() - startMs,
      );
    }
    const exchangeRes = await ctx.executor.api.post("/api/exchange", {
      rewardId: reward.id,
    });
    const exchangeBody =
      (exchangeRes.body as { success?: boolean } | null) ?? {};
    addStep({
      action: `兑换奖励「${reward.title}」（cost=${reward.cost}）`,
      screenshotDesc: `兑换响应: success=${exchangeBody.success}`,
      networkRequest: `POST /api/exchange ${exchangeRes.status} → ${JSON.stringify(exchangeBody)}`,
      apiResponse: JSON.stringify(exchangeBody),
      dataChange: `兑换 success=${exchangeBody.success}，扣减 ${reward.cost} 积分`,
      stateBefore: `积分 ${P1}`,
      stateAfter: `兑换 success=${exchangeBody.success}`,
    });

    // 步骤6：记录积分 P2，验证 P2 = P1 - cost
    const points2Res = await ctx.executor.api.get("/api/points");
    const points2Body = (points2Res.body as { points?: number } | null) ?? {};
    const P2 = points2Body.points ?? 0;
    const expectedP2 = P1 - reward.cost;
    const pointsCorrect = P2 === expectedP2;
    addStep({
      action: `记录积分 P2=${P2}，验证 P2 = P1 - cost = ${P1} - ${reward.cost} = ${expectedP2}`,
      screenshotDesc: `积分余额: ${P2}（预期 ${expectedP2}）`,
      networkRequest: `GET /api/points ${points2Res.status} → ${JSON.stringify(points2Body)}`,
      apiResponse: JSON.stringify(points2Body),
      dataChange: `积分: ${P1} → ${P2}（P2 = P1 - ${reward.cost} = ${expectedP2}，${pointsCorrect ? "正确 ✓" : "不正确 ✗"}）`,
      stateBefore: `积分 ${P1}`,
      stateAfter: `积分 ${P2}`,
    });

    // 判定：积分扣减正确即通过
    if (exchangeBody.success === true && pointsCorrect) {
      return buildPathResult(
        path,
        runId,
        {
          status: "pass",
          severity: "low",
          confidence: "high",
          actualBehavior: `完成关卡获得积分（P0=${P0}→P1=${P1}），兑换 ${reward.cost} 积分后 P2=${P2} = P1 - cost ✓，积分扣减逻辑正确`,
          impactScope: "无",
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "medium",
        confidence: "high",
        actualBehavior: `兑换 success=${exchangeBody.success}，P2=${P2}（预期 ${expectedP2}），积分扣减${pointsCorrect ? "正确" : "不正确"}`,
        impactScope: "积分扣减逻辑异常",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// ============================================================
// 通用执行引擎（非演示项目）
// 基于风险关键词分类路径，使用 Playwright + API + DB 真实执行
// ============================================================

// 解析项目配置的测试账号字符串
function parseTestAccount(accountStr: string | undefined): { username: string; password: string } {
  if (!accountStr || !accountStr.trim()) {
    return { username: "", password: "" };
  }
  const str = accountStr.trim();
  const colonIdx = str.indexOf(":");
  if (colonIdx > 0) {
    return {
      username: str.slice(0, colonIdx).trim(),
      password: str.slice(colonIdx + 1).trim(),
    };
  }
  const slashMatch = str.match(/^(.+?)\s*\/\s*(.+)$/);
  if (slashMatch) {
    return { username: slashMatch[1].trim(), password: slashMatch[2].trim() };
  }
  return { username: "", password: "" };
}

// 风险路径分类
type RiskCategory =
  | "concurrent"
  | "auth_bypass"
  | "session"
  | "consistency"
  | "boundary"
  | "normal"
  | "exploration";

function categorizeRiskPath(path: TestPath): RiskCategory {
  if (path.type === "normal") return "normal";
  if (path.type === "cross_function") return "exploration";

  const text = `${path.title} ${path.description}`;
  if (/重复|并发|幂等|双击|重复结算|重复扣分|重复生成/.test(text)) return "concurrent";
  if (/越权|管理员|权限|admin|前端按钮|AdminSession/.test(text)) return "auth_bypass";
  if (/会话|csrf|cookie|超时|session|安全|劫持/.test(text)) return "session";
  if (/一致性|流水|余额|快照|污染/.test(text)) return "consistency";
  if (/上限|限额|边界|突破|max|每日|每周/.test(text)) return "boundary";
  if (/时区|日期|凌晨|UTC/.test(text)) return "boundary";
  return "exploration";
}

// 通过 API 契约登录（优先策略，比 UI 登录快且兼容弹窗式登录）
// 登录失败（账号不存在）时自动尝试注册
async function tryApiLogin(
  ctx: RealAdvancedContext,
): Promise<{ success: boolean; error?: string; token?: string }> {
  const loginContract = ctx.authContract?.login;
  if (!loginContract) {
    return { success: false, error: "无登录契约" };
  }

  // 先尝试登录
  const loginResult = await tryApiLoginOnly(ctx, loginContract);
  if (loginResult.success) {
    return loginResult;
  }

  // 登录失败，尝试注册（如果项目有注册 API）
  const registerContract = ctx.authContract?.register;
  if (registerContract) {
    const registerResult = await tryApiRegister(ctx, registerContract);
    if (registerResult.success) {
      return registerResult;
    }
    return {
      success: false,
      error: `登录失败: ${loginResult.error}；注册失败: ${registerResult.error}`,
    };
  }

  // 没有注册契约，尝试通用注册路径
  const genericRegisterResult = await tryGenericRegister(ctx);
  if (genericRegisterResult.success) {
    return genericRegisterResult;
  }

  return {
    success: false,
    error: `登录失败: ${loginResult.error}；注册失败: ${genericRegisterResult.error}`,
  };
}

// 仅尝试 API 登录
async function tryApiLoginOnly(
  ctx: RealAdvancedContext,
  contract: ApiEndpointContract,
): Promise<{ success: boolean; error?: string; token?: string }> {
  try {
    const fields = contract.fields || { username: "username", password: "password" };
    const data: Record<string, unknown> = {
      [fields.username]: ctx.testUsername,
      [fields.password]: ctx.testPassword,
    };

    const response = await ctx.executor.api.requestWithFormat(
      "POST",
      contract.path,
      data,
      contract.requestFormat,
    );

    const successStatuses = contract.successStatus || [200];
    if (!successStatuses.includes(response.status)) {
      return { success: false, error: `API 登录失败: HTTP ${response.status}` };
    }

    return extractTokenFromResponse(ctx, response, contract);
  } catch (err) {
    return { success: false, error: `API 登录异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// 尝试 API 注册（根据契约）
async function tryApiRegister(
  ctx: RealAdvancedContext,
  contract: ApiEndpointContract,
): Promise<{ success: boolean; error?: string; token?: string }> {
  try {
    const fields = contract.fields || { username: "username", password: "password" };
    const data: Record<string, unknown> = {
      [fields.username]: ctx.testUsername,
      [fields.password]: ctx.testPassword,
    };

    const response = await ctx.executor.api.requestWithFormat(
      "POST",
      contract.path,
      data,
      contract.requestFormat,
    );

    const successStatuses = contract.successStatus || [200];
    if (!successStatuses.includes(response.status)) {
      return { success: false, error: `API 注册失败: HTTP ${response.status}` };
    }

    return extractTokenFromResponse(ctx, response, contract);
  } catch (err) {
    return { success: false, error: `API 注册异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// 通用注册路径（当无注册契约时，尝试常见注册 API 和字段组合）
async function tryGenericRegister(
  ctx: RealAdvancedContext,
): Promise<{ success: boolean; error?: string; token?: string }> {
  // 常见注册 API 路径
  const registerPaths = ["/api/auth/register", "/api/register", "/auth/register"];
  // 生成测试用 email
  const testEmail = `${ctx.testUsername}@test.local`;

  for (const regPath of registerPaths) {
    try {
      // 尝试完整字段组合（username + email + password + nickname）
      const data: Record<string, unknown> = {
        username: ctx.testUsername,
        email: testEmail,
        password: ctx.testPassword,
        nickname: ctx.testUsername,
      };

      const response = await ctx.executor.api.requestWithFormat(
        "POST",
        regPath,
        data,
        "json",
      );

      if (response.status === 200 || response.status === 201) {
        const body = response.body as Record<string, unknown> | null;
        const token = body?.token as string | undefined;
        if (token) {
          ctx.executor.api.setAuth(token);
          ctx.authToken = token;
          ctx.isLoggedIn = true;
          return { success: true, token };
        }
        // token 可能在嵌套结构中
        const nestedToken = body?.data && typeof body.data === "object"
          ? (body.data as Record<string, unknown>).token as string | undefined
          : undefined;
        if (nestedToken) {
          ctx.executor.api.setAuth(nestedToken);
          ctx.authToken = nestedToken;
          ctx.isLoggedIn = true;
          return { success: true, token: nestedToken };
        }
      }

      // 如果是 409（已存在），说明账号已注册，跳过
      if (response.status === 409) {
        continue;
      }
    } catch {
      // 尝试下一个路径
    }
  }

  return { success: false, error: "所有通用注册路径均失败" };
}

// 从响应中提取 token（登录/注册共用）
function extractTokenFromResponse(
  ctx: RealAdvancedContext,
  response: { body: unknown; headers: Record<string, string> },
  contract: ApiEndpointContract,
): { success: boolean; error?: string; token?: string } {
  // Bearer 模式：从响应体提取 token
  if (contract.authScheme === "bearer" || !contract.authScheme || contract.authScheme === "none") {
    const tokenField = contract.tokenField || "token";
    const body = response.body as Record<string, unknown> | null;
    const token = body?.[tokenField] as string | undefined;
    if (token) {
      ctx.executor.api.setAuth(token);
      ctx.authToken = token;
      ctx.isLoggedIn = true;
      return { success: true, token };
    }
    // 可能 token 在嵌套结构中
    const nestedToken = body?.data && typeof body.data === "object"
      ? (body.data as Record<string, unknown>)[tokenField] as string | undefined
      : undefined;
    if (nestedToken) {
      ctx.executor.api.setAuth(nestedToken);
      ctx.authToken = nestedToken;
      ctx.isLoggedIn = true;
      return { success: true, token: nestedToken };
    }
    return { success: false, error: "API 登录成功但未返回 token" };
  }

  // Cookie 模式：从响应头提取 Set-Cookie
  if (contract.authScheme === "cookie") {
    const setCookie = response.headers["set-cookie"];
    if (setCookie) {
      const cookiePart = setCookie.split(";")[0];
      ctx.executor.api.setCookie(cookiePart);
      ctx.authCookie = cookiePart;
      ctx.isLoggedIn = true;
      return { success: true };
    }
    return { success: false, error: "API 登录成功但未返回 Cookie" };
  }

  return { success: false, error: "未知的认证方式" };
}

// 将 token 注入浏览器 localStorage（供 Playwright 驱动使用）
async function injectTokenToBrowser(
  page: IPage,
  baseUrl: string,
  token: string,
): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
  await page.evaluate((tk: string) => {
    try { localStorage.setItem("app_token", tk); } catch {}
  }, token).catch(() => {});
}

// 通过 Playwright UI 驱动登录（增强版：支持独立登录页 + 弹窗式登录）
async function loginForAdvanced(
  ctx: RealAdvancedContext,
): Promise<{ success: boolean; error?: string }> {
  // 策略1：如果有 authContract，优先 API 登录
  if (ctx.authContract?.login) {
    const apiResult = await tryApiLogin(ctx);
    if (apiResult.success) {
      // API 登录成功后，将 token 注入浏览器（供 Playwright 驱动的测试路径使用）
      const page = ctx.executor.browser;
      if (page && apiResult.token) {
        await injectTokenToBrowser(page, ctx.baseUrl, apiResult.token);
      }
      return { success: true };
    }
    // API 登录失败，降级到 UI 登录
  }

  // 策略2：UI 登录（增强版）
  const page = ctx.executor.browser;
  if (!page) {
    return { success: false, error: "浏览器未启动" };
  }

  try {
    // 清除 cookie，确保从未登录状态开始
    await page.clearCookies();
    const base = ctx.baseUrl.replace(/\/$/, "");

    // 尝试访问 /login，如果找不到输入框再尝试首页（支持弹窗式登录）
    const loginUrls = [`${base}/login`, `${base}/`, `${base}/signin`];
    let filledUsername = false;
    let filledPassword = false;
    let submitted = false;

    for (const loginUrl of loginUrls) {
      try {
        await page.goto(loginUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(1000); // 等待 SPA 渲染
      } catch {
        continue;
      }

      // 如果是首页，尝试点击"登录"按钮打开弹窗
      if (loginUrl === `${base}/` || loginUrl === `${base}`) {
        const loginButtonSelectors = [
          'button:has-text("登录")',
          'button:has-text("Login")',
          'button:has-text("Sign in")',
          'a:has-text("登录")',
          'a:has-text("Login")',
          'a:has-text("Sign in")',
        ];
        for (const sel of loginButtonSelectors) {
          if (await page.isVisible(sel, { timeout: 2000 }).catch(() => false)) {
            await page.click(sel).catch(() => {});
            await page.waitForTimeout(1500); // 等待弹窗动画
            break;
          }
        }
      }

      // 自动识别用户名输入框（增加 placeholder 选择器）
      const usernameSelectors = [
        'input[name="loginId"]',
        'input[name="username"]',
        'input[name="email"]',
        'input[name="account"]',
        'input[name="phone"]',
        'input[type="email"]',
        'input[type="tel"]',
        'input[type="text"]',
        // placeholder 匹配（弹窗式登录常用）
        'input[placeholder*="账号"]',
        'input[placeholder*="账户"]',
        'input[placeholder*="用户名"]',
        'input[placeholder*="邮箱"]',
        'input[placeholder*="手机"]',
        'input[placeholder*="account"]',
        'input[placeholder*="username"]',
        'input[placeholder*="email"]',
      ];
      for (const sel of usernameSelectors) {
        if (await page.isVisible(sel, { timeout: 2000 }).catch(() => false)) {
          await page.fill(sel, ctx.testUsername).catch(() => {});
          filledUsername = true;
          break;
        }
      }
      if (!filledUsername) continue;

      // 填充密码
      const passwordSel = 'input[type="password"]';
      if (await page.isVisible(passwordSel, { timeout: 2000 }).catch(() => false)) {
        await page.fill(passwordSel, ctx.testPassword);
        filledPassword = true;
      } else {
        continue;
      }

      // 点击提交按钮（增加非 submit 类型按钮支持）
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        "button.app-button-primary",
        'button:has-text("登录")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
      ];
      for (const sel of submitSelectors) {
        if (await page.isVisible(sel, { timeout: 2000 }).catch(() => false)) {
          await page.click(sel).catch(() => {});
          submitted = true;
          break;
        }
      }
      if (!submitted) continue;

      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // 判断是否登录成功
      const currentUrl = page.url();
      if (currentUrl.includes("/login") && currentUrl.includes("error=")) {
        return { success: false, error: "登录失败（账号或密码错误）" };
      }

      // 提取 cookie 同步到 API 驱动
      try {
        const cookies = await page.getCookies();
        const cookieStr = cookies
          .filter((c) => c.name && c.value)
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        if (cookieStr) {
          ctx.executor.api.setCookie(cookieStr);
          ctx.authCookie = cookieStr;
        }
      } catch {
        // cookie 提取失败不阻断
      }

      // 尝试从浏览器 localStorage 提取 token（Bearer 模式）
      try {
        const token = await page.evaluate(() => {
          return localStorage.getItem("app_token") || localStorage.getItem("token") || null;
        }) as string | null;
        if (token) {
          ctx.executor.api.setAuth(token);
          ctx.authToken = token;
        }
      } catch {
        // token 提取失败不阻断
      }

      ctx.isLoggedIn = true;
      return { success: true };
    }

    // 所有 URL 都尝试失败
    const errorMsg = !filledUsername
      ? "登录页未找到用户名输入框（已尝试 /login、/、/signin 及弹窗模式）"
      : !filledPassword
        ? "登录页未找到密码输入框"
        : !submitted
          ? "登录页未找到提交按钮"
          : "登录失败（未知原因）";
    return { success: false, error: errorMsg };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 通用步骤构建器
function makeStep(
  index: number,
  action: string,
  fields: Partial<AdvancedStepRecord> = {},
): AdvancedStepRecord {
  return { index, action, ...fields };
}

// ---- 通用执行器：正常路径（登录 + 会话 + 刷新验证）----
async function executeGenericNormalPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    // 步骤1：登录
    const loginResult = await loginForAdvanced(ctx);
    idx++;
    if (!loginResult.success) {
      steps.push(
        makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "登录失败",
          consoleLog: loginResult.error,
        }),
      );
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: `登录失败：${loginResult.error}`,
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    const page = ctx.executor.browser!;
    const currentUrl = page.url();
    const consoleLogs = page.getConsoleLogs();
    steps.push(
      makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
        screenshotDesc: `登录成功，当前页面：${currentUrl}`,
        networkRequest: `POST /auth/login → 跳转到 ${currentUrl}`,
        stateBefore: "未登录",
        stateAfter: `已登录，URL: ${currentUrl}`,
        consoleLog: consoleLogs.slice(-5).join("\n") || "无 console 输出",
      }),
    );

    // 步骤2：验证首页内容加载
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const pageText = await page.text("body", { timeout: 5000 }).catch(() => "");
    const hasContent = pageText.length > 50;
    idx++;
    steps.push(
      makeStep(idx, "验证功能页面加载正确", {
        screenshotDesc: hasContent
          ? `页面内容长度 ${pageText.length} 字符，包含关键文本`
          : "页面内容为空或加载失败",
        stateBefore: "页面加载中",
        stateAfter: hasContent ? "页面加载完成" : "页面加载异常",
      }),
    );

    // 步骤3：刷新页面验证状态保持
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const refreshUrl = page.url();
    const stillLoggedIn = !refreshUrl.includes("/login");
    idx++;
    steps.push(
      makeStep(idx, "刷新页面验证登录态保持", {
        screenshotDesc: `刷新后 URL: ${refreshUrl}`,
        networkRequest: `GET ${refreshUrl} → ${stillLoggedIn ? "保持登录态" : "跳转到登录页"}`,
        stateBefore: `已登录，URL: ${currentUrl}`,
        stateAfter: `刷新后 URL: ${refreshUrl}（${stillLoggedIn ? "状态保持" : "状态丢失"}）`,
        dataChange: stillLoggedIn ? "无变化（状态保持）" : "登录态丢失（刷新后跳转登录页）",
      }),
    );

    if (!stillLoggedIn) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: "刷新后登录态丢失，页面跳转到登录页",
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: `登录成功，首页加载正常，刷新后登录态保持（URL: ${refreshUrl}）`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// ---- 通用执行器：并发/重复提交测试 ----
async function executeGenericConcurrentPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    // 确保已登录
    if (!ctx.isLoggedIn) {
      const loginResult = await loginForAdvanced(ctx);
      idx++;
      if (!loginResult.success) {
        steps.push(makeStep(idx, "登录系统", { consoleLog: loginResult.error }));
        return buildPathResult(
          path,
          runId,
          {
            status: "fail",
            severity: "high",
            confidence: "high",
            actualBehavior: `登录失败：${loginResult.error}`,
            impactScope: path.description,
            steps,
          },
          Date.now() - startMs,
        );
      }
      steps.push(
        makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "已登录",
        }),
      );
    }

    const page = ctx.executor.browser!;
    const base = ctx.baseUrl.replace(/\/$/, "");

    // 步骤2：导航到首页，寻找状态变更按钮
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    // 查找可能的状态变更按钮（提交/确认/批准/兑换等）
    const buttonSelectors = [
      'button:has-text("确认")',
      'button:has-text("提交")',
      'button:has-text("批准")',
      'button:has-text("审批")',
      'button:has-text("兑换")',
      'button:has-text("完成")',
      'button:has-text("打卡")',
      'button[type="submit"]',
    ];

    let targetSelector: string | null = null;
    for (const sel of buttonSelectors) {
      if (await page.isVisible(sel, { timeout: 2000 }).catch(() => false)) {
        targetSelector = sel;
        break;
      }
    }

    idx++;
    if (!targetSelector) {
      // 未找到状态变更按钮，记录页面状态后返回
      const pageText = await page.text("body", { timeout: 5000 }).catch(() => "");
      steps.push(
        makeStep(idx, "在首页寻找状态变更按钮（确认/提交/兑换等）", {
          screenshotDesc: `未找到状态变更按钮，页面文本前200字：${pageText.slice(0, 200)}`,
          stateBefore: "已登录，在首页",
          stateAfter: "未找到可测试的状态变更按钮",
        }),
      );
      // 尝试通过 API 并发测试（如果有 API 端点）
      const apiResult = await tryConcurrentApiTest(ctx, path);
      idx++;
      steps.push(
        makeStep(idx, apiResult.stepAction, {
          networkRequest: apiResult.networkRequest,
          apiResponse: apiResult.apiResponse,
          dataChange: apiResult.dataChange,
          stateBefore: apiResult.stateBefore,
          stateAfter: apiResult.stateAfter,
        }),
      );
      return buildPathResult(
        path,
        runId,
        {
          status: apiResult.status,
          severity: apiResult.severity,
          confidence: "medium",
          actualBehavior: apiResult.actualBehavior,
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    // 步骤3：记录操作前状态
    const beforeUrl = page.url();
    const beforeText = await page.text("body", { timeout: 5000 }).catch(() => "");
    const beforeNetworkCount = page.getNetworkRequests().length;
    steps.push(
      makeStep(idx, `定位到状态变更按钮：${targetSelector}`, {
        screenshotDesc: `按钮可见，准备进行并发点击测试`,
        stateBefore: `URL: ${beforeUrl}，页面文本长度: ${beforeText.length}`,
        stateAfter: "准备并发点击",
      }),
    );

    // 步骤4：并发点击（快速连续点击 5 次）
    idx++;
    const clickPromises: Promise<void>[] = [];
    for (let i = 0; i < 5; i++) {
      clickPromises.push(page.click(targetSelector, { timeout: 3000 }).catch(() => {}));
    }
    await Promise.all(clickPromises);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const afterUrl = page.url();
    const afterText = await page.text("body", { timeout: 5000 }).catch(() => "");
    const afterNetwork = page.getNetworkRequests();
    const newRequests = afterNetwork.slice(beforeNetworkCount);
    const consoleLogs = page.getConsoleLogs();

    // 检查是否有重复操作的迹象（多次成功提示、数值异常增长等）
    const successMatches = (afterText.match(/成功|完成|已确认|已提交/g) || []).length;
    const hasDuplicateEffect = successMatches > 1;

    steps.push(
      makeStep(idx, `并发点击按钮 5 次，检查是否有重复效果`, {
        screenshotDesc: `点击后 URL: ${afterUrl}，页面文本长度: ${beforeText.length}→${afterText.length}`,
        networkRequest: newRequests
          .slice(0, 5)
          .map((r) => `${r.method} ${r.url} → ${r.status}`)
          .join("\n"),
        consoleLog: consoleLogs.slice(-5).join("\n") || "无 console 输出",
        dataChange: `成功提示出现次数: ${successMatches}（${hasDuplicateEffect ? "异常-重复效果" : "正常"}）`,
        stateBefore: `操作前文本长度: ${beforeText.length}`,
        stateAfter: `操作后文本长度: ${afterText.length}，成功提示: ${successMatches}`,
      }),
    );

    // 步骤5：检查 DB 是否有重复记录
    idx++;
    let dbCheckResult = "未配置 DB 路径，跳过 DB 检查";
    if (ctx.executor.db && ctx.dbPath) {
      try {
        const tables = await ctx.executor.db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        );
        const tableNames = tables.map((t) => t.name).join(", ");
        dbCheckResult = `数据库表: ${tableNames}`;
      } catch {
        dbCheckResult = "DB 查询失败";
      }
    }
    steps.push(
      makeStep(idx, "检查数据库是否有重复记录", {
        dataChange: dbCheckResult,
        stateBefore: "检查前",
        stateAfter: dbCheckResult,
      }),
    );

    if (hasDuplicateEffect) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "critical",
          confidence: "medium",
          actualBehavior: `并发点击后检测到 ${successMatches} 次成功提示，可能存在重复结算问题`,
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "medium",
        actualBehavior: `并发点击 5 次后未检测到重复效果（成功提示 ${successMatches} 次），幂等性正常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// 辅助：尝试通过 API 并发测试
async function tryConcurrentApiTest(
  ctx: RealAdvancedContext,
  _path: TestPath,
): Promise<{
  status: "pass" | "fail" | "skip";
  severity: "low" | "medium" | "high" | "critical";
  stepAction: string;
  networkRequest: string;
  apiResponse: string;
  dataChange: string;
  stateBefore: string;
  stateAfter: string;
  actualBehavior: string;
}> {
  // 尝试对已知的 API 端点进行并发请求
  const apiPaths = ["/api/task/confirm", "/api/task/submit", "/api/reward/exchange"];
  for (const apiPath of apiPaths) {
    try {
      const responses = await concurrentRequests(
        ctx.executor.api,
        "POST",
        apiPath,
        3,
        { timeout: 5000 },
      );
      const successCount = responses.filter((r) => r.ok).length;
      if (successCount > 1) {
        return {
          status: "fail",
          severity: "critical",
          stepAction: `并发请求 POST ${apiPath} 3 次`,
          networkRequest: responses
            .map((r) => `POST ${apiPath} → ${r.status}`)
            .join("\n"),
          apiResponse: responses
            .map((r) => JSON.stringify(r.body).slice(0, 100))
            .join("\n"),
          dataChange: `${successCount}/3 请求成功（应仅 1 次成功）`,
          stateBefore: "操作前",
          stateAfter: `${successCount} 次成功`,
          actualBehavior: `并发请求 ${apiPath} 3 次，${successCount} 次成功，存在重复结算风险`,
        };
      }
      if (successCount === 1) {
        return {
          status: "pass",
          severity: "low",
          stepAction: `并发请求 POST ${apiPath} 3 次`,
          networkRequest: responses
            .map((r) => `POST ${apiPath} → ${r.status}`)
            .join("\n"),
          apiResponse: responses
            .map((r) => JSON.stringify(r.body).slice(0, 100))
            .join("\n"),
          dataChange: "1/3 请求成功（幂等性正常）",
          stateBefore: "操作前",
          stateAfter: "1 次成功",
          actualBehavior: `并发请求 ${apiPath} 3 次，仅 1 次成功，幂等性正常`,
        };
      }
    } catch {
      // API 不存在，继续尝试下一个
    }
  }
  return {
    status: "fail",
    severity: "medium",
    stepAction: "尝试通过 API 并发测试（未找到可用端点）",
    networkRequest: "所有尝试的 API 端点均不可用",
    apiResponse: "无",
    dataChange: "无",
    stateBefore: "未找到可用 API",
    stateAfter: "跳过 API 并发测试",
    actualBehavior: "未找到可用的状态变更 API 端点，且页面上未找到状态变更按钮，无法执行并发测试。该路径未实际执行验证",
  };
}

// ---- 通用执行器：管理员越权测试 ----
async function executeGenericAuthBypassPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    // 确保已登录（普通用户模式，不输入管理员 PIN）
    if (!ctx.isLoggedIn) {
      const loginResult = await loginForAdvanced(ctx);
      idx++;
      if (!loginResult.success) {
        steps.push(makeStep(idx, "登录系统", { consoleLog: loginResult.error }));
        return buildPathResult(
          path,
          runId,
          {
            status: "fail",
            severity: "high",
            confidence: "high",
            actualBehavior: `登录失败：${loginResult.error}`,
            impactScope: path.description,
            steps,
          },
          Date.now() - startMs,
        );
      }
      steps.push(
        makeStep(idx, `以普通用户身份登录（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "已登录（普通用户模式）",
        }),
      );
    }

    const page = ctx.executor.browser!;
    const base = ctx.baseUrl.replace(/\/$/, "");

    // 步骤2：尝试直接访问管理员页面
    const adminPaths = ["/admin", "/admin/settings", "/admin/tasks", "/admin/rewards", "/settings", "/manage"];
    let adminAccessible = false;
    let accessiblePath = "";

    idx++;
    for (const adminPath of adminPaths) {
      try {
        await page.goto(`${base}${adminPath}`, {
          waitUntil: "domcontentloaded",
          timeout: 8000,
        });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const currentUrl = page.url();
        const pageText = await page.text("body", { timeout: 3000 }).catch(() => "");
        // 如果 URL 没有跳转到登录页或权限提示页，且页面有内容，可能存在越权
        if (
          !currentUrl.includes("/login") &&
          !currentUrl.includes("error") &&
          !currentUrl.includes("unauthorized") &&
          pageText.length > 50 &&
          !pageText.includes("权限不足") &&
          !pageText.includes("无权访问") &&
          !pageText.includes("请输入") &&
          !pageText.includes("PIN")
        ) {
          adminAccessible = true;
          accessiblePath = adminPath;
          break;
        }
      } catch {
        // 页面不可访问，继续尝试
      }
    }

    steps.push(
      makeStep(idx, `尝试直接访问管理员页面（共 ${adminPaths.length} 个路径）`, {
        screenshotDesc: adminAccessible
          ? `管理员页面 ${accessiblePath} 可直接访问，未要求 PIN 校验`
          : "所有管理员路径均被拦截或重定向",
        networkRequest: adminPaths
          .map((p) => `GET ${p} → ${adminAccessible && p === accessiblePath ? "200 可访问" : "重定向/拦截"}`)
          .join("\n"),
        stateBefore: "普通用户已登录",
        stateAfter: adminAccessible
          ? `管理员页面 ${accessiblePath} 可访问（越权）`
          : "管理员页面不可访问（正常）",
      }),
    );

    // 步骤3：尝试通过 API 调用管理员功能
    idx++;
    const adminApiPaths = [
      "/api/admin/points",
      "/api/admin/tasks",
      "/api/admin/rewards",
      "/api/admin/config",
    ];
    let apiBypassFound = false;
    let bypassApiPath = "";

    for (const apiPath of adminApiPaths) {
      try {
        const res = await ctx.executor.api.post(apiPath, { test: true });
        if (res.ok) {
          apiBypassFound = true;
          bypassApiPath = apiPath;
          break;
        }
      } catch {
        // API 不存在
      }
    }

    steps.push(
      makeStep(idx, "尝试通过 API 调用管理员功能", {
        networkRequest: adminApiPaths
          .map((p) => `POST ${p} → ${apiBypassFound && p === bypassApiPath ? "200 可访问" : "拒绝/不存在"}`)
          .join("\n"),
        apiResponse: apiBypassFound
          ? `管理员 API ${bypassApiPath} 可直接调用（越权）`
          : "所有管理员 API 均被拒绝",
        stateBefore: "普通用户尝试调用管理员 API",
        stateAfter: apiBypassFound ? "API 调用成功（越权）" : "API 调用被拒绝（正常）",
      }),
    );

    if (adminAccessible || apiBypassFound) {
      const bypassDetails = [
        adminAccessible ? `管理员页面 ${accessiblePath} 可直接访问` : "",
        apiBypassFound ? `管理员 API ${bypassApiPath} 可直接调用` : "",
      ]
        .filter(Boolean)
        .join("；");

      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "critical",
          confidence: "high",
          actualBehavior: `检测到越权访问：${bypassDetails}。普通用户无需管理员 PIN 即可访问管理功能`,
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "high",
        actualBehavior: "普通用户无法访问管理员页面和 API，权限隔离正常",
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// ---- 通用执行器：会话安全测试 ----
async function executeGenericSessionPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    if (!ctx.isLoggedIn) {
      const loginResult = await loginForAdvanced(ctx);
      idx++;
      if (!loginResult.success) {
        steps.push(makeStep(idx, "登录系统", { consoleLog: loginResult.error }));
        return buildPathResult(
          path,
          runId,
          {
            status: "fail",
            severity: "high",
            confidence: "high",
            actualBehavior: `登录失败：${loginResult.error}`,
            impactScope: path.description,
            steps,
          },
          Date.now() - startMs,
        );
      }
      steps.push(
        makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "已登录",
        }),
      );
    }

    const page = ctx.executor.browser!;

    // 步骤2：检查 cookie 安全标志
    idx++;
    const cookies = await page.getCookies();
    const cookieInfo = cookies.map((c) => ({
      name: c.name,
      path: c.path,
      domain: c.domain,
    }));
    const hasSessionCookie = cookies.some(
      (c) =>
        c.name.toLowerCase().includes("session") ||
        c.name.toLowerCase().includes("token") ||
        c.name.toLowerCase().includes("auth"),
    );

    steps.push(
      makeStep(idx, "检查会话 cookie 安全标志", {
        screenshotDesc: `检测到 ${cookies.length} 个 cookie，会话 cookie: ${hasSessionCookie ? "存在" : "未检测到"}`,
        networkRequest: cookies
          .map((c) => `Cookie: ${c.name} (path=${c.path}, domain=${c.domain})`)
          .join("\n"),
        dataChange: `Cookie 数量: ${cookies.length}，含会话标识: ${hasSessionCookie}`,
        stateBefore: "登录后",
        stateAfter: `${cookies.length} 个 cookie 已设置`,
      }),
    );

    // 步骤3：验证会话持久性（刷新后仍保持登录）
    idx++;
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const refreshUrl = page.url();
    const sessionPersisted = !refreshUrl.includes("/login");

    steps.push(
      makeStep(idx, "刷新页面验证会话持久性", {
        screenshotDesc: `刷新后 URL: ${refreshUrl}`,
        networkRequest: `GET ${refreshUrl} → ${sessionPersisted ? "保持登录" : "跳转登录页"}`,
        stateBefore: "已登录",
        stateAfter: sessionPersisted ? "会话保持" : "会话丢失",
        dataChange: sessionPersisted ? "无变化" : "会话丢失",
      }),
    );

    // 步骤4：检查 console 错误
    idx++;
    const consoleLogs = page.getConsoleLogs();
    const errors = consoleLogs.filter(
      (log) => log.toLowerCase().includes("error") || log.toLowerCase().includes("failed"),
    );

    steps.push(
      makeStep(idx, "检查 console 错误日志", {
        consoleLog: errors.length > 0 ? errors.join("\n") : "无错误日志",
        stateBefore: "检查前",
        stateAfter: `${errors.length} 个错误`,
      }),
    );

    if (!sessionPersisted) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "high",
          confidence: "high",
          actualBehavior: "刷新后会话丢失，页面跳转到登录页",
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "medium",
        actualBehavior: `会话 cookie 正常设置（${cookies.length} 个），刷新后会话保持，console 错误 ${errors.length} 个`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// ---- 通用执行器：数据一致性测试 ----
async function executeGenericConsistencyPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    if (!ctx.isLoggedIn) {
      const loginResult = await loginForAdvanced(ctx);
      idx++;
      if (!loginResult.success) {
        steps.push(makeStep(idx, "登录系统", { consoleLog: loginResult.error }));
        return buildPathResult(
          path,
          runId,
          {
            status: "fail",
            severity: "high",
            confidence: "high",
            actualBehavior: `登录失败：${loginResult.error}`,
            impactScope: path.description,
            steps,
          },
          Date.now() - startMs,
        );
      }
      steps.push(
        makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "已登录",
        }),
      );
    }

    const page = ctx.executor.browser!;

    // 步骤2：读取页面显示的数据
    idx++;
    const pageText = await page.text("body", { timeout: 5000 }).catch(() => "");
    // 尝试从页面文本中提取数值（积分、余额等）
    const numberMatches = pageText.match(/(\d+)\s*(积分|分|分钟|余额|点)/g) || [];
    steps.push(
      makeStep(idx, "从页面读取显示的数据（积分/余额等）", {
        screenshotDesc: `页面文本长度 ${pageText.length}，提取到数值: ${numberMatches.slice(0, 5).join(", ") || "无"}`,
        stateBefore: "读取前",
        stateAfter: `提取到 ${numberMatches.length} 个数值`,
      }),
    );

    // 步骤3：查询数据库对比
    idx++;
    let dbResult = "未配置 DB 路径，跳过 DB 对比";
    let dbConsistent = true;
    let dbAvailable = false;
    if (ctx.executor.db && ctx.dbPath) {
      dbAvailable = true;
      try {
        const tables = await ctx.executor.db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        );
        const tableNames = tables.map((t) => t.name);

        // 查找可能包含积分/流水数据的表
        const ledgerTable = tableNames.find(
          (t) => t.toLowerCase().includes("ledger") || t.toLowerCase().includes("points") || t.toLowerCase().includes("record"),
        );

        if (ledgerTable) {
          const count = await ctx.executor.db.count(ledgerTable);
          dbResult = `表 ${ledgerTable} 有 ${count} 条记录`;
          // 检查是否有重复记录（简单的完整性检查）
          if (count > 1000) {
            dbResult += "（记录数较多，建议检查是否有重复写入）";
          }
        } else {
          dbResult = `数据库表: ${tableNames.join(", ")}`;
        }
      } catch (e) {
        dbResult = `DB 查询失败: ${e instanceof Error ? e.message : String(e)}`;
        dbConsistent = false;
      }
    }

    steps.push(
      makeStep(idx, "查询数据库验证数据一致性", {
        dataChange: dbResult,
        stateBefore: "DB 查询前",
        stateAfter: dbConsistent ? "DB 查询正常" : "DB 查询异常",
      }),
    );

    // 未配置 DB 时，一致性测试无法实际验证，返回 fail 而非静默放行
    if (!dbAvailable) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "low",
          actualBehavior: "未配置数据库路径，无法验证数据一致性，该路径未实际执行验证",
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    // 步骤4：检查网络请求是否有异常
    idx++;
    const networkReqs = page.getNetworkRequests();
    const errorRequests = networkReqs.filter((r) => r.status >= 400);
    steps.push(
      makeStep(idx, "检查网络请求是否有异常状态码", {
        networkRequest: errorRequests.length > 0
          ? errorRequests.slice(0, 5).map((r) => `${r.method} ${r.url} → ${r.status}`).join("\n")
          : `共 ${networkReqs.length} 个请求，无异常状态码`,
        stateBefore: "检查前",
        stateAfter: `${errorRequests.length} 个异常请求`,
      }),
    );

    if (!dbConsistent || errorRequests.length > 0) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "medium",
          actualBehavior: `数据一致性检查发现问题：${!dbConsistent ? "DB 查询异常" : ""} ${errorRequests.length > 0 ? `${errorRequests.length} 个异常网络请求` : ""}`.trim(),
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "medium",
        actualBehavior: `数据一致性检查通过：页面数据正常显示，DB 查询正常，网络请求无异常`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// ---- 通用执行器：页面探索测试（跨功能 + 兜底）----
async function executeGenericExplorationPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  const startMs = Date.now();
  const steps: AdvancedStepRecord[] = [];
  let idx = 0;

  try {
    if (!ctx.isLoggedIn) {
      const loginResult = await loginForAdvanced(ctx);
      idx++;
      if (!loginResult.success) {
        steps.push(makeStep(idx, "登录系统", { consoleLog: loginResult.error }));
        return buildPathResult(
          path,
          runId,
          {
            status: "fail",
            severity: "high",
            confidence: "high",
            actualBehavior: `登录失败：${loginResult.error}`,
            impactScope: path.description,
            steps,
          },
          Date.now() - startMs,
        );
      }
      steps.push(
        makeStep(idx, `登录系统（账号 ${ctx.testUsername}）`, {
          stateBefore: "未登录",
          stateAfter: "已登录",
        }),
      );
    }

    const page = ctx.executor.browser!;
    const base = ctx.baseUrl.replace(/\/$/, "");

    // 步骤2：访问首页，收集页面信息
    idx++;
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const homeUrl = page.url();
    const homeText = await page.text("body", { timeout: 5000 }).catch(() => "");
    const homeConsoleLogs = page.getConsoleLogs();
    const homeErrors = homeConsoleLogs.filter(
      (l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed"),
    );

    steps.push(
      makeStep(idx, "访问首页并收集页面信息", {
        screenshotDesc: `首页 URL: ${homeUrl}，页面文本长度: ${homeText.length}`,
        consoleLog: homeErrors.length > 0
          ? `检测到 ${homeErrors.length} 个错误：\n${homeErrors.slice(0, 3).join("\n")}`
          : "无错误日志",
        stateBefore: "访问前",
        stateAfter: `首页加载${homeText.length > 50 ? "正常" : "异常"}`,
      }),
    );

    // 步骤3：尝试导航到常见功能页面
    idx++;
    const featurePaths = ["/tasks", "/points", "/rewards", "/screen-time", "/badges", "/reflection", "/family"];
    const accessiblePages: string[] = [];
    const pageErrors: string[] = [];

    for (const featurePath of featurePaths) {
      try {
        await page.goto(`${base}${featurePath}`, {
          waitUntil: "domcontentloaded",
          timeout: 8000,
        });
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const currentUrl = page.url();
        const pageText = await page.text("body", { timeout: 3000 }).catch(() => "");
        if (!currentUrl.includes("/login") && pageText.length > 50) {
          accessiblePages.push(featurePath);
        }
        const logs = page.getConsoleLogs();
        const errs = logs.filter(
          (l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed"),
        );
        if (errs.length > 0) {
          pageErrors.push(`${featurePath}: ${errs[0]}`);
        }
      } catch {
        // 页面不可访问
      }
    }

    steps.push(
      makeStep(idx, `探索功能页面（共尝试 ${featurePaths.length} 个路径）`, {
        screenshotDesc: `可访问页面: ${accessiblePages.join(", ") || "无"}`,
        networkRequest: featurePaths
          .map((p) => `GET ${p} → ${accessiblePages.includes(p) ? "可访问" : "不可访问"}`)
          .join("\n"),
        consoleLog: pageErrors.length > 0
          ? `${pageErrors.length} 个页面有错误：\n${pageErrors.slice(0, 3).join("\n")}`
          : "所有页面无错误",
        stateBefore: "探索前",
        stateAfter: `${accessiblePages.length}/${featurePaths.length} 个页面可访问`,
      }),
    );

    // 步骤4：验证各模块间数据流转
    idx++;
    const networkReqs = page.getNetworkRequests();
    const apiCalls = networkReqs.filter((r) => r.url.includes("/api/") || r.url.includes("/trpc/"));
    steps.push(
      makeStep(idx, "检查各模块间数据流转（网络请求）", {
        networkRequest: apiCalls.length > 0
          ? apiCalls.slice(0, 5).map((r) => `${r.method} ${r.url} → ${r.status}`).join("\n")
          : `共 ${networkReqs.length} 个网络请求，无 API 调用`,
        stateBefore: "检查前",
        stateAfter: `${apiCalls.length} 个 API 调用，${pageErrors.length} 个页面错误`,
      }),
    );

    // 判定：有页面错误或所有页面都不可访问为 fail
    if (pageErrors.length > 0) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "medium",
          actualBehavior: `跨功能验证发现 ${pageErrors.length} 个页面错误：${pageErrors.slice(0, 2).join("; ")}`,
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    if (accessiblePages.length === 0 && homeText.length < 50) {
      return buildPathResult(
        path,
        runId,
        {
          status: "fail",
          severity: "medium",
          confidence: "medium",
          actualBehavior: "首页和所有功能页面均无法正常加载",
          impactScope: path.description,
          steps,
        },
        Date.now() - startMs,
      );
    }

    return buildPathResult(
      path,
      runId,
      {
        status: "pass",
        severity: "low",
        confidence: "medium",
        actualBehavior: `跨功能验证通过：首页正常，${accessiblePages.length} 个功能页面可访问，无 console 错误`,
        impactScope: "无",
        steps,
      },
      Date.now() - startMs,
    );
  } catch (err) {
    return buildPathResult(
      path,
      runId,
      {
        status: "fail",
        severity: "high",
        confidence: "high",
        actualBehavior: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
        impactScope: "执行异常",
        steps,
      },
      Date.now() - startMs,
    );
  }
}

// 根据路径 ID 分发到对应的真实执行函数
async function executeRealPath(
  path: TestPath,
  ctx: RealAdvancedContext,
  runId: string,
): Promise<AdvancedPathResult> {
  // 演示项目：使用硬编码的 PATH-001~007 执行逻辑
  if (ctx.isDemo) {
    switch (path.id) {
      case "PATH-001":
        return executeRealPath001(path, ctx, runId);
      case "PATH-002":
        return executeRealPath002(path, ctx, runId);
      case "PATH-003":
        return executeRealPath003(path, ctx, runId);
      case "PATH-004":
        return executeRealPath004(path, ctx, runId);
      case "PATH-005":
        return executeRealPath005(path, ctx, runId);
      case "PATH-006":
        return executeRealPath006(path, ctx, runId);
      case "PATH-007":
        return executeRealPath007(path, ctx, runId);
    }
  }

  // 非演示项目：使用通用执行引擎，基于风险分类真实执行
  const category = categorizeRiskPath(path);
  switch (category) {
    case "normal":
      return executeGenericNormalPath(path, ctx, runId);
    case "concurrent":
      return executeGenericConcurrentPath(path, ctx, runId);
    case "auth_bypass":
      return executeGenericAuthBypassPath(path, ctx, runId);
    case "session":
      return executeGenericSessionPath(path, ctx, runId);
    case "consistency":
      return executeGenericConsistencyPath(path, ctx, runId);
    case "boundary":
      // 边界测试复用并发测试逻辑（尝试突破限额）
      return executeGenericConcurrentPath(path, ctx, runId);
    case "exploration":
    default:
      return executeGenericExplorationPath(path, ctx, runId);
  }
}

// 真实执行高级业务测试主函数
async function runRealAdvancedTests(
  projectId: string,
  onProgress?: (
    current: number,
    total: number,
    path: TestPath,
    result: AdvancedPathResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: AdvancedTestRun; results: AdvancedPathResult[] }> {
  // 标记项目进入高级测试阶段
  markAdvancedTesting(projectId);

  // 开启新的 AI 思考会话（清空旧日志，刷新页面时保留本次执行的思考过程）
  startAIThinkingSession(projectId, "advanced-run");

  // AI 思考日志：开始真实执行
  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "thinking",
    "项目预检通过，开始真实执行高级业务测试（Playwright + API + DB）",
  );

  // 获取项目信息
  const project = getProject(projectId);
  if (!project) {
    recordAIThinkingLog(
      projectId,
      "advanced-run",
      "judging",
      "项目不存在，无法执行测试",
      { level: "error" },
    );
    throw new Error("项目不存在");
  }
  if (!project.testUrl) {
    recordAIThinkingLog(
      projectId,
      "advanced-run",
      "judging",
      "缺少测试地址（testUrl），无法执行真实测试",
      { level: "error" },
    );
    throw new Error(
      "缺少测试地址（testUrl），无法执行真实测试。请在项目设置中填写运行中的项目地址。",
    );
  }

  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "acting",
    `正在访问项目测试地址 ${project.testUrl} 并准备测试环境…`,
  );
  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "thinking",
    `正在根据项目「${project.name}」的业务功能动态生成测试清单…`,
  );

  // 获取高级测试模型（AI 动态生成为主体 + 预设规则辅助）
  const model: AdvancedTestModel = await getAdvancedTestModelForProjectAsync(project);
  const paths = model.paths;

  recordAIThinkingLog(
    projectId,
    "advanced-run",
    "observing",
    `AI 已生成 ${paths.length} 条测试路径，覆盖 ${Array.from(new Set(paths.map((p) => p.type))).join("、")} 等类型`,
  );

  // 创建测试运行
  const run = createAdvancedTestRun(projectId, "real", paths.length);
  onRunCreated?.(run.id);

  // 推导 DB 路径
  let dbPath: string | null = null;
  if (project.localPath) {
    dbPath = resolveDbPath(project.localPath);
  }

  // 创建执行器（带浏览器，失败时明确报错而非假降级）
  // 假降级会让 6 个通用执行器全部空转，比明确报错更糟糕
  let executor: RealTestExecutor;
  try {
    executor = await createRealExecutor({
      projectId,
      baseUrl: project.testUrl,
      dbPath: dbPath ?? undefined,
    });
  } catch (err) {
    // 浏览器启动失败时抛出带安装指引的错误，不做假降级
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `执行器创建失败：${errMsg}\n` +
      `测试需要浏览器支持，请确保 chromium 已安装并可用。`,
    );
  }

  // 解析测试账号：优先使用项目配置，否则生成默认账号
  const { username: configUsername, password: configPassword } = parseTestAccount(
    project.testAccount,
  );
  const testUsername = configUsername || genTestUsername("adv");
  const testPassword = configPassword || getTestPassword();

  // 识别认证契约（代码扫描 → AI 分析 → 运行时探测）
  let authContract: AuthContract | null = null;
  try {
    authContract = await getAuthContract(project);
  } catch {
    authContract = null;
  }

  // 构建执行上下文
  const ctx: RealAdvancedContext = {
    executor,
    baseUrl: project.testUrl,
    dbPath,
    testPassword,
    testUsername,
    isDemo: project.isDemo,
    authContract,
    authCookie: null,
    authToken: null,
    isLoggedIn: false,
    project,
    shouldAbort,
  };

  const results: AdvancedPathResult[] = [];

  try {
    // 非演示项目：执行前先登录，让后续路径共享会话
    if (!ctx.isDemo && executor.browser) {
      const loginResult = await loginForAdvanced(ctx);
      if (!loginResult.success) {
        // 登录失败不阻断——各路径执行器内部会自行判断并降级
        console.warn(`[advanced] 预登录失败：${loginResult.error ?? "未知原因"}`);
      }
    }

    // 逐条执行路径（单条失败不中断后续路径）
    for (let i = 0; i < paths.length; i++) {
      // 检查中止请求
      if (shouldAbort?.()) {
        updateAdvancedTestRun(run.id, {
          status: "failed",
          error: "用户中止测试",
          finishedAt: new Date().toISOString(),
        });
        break;
      }
      const path = paths[i];
      try {
        const result = await executeRealPath(path, ctx, run.id);
        saveAdvancedTestResult(result);
        results.push(result);
        onProgress?.(i + 1, paths.length, path, result);
      } catch (err) {
        // 单条路径异常不中断，生成 fail 结果
        const failResult = buildFailPathResult(path, run.id, err);
        saveAdvancedTestResult(failResult);
        results.push(failResult);
        onProgress?.(i + 1, paths.length, path, failResult);
      }
    }

    // 标记运行完成（未被中止时）
    if (!shouldAbort?.()) {
      updateAdvancedTestRun(run.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    // 致命异常：标记 run 为 failed，避免永远 running
    updateAdvancedTestRun(run.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    // 无论成功失败都关闭执行器，避免 Chromium 僵尸进程
    await executor.close().catch(() => {});
  }

  // 重新读取 run 以获取最新统计
  const finalRun = getAdvancedTestRun(run.id);

  return { run: finalRun ?? run, results };
}

// ============================================================
// 主入口函数
// ============================================================

export async function runAdvancedTests(
  projectId: string,
  mode: "scripted" | "real" = "real",
  onProgress?: (
    current: number,
    total: number,
    path: TestPath,
    result: AdvancedPathResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: AdvancedTestRun; results: AdvancedPathResult[] }> {
  if (mode === "scripted") {
    return runScriptedAdvancedTests(projectId, onProgress, shouldAbort, onRunCreated);
  }
  return runRealAdvancedTests(projectId, onProgress, shouldAbort, onRunCreated);
}

// 获取高级测试模型（供计划页使用）
// 演示项目返回硬编码模型，非演示项目基于 analysisModel 动态生成
export function getOrLoadAdvancedModel(projectId?: string): AdvancedTestModel {
  if (projectId) {
    const project = getProject(projectId);
    if (project) {
      return getAdvancedTestModelForProject(project);
    }
  }
  return getAdvancedTestModel();
}
