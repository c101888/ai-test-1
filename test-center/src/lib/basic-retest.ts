// 修复后复测引擎（模块 D2）
// - runBasicRetest(projectId, mode, onProgress)：复测失败用例
// - mode: "scripted"（剧本回放，降级）或 "real"（真实执行，API + DB）
// - 原问题针对性复测：重新执行失败用例
// - 影响范围回归：执行相关用例
// - 实现修复循环退出条件：最多 3 轮，每轮显示剩余次数
// - scripted 模式：第 1 轮复测通过（模拟用户已修复），问题状态置为"已修复"
// - real 模式：真实重新执行失败用例，由于演示项目 Bug 5 未修复，复测仍会失败

import "server-only";
import {
  getIssue,
  updateIssue,
  getTestCase,
  updateTestCaseStatus,
  getLatestTestRun,
  getTestResults,
  markBasicDone,
  getProject,
  getProjectIssues,
  type Issue,
} from "./store";
import { createRealExecutor, type RealTestExecutor } from "./test-executor";
import { resolveDbPath } from "./test-executor/db-reader";
import { getTestPassword, getLevelAnswerForProject } from "./test-credentials";

// 延时工具
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 复测结果
export interface RetestResult {
  issue: Issue;
  retestRound: number;
  remainingRounds: number;
  passed: boolean;
  originalCaseResult: "pass" | "fail";
  regressionResults: {
    testCaseId: string;
    title: string;
    status: "pass" | "fail";
    note?: string;
  }[];
  message: string;
}

// 进度回调
export type RetestProgressCallback = (
  stage: string,
  current: number,
  total: number,
  message: string,
) => void;

// 获取与失败用例相关的用例（影响范围回归）
// Bug 5 关联：登录后刷新保持登录状态、未登录访问关卡页
function getRelatedCaseIds(issue: Issue): string[] {
  if (issue.id === "ISSUE-005") {
    // Bug 5：进度刷新丢失
    // 相关用例：登录后刷新保持登录状态（BTC-014）、未登录访问关卡页（BTC-016）
    return ["BTC-014", "BTC-016"];
  }
  return [];
}

// ============================================================
// 剧本回放模式（保留原有逻辑，作为降级方案）
// ============================================================

// 执行剧本复测
// - 第 1 轮复测通过（模拟用户已修复 Bug 5）
// - 后续轮次（理论上不会触发）也默认通过
async function runScriptedBasicRetest(
  projectId: string,
  issue: Issue,
  onProgress?: RetestProgressCallback,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<RetestResult> {
  // 更新问题状态为复测中
  const retestRound = issue.retestRounds + 1;
  const remainingRounds = Math.max(0, issue.maxRetestRounds - retestRound);

  updateIssue(issue.id, {
    status: "retesting",
    retestRounds: retestRound,
  });

  onProgress?.("original", 0, 1, `开始第 ${retestRound} 轮复测`);

  // 模拟复测耗时
  await delay(1500);

  // 原问题针对性复测：重新执行失败用例
  // 第 1 轮默认通过（模拟用户已修复）
  const originalCasePassed = true;
  const tc = getTestCase(issue.testCaseId);
  if (tc) {
    updateTestCaseStatus(tc.id, originalCasePassed ? "pass" : "fail");
  }

  onProgress?.(
    "original",
    1,
    1,
    `原问题复测${originalCasePassed ? "通过" : "失败"}`,
  );

  // 影响范围回归：执行相关用例
  const relatedCaseIds = getRelatedCaseIds(issue);
  const regressionResults: RetestResult["regressionResults"] = [];

  for (let i = 0; i < relatedCaseIds.length; i++) {
    const relatedId = relatedCaseIds[i];
    const relatedTc = getTestCase(relatedId);
    if (!relatedTc) continue;

    // 模拟回归执行
    await delay(500);

    // 回归用例默认通过（修复未引入新问题）
    const passed = true;
    updateTestCaseStatus(relatedId, passed ? "pass" : "fail");

    regressionResults.push({
      testCaseId: relatedId,
      title: relatedTc.title,
      status: passed ? "pass" : "fail",
      note: passed
        ? "回归通过，未引入新问题"
        : "回归失败，需检查修复影响",
    });

    onProgress?.(
      "regression",
      i + 1,
      relatedCaseIds.length,
      `回归用例 ${relatedId} ${passed ? "通过" : "失败"}`,
    );
  }

  // 更新问题状态
  if (originalCasePassed) {
    updateIssue(issue.id, { status: "fixed" });

    // 检查项目中是否还有未修复的 Issue（status 为 open/fixing/retesting）
    const projectIssues = getProjectIssues(projectId);
    const hasUnfixed = projectIssues.some(
      (i) =>
        i.status === "open" ||
        i.status === "fixing" ||
        i.status === "retesting",
    );

    if (!hasUnfixed) {
      markBasicDone(projectId);
    }
  }

  const message = originalCasePassed
    ? `第 ${retestRound} 轮复测通过：原问题已修复，${regressionResults.length} 个回归用例全部通过`
    : `第 ${retestRound} 轮复测失败：原问题仍存在，剩余 ${remainingRounds} 轮复测机会`;

  return {
    issue: getIssue(issue.id) ?? issue,
    retestRound,
    remainingRounds,
    passed: originalCasePassed,
    originalCaseResult: originalCasePassed ? "pass" : "fail",
    regressionResults,
    message,
  };
}

// ============================================================
// 真实执行模式（API + DB）
// ============================================================

// 真实复测上下文
interface RealRetestContext {
  executor: RealTestExecutor;
  baseUrl: string;
  testUsername: string;
  testPassword: string;
  authToken: string | null;
  dbPath: string | null;
  level1Id: string | null;
  level1Answer: string;
}

// 生成唯一的测试用户名（避免冲突）
function genTestUsername(): string {
  const ts = Date.now().toString(36).slice(-6);
  const rand = Math.random().toString(36).slice(2, 5);
  return `retest_${ts}_${rand}`;
}

// 注册测试账号
async function registerTestAccount(
  ctx: RealRetestContext,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await ctx.executor.api.post("/api/auth/register", {
      username: ctx.testUsername,
      password: ctx.testPassword,
    });

    if (response.ok) {
      const body = response.body as { token?: string } | null;
      if (body?.token) {
        ctx.authToken = body.token;
        ctx.executor.api.setAuth(body.token);
        return { success: true };
      }
    }

    return { success: false, error: `注册失败: ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// 获取关卡1的 ID
async function fetchLevel1Id(ctx: RealRetestContext): Promise<void> {
  try {
    const response = await ctx.executor.api.get("/api/level");
    if (response.ok) {
      const body = response.body as {
        levels?: Array<{ id: string; order: number }>;
      } | null;
      const level1 = body?.levels?.find((l) => l.order === 1);
      if (level1) {
        ctx.level1Id = level1.id;
      }
    }
  } catch {
    // 忽略
  }
}

// 真实重新执行 BTC-015：完成关卡后刷新查进度（Bug 5）
// 由于演示项目 Bug 5 未修复，复测仍会失败
async function retestBug5(
  ctx: RealRetestContext,
): Promise<{ passed: boolean; note: string }> {
  if (!ctx.authToken) {
    return { passed: false, note: "未登录，无法执行复测" };
  }

  if (!ctx.level1Id) {
    await fetchLevel1Id(ctx);
  }

  if (!ctx.level1Id) {
    return { passed: false, note: "无法获取关卡1 ID" };
  }

  // 步骤1：答题（关卡1答案：<h1>）
  let answerOk = false;
  try {
    const answerRes = await ctx.executor.api.post(
      `/api/level/${ctx.level1Id}/answer`,
      { answer: ctx.level1Answer },
    );
    const answerBody = answerRes.body as { correct?: boolean } | null;
    answerOk = answerRes.ok && answerBody?.correct === true;
  } catch {
    // 答题失败
  }

  if (!answerOk) {
    return { passed: false, note: "答题失败，无法验证进度持久化" };
  }

  // 步骤2：刷新后查询关卡状态
  try {
    const levelRes = await ctx.executor.api.get("/api/level");
    if (!levelRes.ok) {
      return {
        passed: false,
        note: `查询关卡状态失败: ${levelRes.status}`,
      };
    }

    const levelBody = levelRes.body as {
      levels?: Array<{ id: string; order: number; status: string }>;
    } | null;
    const level1 = levelBody?.levels?.find((l) => l.order === 1);

    // Bug 5：进度不持久化，状态仍为 locked 或 unlocked，不是 completed
    if (level1?.status === "completed") {
      return {
        passed: true,
        note: "刷新后关卡1状态为 completed，进度已持久化",
      };
    }

    return {
      passed: false,
      note: `刷新后关卡1状态为 ${level1?.status ?? "未知"}（Bug 5：进度未持久化）`,
    };
  } catch (err) {
    return {
      passed: false,
      note: `查询异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// 真实执行回归用例
async function retestRegressionCase(
  ctx: RealRetestContext,
  caseId: string,
): Promise<{ passed: boolean; note: string }> {
  try {
    // BTC-014：登录后刷新保持登录状态
    if (caseId === "BTC-014") {
      if (!ctx.authToken) {
        return { passed: false, note: "未登录" };
      }
      // 通过 API 验证 token 有效性（模拟刷新后状态保持）
      const res = await ctx.executor.api.get("/api/level");
      if (res.status === 200) {
        return { passed: true, note: "token 仍有效，登录态保持" };
      }
      return { passed: false, note: `登录态丢失: ${res.status}` };
    }

    // BTC-016：未登录访问关卡页
    if (caseId === "BTC-016") {
      const { ApiDriver } = await import("./test-executor/api-driver");
      const noAuthApi = new ApiDriver(ctx.baseUrl);
      const res = await noAuthApi.get("/api/level");
      // 未登录应该返回 200（但 levels 为空/locked）或 401
      if (res.status === 200 || res.status === 401) {
        return { passed: true, note: "未登录访问被正确处理" };
      }
      return {
        passed: false,
        note: `未登录访问异常: ${res.status}`,
      };
    }

    return { passed: true, note: "默认通过" };
  } catch (err) {
    return {
      passed: false,
      note: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// 真实执行复测主函数
async function runRealBasicRetest(
  projectId: string,
  issue: Issue,
  onProgress?: RetestProgressCallback,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<RetestResult> {
  const project = getProject(projectId);
  if (!project) {
    throw new Error("项目不存在");
  }
  if (!project.testUrl) {
    throw new Error(
      "缺少测试地址（testUrl），无法执行真实复测。请在项目设置中填写运行中的项目地址。",
    );
  }

  // 更新问题状态为复测中
  const retestRound = issue.retestRounds + 1;
  const remainingRounds = Math.max(0, issue.maxRetestRounds - retestRound);

  updateIssue(issue.id, {
    status: "retesting",
    retestRounds: retestRound,
  });

  onProgress?.("init", 0, 1, "创建执行器并注册测试账号");

  // 推导 DB 路径
  let dbPath: string | null = null;
  if (project.localPath) {
    dbPath = resolveDbPath(project.localPath);
  }

  // 创建执行器（需要浏览器支持，失败时明确报错，不做假降级）
  let executor: RealTestExecutor;
  try {
    executor = await createRealExecutor({
      projectId,
      baseUrl: project.testUrl,
      dbPath: dbPath ?? undefined,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `执行器创建失败：${errMsg}\n` +
        `测试需要浏览器支持，请确保 chromium 已安装并可用。`,
    );
  }

  // 构建执行上下文
  const ctx: RealRetestContext = {
    executor,
    baseUrl: project.testUrl,
    testUsername: genTestUsername(),
    testPassword: getTestPassword(),
    authToken: null,
    dbPath,
    level1Id: null,
    level1Answer: getLevelAnswerForProject("1", project.isDemo),
  };

  // 后续所有执行逻辑用 try/catch/finally 包裹
  // - try：执行复测逻辑
  // - catch：异常时回退问题状态为 open，避免卡在 retesting
  // - finally：确保无论成功失败都关闭执行器，避免 Chromium 泄漏
  try {
    // 注册测试账号
    const regResult = await registerTestAccount(ctx);
    if (!regResult.success) {
      // 注册失败，复测无法执行，标记为失败
      const tc = getTestCase(issue.testCaseId);
      if (tc) {
        updateTestCaseStatus(tc.id, "fail");
      }

      // 复测失败，问题状态回退到 open
      updateIssue(issue.id, { status: "open" });

      const message = `第 ${retestRound} 轮复测失败：无法创建测试账号（${regResult.error}），剩余 ${remainingRounds} 轮复测机会`;

      return {
        issue: getIssue(issue.id) ?? issue,
        retestRound,
        remainingRounds,
        passed: false,
        originalCaseResult: "fail",
        regressionResults: [],
        message,
      };
    }

    // 获取关卡1 ID
    await fetchLevel1Id(ctx);

    // 原问题针对性复测：重新执行失败用例（BTC-015 / Bug 5）
    onProgress?.("original", 0, 1, "重新执行失败用例");
    const bug5Result = await retestBug5(ctx);
    const originalCasePassed = bug5Result.passed;

    const tc = getTestCase(issue.testCaseId);
    if (tc) {
      updateTestCaseStatus(tc.id, originalCasePassed ? "pass" : "fail");
    }
    onProgress?.("original", 1, 1, bug5Result.note);

    // 影响范围回归：执行相关用例
    const relatedCaseIds = getRelatedCaseIds(issue);
    const regressionResults: RetestResult["regressionResults"] = [];

    for (let i = 0; i < relatedCaseIds.length; i++) {
      // 检查是否中止
      if (shouldAbort?.()) {
        break;
      }
      const relatedId = relatedCaseIds[i];
      const relatedTc = getTestCase(relatedId);
      if (!relatedTc) continue;

      const regResult = await retestRegressionCase(ctx, relatedId);
      updateTestCaseStatus(relatedId, regResult.passed ? "pass" : "fail");

      regressionResults.push({
        testCaseId: relatedId,
        title: relatedTc.title,
        status: regResult.passed ? "pass" : "fail",
        note: regResult.note,
      });

      onProgress?.(
        "regression",
        i + 1,
        relatedCaseIds.length,
        `${relatedId}: ${regResult.note}`,
      );
    }

    // 更新问题状态
    if (originalCasePassed) {
      // 复测通过：问题已修复
      updateIssue(issue.id, { status: "fixed" });

      // 检查项目中是否还有未修复的 Issue
      const projectIssues = getProjectIssues(projectId);
      const hasUnfixed = projectIssues.some(
        (i) =>
          i.status === "open" ||
          i.status === "fixing" ||
          i.status === "retesting",
      );
      if (!hasUnfixed) {
        markBasicDone(projectId);
      }
    } else {
      // 复测失败：问题仍存在，状态回退到 open
      // 由于演示项目 Bug 5 未修复，复测仍会失败
      updateIssue(issue.id, { status: "open" });
    }

    const message = originalCasePassed
      ? `第 ${retestRound} 轮复测通过：原问题已修复，${regressionResults.length} 个回归用例全部通过`
      : `第 ${retestRound} 轮复测失败：${bug5Result.note}，剩余 ${remainingRounds} 轮复测机会`;

    return {
      issue: getIssue(issue.id) ?? issue,
      retestRound,
      remainingRounds,
      passed: originalCasePassed,
      originalCaseResult: originalCasePassed ? "pass" : "fail",
      regressionResults,
      message,
    };
  } catch (err) {
    // 异常时回退问题状态为 open，避免卡在 retesting
    updateIssue(issue.id, { status: "open" });
    console.error(`[runRealBasicRetest] 复测异常:`, err);
    throw err;
  } finally {
    // 确保无论成功失败都关闭执行器，避免 Chromium 泄漏
    await executor.close().catch(() => {});
  }
}

// ============================================================
// 主入口函数
// ============================================================

export async function runBasicRetest(
  projectId: string,
  mode: "scripted" | "real" = "scripted",
  onProgress?: RetestProgressCallback,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<RetestResult | undefined> {
  // 查找项目的未修复问题
  const issues = getProjectIssues(projectId);
  const issue = issues.find(
    (i) => i.status === "open" || i.status === "retesting",
  );
  if (!issue) return undefined;

  if (mode === "scripted") {
    return runScriptedBasicRetest(
      projectId,
      issue,
      onProgress,
      shouldAbort,
      onRunCreated,
    );
  }
  return runRealBasicRetest(
    projectId,
    issue,
    onProgress,
    shouldAbort,
    onRunCreated,
  );
}

// 获取复测剩余次数（用于 UI 展示）
export function getRemainingRetestRounds(issueId: string): number {
  const issue = getIssue(issueId);
  if (!issue) return 0;
  return Math.max(0, issue.maxRetestRounds - issue.retestRounds);
}
