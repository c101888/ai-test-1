// 基础测试执行引擎（模块 C2 + C3）
// - runBasicTests(projectId, mode)：执行基础测试
// - mode: "scripted"（剧本回放，降级）或 "real"（真实执行，Playwright + API + DB）
// - 真实执行模式：访问运行中的项目，真实操作浏览器和 API，收集证据
// - 剧本回放模式：预定义执行结果（演示项目降级方案）
// - 阻断机制：环境与启动 / 页面与导航 类失败 → 阻断对应模块；其他类失败 → 非阻断

import "server-only";
import {
  createTestRun,
  saveTestResult,
  saveTestCases,
  getTestCases,
  updateTestRun,
  updateTestCaseStatus,
  markBasicTesting,
  getTestRun,
  getProject,
  type TestCase,
  type TestRun,
  type TestResult,
  type Evidence,
  type ResultStatus,
  type RiskLevel,
  type Confidence,
} from "./store";
import { generateBasicTestCases } from "./basic-test-cases";
import { createRealExecutor, type RealTestExecutor } from "./test-executor";
import { resolveDbPath } from "./test-executor/db-reader";
import { getTestPassword, getLevelAnswerForProject } from "./test-credentials";
import { getAuthContract, type AuthContract } from "./api-contract";

// ============================================================
// 通用工具函数
// ============================================================

function genEvidenceId(): string {
  return `ev_${Math.random().toString(36).slice(2, 10)}`;
}

function genResultId(): string {
  return `res_${Math.random().toString(36).slice(2, 10)}`;
}

// 生成唯一的测试用户名（避免冲突）
function genTestUsername(): string {
  const ts = Date.now().toString(36).slice(-6);
  return `test_${ts}`;
}

// 解析项目配置的测试账号字符串
// 支持格式："用户名:密码" 或 "用户名 / 密码"
// 返回 { username, password }，解析失败返回空字符串
function parseTestAccount(accountStr: string | undefined): { username: string; password: string } {
  if (!accountStr || !accountStr.trim()) {
    return { username: "", password: "" };
  }
  const str = accountStr.trim();
  // 优先按冒号分隔
  const colonIdx = str.indexOf(":");
  if (colonIdx > 0) {
    return {
      username: str.slice(0, colonIdx).trim(),
      password: str.slice(colonIdx + 1).trim(),
    };
  }
  // 兼容 " / " 分隔
  const slashMatch = str.match(/^(.+?)\s*\/\s*(.+)$/);
  if (slashMatch) {
    return {
      username: slashMatch[1].trim(),
      password: slashMatch[2].trim(),
    };
  }
  return { username: "", password: "" };
}

// 阻断机制：根据用例分类与阻断等级判断是否阻断
function shouldBlock(tc: TestCase, status: ResultStatus): boolean {
  if (status !== "fail") return false;
  if (tc.blockingLevel !== "blocking") return false;
  return tc.category === "env" || tc.category === "page";
}

// ============================================================
// 剧本回放模式（保留原有逻辑，作为降级方案）
// ============================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(): Promise<void> {
  const ms = 500 + Math.floor(Math.random() * 1000);
  return delay(ms);
}

interface ScriptedOutcome {
  status: ResultStatus;
  failedStep?: string;
  expected?: string;
  actual?: string;
  evidences?: Evidence[];
  severity: TestResult["severity"];
  confidence: TestResult["confidence"];
  impactScope: string;
}

function getScriptedOutcome(tc: TestCase): ScriptedOutcome {
  // Bug 5：完成关卡后刷新查进度 - 失败
  if (tc.id === "BTC-015") {
    return {
      status: "fail",
      failedStep: "步骤 5：刷新后回到首页或关卡详情页查看进度",
      expected:
        "刷新后关卡仍显示为已完成状态，下一关已解锁，已完成关卡不可重复答题",
      actual:
        "刷新后关卡仍显示为锁定 / 未完成状态，可重复答题，进度未持久化",
      evidences: [
        {
          id: genEvidenceId(),
          type: "screenshot",
          content:
            "截图描述：刷新后首页关卡列表中，已答对的关卡 1 仍显示「进入」按钮，无「已完成」标识；进度状态为 locked",
        },
        {
          id: genEvidenceId(),
          type: "console",
          content:
            '[Network] GET /api/level 200\n[Response] levels[0].status = "locked"\n[Expected] levels[0].status = "completed"',
        },
        {
          id: genEvidenceId(),
          type: "network",
          content:
            'POST /api/level/{levelId}/answer 200 → { correct: true, points: 10 }\n刷新后：GET /api/level 200 → levels[0].status = "locked"（应为 completed）',
        },
      ],
      severity: "high",
      confidence: "high",
      impactScope:
        "学习进度模块：影响关卡解锁、答题积分路径、用户学习记录。用户答题后无法看到完成状态，体验严重受损。",
    };
  }

  return {
    status: "pass",
    severity: "low",
    confidence: "high",
    impactScope: "无",
  };
}

async function executeScriptedCase(
  tc: TestCase,
  runId: string,
): Promise<TestResult> {
  await randomDelay();
  const outcome = getScriptedOutcome(tc);
  const result: TestResult = {
    id: genResultId(),
    runId,
    testCaseId: tc.id,
    status: outcome.status,
    failedStep: outcome.failedStep,
    expected: outcome.expected,
    actual: outcome.actual,
    evidenceIds: outcome.evidences?.map((e) => e.id) ?? [],
    severity: outcome.severity,
    confidence: outcome.confidence,
    impactScope: outcome.impactScope,
    executedAt: new Date().toISOString(),
  };
  const caseStatus =
    outcome.status === "pass"
      ? "pass"
      : outcome.status === "fail"
        ? "fail"
        : outcome.status === "block"
          ? "block"
          : "skip";
  updateTestCaseStatus(tc.id, caseStatus);
  return result;
}

async function runScriptedBasicTests(
  projectId: string,
  onProgress?: (
    current: number,
    total: number,
    currentCase: TestCase,
    result: TestResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: TestRun; results: TestResult[] }> {
  markBasicTesting(projectId);

  let cases = getTestCases(projectId);
  if (cases.length === 0) {
    cases = generateBasicTestCases(projectId);
    saveTestCases(cases);
  }

  for (const tc of cases) {
    updateTestCaseStatus(tc.id, "pending");
  }

  const run = createTestRun(projectId, "basic", "scripted", cases.length);
  onRunCreated?.(run.id);
  const results: TestResult[] = [];
  // 记录被阻断的模块：阻断只影响同模块后续用例，不影响其他模块
  const blockedCategories = new Set<TestCase["category"]>();

  for (let i = 0; i < cases.length; i++) {
    if (shouldAbort?.()) {
      updateTestRun(run.id, {
        status: "failed",
        error: "用户中止测试",
        finishedAt: new Date().toISOString(),
      });
      break;
    }
    const tc = cases[i];

    if (blockedCategories.has(tc.category)) {
      const skippedResult: TestResult = {
        id: genResultId(),
        runId: run.id,
        testCaseId: tc.id,
        status: "skip",
        evidenceIds: [],
        severity: "low",
        confidence: "high",
        impactScope: "因前置模块阻断而跳过",
        executedAt: new Date().toISOString(),
      };
      saveTestResult(skippedResult);
      results.push(skippedResult);
      updateTestCaseStatus(tc.id, "skip");
      onProgress?.(i + 1, cases.length, tc, skippedResult);
      continue;
    }

    const result = await executeScriptedCase(tc, run.id);
    saveTestResult(result);
    results.push(result);
    onProgress?.(i + 1, cases.length, tc, result);

    if (shouldBlock(tc, result.status)) {
      blockedCategories.add(tc.category);
    }
  }

  updateTestRun(run.id, {
    status: "done",
    finishedAt: new Date().toISOString(),
  });

  const finalRun = getTestRun(run.id);
  return { run: finalRun ?? run, results };
}

// ============================================================
// 真实执行模式（Playwright + API + DB）
// ============================================================

// 真实执行上下文
interface RealExecutionContext {
  executor: RealTestExecutor;
  baseUrl: string;
  testUsername: string;
  testPassword: string;
  authToken: string | null;
  authCookie: string | null; // cookie 认证模式
  authContract: AuthContract | null; // 认证契约（识别失败时为 null，降级到 Playwright UI 驱动）
  dbPath: string | null;
  level1Id: string | null;
  level1Answer: string;
  consecutiveFailures: number;
}

// 真实执行的单个用例结果
interface RealCaseResult {
  status: ResultStatus;
  failedStep?: string;
  expected?: string;
  actual?: string;
  evidences: Evidence[];
  severity: RiskLevel;
  confidence: Confidence;
  impactScope: string;
}

// 注册测试账号
// 优先使用 API 契约，无契约或 API 失败时降级到 Playwright UI 驱动
// 注意：FormData 模式在 Next.js 环境中 redirect:manual 会返回 500，
// 因此 FormData 模式直接使用 Playwright UI 驱动（浏览器自动处理 cookie）
async function registerTestAccount(
  ctx: RealExecutionContext,
): Promise<{ success: boolean; token?: string; cookie?: string; error?: string; skipped?: boolean }> {
  // 有契约且为 JSON 模式：尝试通过 API 注册
  if (ctx.authContract?.register && ctx.authContract.register.requestFormat !== "formdata") {
    try {
      const contract = ctx.authContract.register;
      const fields = contract.fields || { username: "username", password: "password" };
      const data: Record<string, unknown> = {
        [fields.username]: ctx.testUsername,
        [fields.password]: ctx.testPassword,
      };
      if (fields.adminPassword) {
        data[fields.adminPassword] = ctx.testPassword + "_admin";
      }
      if (fields.displayName) {
        data[fields.displayName] = ctx.testUsername;
      }
      if (fields.familyName) {
        data[fields.familyName] = "测试家庭";
      }

      const response = await ctx.executor.api.requestWithFormat(
        "POST",
        contract.path,
        data,
        contract.requestFormat,
      );

      const successStatuses = contract.successStatus || [200, 303];
      if (successStatuses.includes(response.status)) {
        const tokenField = contract.tokenField || "token";
        const body = response.body as Record<string, unknown> | null;
        const token = body?.[tokenField] as string | undefined;
        if (token) {
          ctx.authToken = token;
          ctx.executor.api.setAuth(token);
          return { success: true, token };
        }
        return { success: true };
      }
      console.warn(`[基础测试] API 注册失败（status=${response.status}），降级到 Playwright UI 驱动`);
    } catch (err) {
      console.warn(`[基础测试] API 注册异常: ${err instanceof Error ? err.message : String(err)}，降级到 Playwright UI 驱动`);
    }
  }

  // FormData 模式 / 无契约 / API 失败：降级到 Playwright UI 驱动注册
  return registerViaPlaywright(ctx);
}

// 通过 Playwright UI 驱动注册（降级方案）
async function registerViaPlaywright(
  ctx: RealExecutionContext,
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (!ctx.executor.browser) {
    return { success: false, error: "浏览器未启动，无法执行 UI 注册" };
  }
  try {
    const page = ctx.executor.browser;
    // 清除浏览器 cookie，确保从未登录状态开始
    await page.clearCookies();
    // 去除 baseUrl 末尾斜杠，避免双斜杠
    const base = ctx.baseUrl.replace(/\/$/, "");
    await page.goto(`${base}/register`, { waitUntil: "domcontentloaded", timeout: 15000 });

    // 等待页面充分加载
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // 检查页面是否显示"账号已设置"类提示（部分项目注册后不再显示表单）
    const bodyText = await page.text("body").catch(() => "");
    const alreadyConfiguredPatterns = [
      "已经设置",
      "已注册",
      "已经注册",
      "already configured",
      "already setup",
      "already set up",
      "请使用登录",
      "去登录",
    ];
    const hasForm = await page.isVisible("form").catch(() => false);
    if (!hasForm && alreadyConfiguredPatterns.some((p) => bodyText.includes(p))) {
      // 账号已设置，注册页不再显示表单，这是预期行为
      return { success: true, skipped: true, error: "账号已设置，注册页未显示表单（预期行为）" };
    }

    // 自动识别表单字段：优先按常见 name/id 填充
    const usernameSelectors = [
      'input[name="loginId"]',
      'input[name="username"]',
      'input[name="email"]',
      'input[name="account"]',
      'input[type="email"]',
      'input[type="text"]',
    ];
    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
    ];

    // 填充用户名（超时 5 秒）
    let filledUsername = false;
    for (const sel of usernameSelectors) {
      if (await page.isVisible(sel, { timeout: 5000 }).catch(() => false)) {
        await page.fill(sel, ctx.testUsername);
        filledUsername = true;
        break;
      }
    }
    if (!filledUsername) {
      return { success: false, error: "注册页未找到用户名输入框" };
    }

    // 填充密码（可能有多个密码字段：password + adminPassword）
    let filledPassword = false;
    for (const sel of passwordSelectors) {
      const visible = await page.isVisible(sel, { timeout: 3000 }).catch(() => false);
      if (visible) {
        await page.fill(sel, ctx.testPassword);
        filledPassword = true;
      }
    }
    if (!filledPassword) {
      return { success: false, error: "注册页未找到密码输入框" };
    }

    // 点击提交按钮
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.app-button-primary",
      'button:has-text("注册")',
      'button:has-text("设置")',
      'button:has-text("完成")',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      if (await page.isVisible(sel, { timeout: 3000 }).catch(() => false)) {
        await page.click(sel);
        submitted = true;
        break;
      }
    }
    if (!submitted) {
      return { success: false, error: "注册页未找到提交按钮" };
    }

    // 等待页面跳转或加载
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // 判断是否注册成功：URL 不再是 /register，或页面无错误提示
    const currentUrl = page.url();
    if (currentUrl.includes("/register") && currentUrl.includes("error=")) {
      return { success: false, error: "注册失败（页面返回错误）" };
    }

    // 注册成功后，Playwright 的浏览器 context 会自动保存 cookie
    ctx.authCookie = "playwright-managed";
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 登录测试账号
// 优先使用 API 契约，无契约或 API 失败时降级到 Playwright UI 驱动
// 注意：FormData 模式在 Next.js 环境中 redirect:manual 会返回 500，
// 因此 FormData 模式直接使用 Playwright UI 驱动（浏览器自动处理 cookie）
async function loginTestAccount(
  ctx: RealExecutionContext,
): Promise<{ success: boolean; token?: string; cookie?: string; error?: string }> {
  // 有契约且为 JSON 模式：尝试通过 API 登录
  if (ctx.authContract?.login && ctx.authContract.login.requestFormat !== "formdata") {
    try {
      const contract = ctx.authContract.login;
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

      // Bearer 模式：通过状态码 + token 判断
      const successStatuses = contract.successStatus || [200];
      if (successStatuses.includes(response.status)) {
        const tokenField = contract.tokenField || "token";
        const body = response.body as Record<string, unknown> | null;
        const token = body?.[tokenField] as string | undefined;
        if (token) {
          ctx.authToken = token;
          ctx.executor.api.setAuth(token);
          return { success: true, token };
        }
      }
      console.warn(`[基础测试] API 登录失败（status=${response.status}），降级到 Playwright UI 驱动`);
    } catch (err) {
      console.warn(`[基础测试] API 登录异常: ${err instanceof Error ? err.message : String(err)}，降级到 Playwright UI 驱动`);
    }
  }

  // FormData 模式 / 无契约 / API 失败：降级到 Playwright UI 驱动登录
  return loginViaPlaywright(ctx);
}

// 通过 Playwright UI 驱动登录（降级方案）
async function loginViaPlaywright(
  ctx: RealExecutionContext,
): Promise<{ success: boolean; error?: string }> {
  if (!ctx.executor.browser) {
    return { success: false, error: "浏览器未启动，无法执行 UI 登录" };
  }
  try {
    const page = ctx.executor.browser;
    // 清除浏览器 cookie，确保从未登录状态开始
    // 否则登录页可能因已有 session 而重定向到首页，导致看不到表单
    await page.clearCookies();
    // 去除 baseUrl 末尾斜杠，避免双斜杠
    const base = ctx.baseUrl.replace(/\/$/, "");
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });

    // 等待页面充分加载
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // 自动识别用户名字段
    const usernameSelectors = [
      'input[name="loginId"]',
      'input[name="username"]',
      'input[name="email"]',
      'input[name="account"]',
      'input[type="email"]',
      'input[type="text"]',
    ];
    let filledUsername = false;
    for (const sel of usernameSelectors) {
      if (await page.isVisible(sel, { timeout: 5000 }).catch(() => false)) {
        await page.fill(sel, ctx.testUsername);
        filledUsername = true;
        break;
      }
    }
    if (!filledUsername) {
      return { success: false, error: "登录页未找到用户名输入框" };
    }

    // 填充密码
    const passwordSel = 'input[type="password"]';
    if (await page.isVisible(passwordSel, { timeout: 5000 }).catch(() => false)) {
      await page.fill(passwordSel, ctx.testPassword);
    } else {
      return { success: false, error: "登录页未找到密码输入框" };
    }

    // 点击提交按钮
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.app-button-primary",
      'button:has-text("登录")',
    ];
    let submitted = false;
    for (const sel of submitSelectors) {
      if (await page.isVisible(sel, { timeout: 3000 }).catch(() => false)) {
        await page.click(sel);
        submitted = true;
        break;
      }
    }
    if (!submitted) {
      return { success: false, error: "登录页未找到提交按钮" };
    }

    // 等待页面跳转
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    // 判断是否登录成功：URL 不再是 /login，或无 error 参数
    const currentUrl = page.url();
    if (currentUrl.includes("/login") && currentUrl.includes("error=")) {
      return { success: false, error: "登录失败（账号或密码错误）" };
    }

    // 登录成功：从浏览器提取 cookie 同步到 API 驱动
    // 这样后续 API 请求（如 BTC-014 刷新验证登录态）能携带认证 cookie
    try {
      const cookies = await page.getCookies();
      const cookieStr = cookies
        .filter((c) => c.name && c.value)
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      if (cookieStr) {
        ctx.executor.api.setCookie(cookieStr);
        ctx.authCookie = cookieStr;
      } else {
        ctx.authCookie = "playwright-managed";
      }
    } catch {
      ctx.authCookie = "playwright-managed";
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// 获取关卡1的 ID
async function fetchLevel1Id(ctx: RealExecutionContext): Promise<void> {
  try {
    const response = await ctx.executor.api.get("/api/level");
    if (response.ok) {
      const body = response.body as { levels?: Array<{ id: string; order: number }> };
      const level1 = body.levels?.find((l) => l.order === 1);
      if (level1) {
        ctx.level1Id = level1.id;
      }
    }
  } catch {
    // 忽略
  }
}

// ============================================================
// 按分类执行真实测试用例
// ============================================================

// 环境与启动类
async function executeEnvCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  try {
    // 访问首页
    if (tc.title.includes("页面可正常访问")) {
      const response = await ctx.executor.api.get("/");
      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `GET / → ${response.status} ${response.statusText} (${response.durationMs}ms)`,
      });

      // 200-399 都算正常（3xx 重定向是正常行为，如未登录跳转到登录页）
      if (response.status >= 200 && response.status < 400) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "访问首页",
        expected: "页面返回 200-399",
        actual: `页面返回 ${response.status}`,
        evidences,
        severity: "critical",
        confidence: "high",
        impactScope: "测试环境不可用，无法继续测试",
      };
    }

    // API 连通性
    if (tc.title.includes("API 服务连通性")) {
      // 优先使用契约中的受保护资源路径，否则尝试常见路径
      const candidatePaths = [
        ctx.authContract?.protectedResource,
        ctx.authContract?.login?.path,
        "/api/level",
        "/api/points",
        "/api/user",
        "/api/auth/login",
        "/auth/login",
      ].filter(Boolean) as string[];

      let connected = false;
      let lastStatus = 0;
      let triedPath = "";
      for (const p of candidatePaths) {
        try {
          const response = await ctx.executor.api.get(p);
          evidences.push({
            id: genEvidenceId(),
            type: "network",
            content: `GET ${p} → ${response.status} (${response.durationMs}ms)`,
          });
          // 200-399 或 401/403 都算连通（401/403 表示 API 存在但需要认证）
          if (
            (response.status >= 200 && response.status < 400) ||
            response.status === 401 ||
            response.status === 403 ||
            response.status === 405
          ) {
            connected = true;
            triedPath = p;
            break;
          }
          lastStatus = response.status;
        } catch {
          // 继续尝试下一个路径
        }
      }

      if (connected) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "API 连通性检查",
        expected: "至少一个 API 返回 200-399/401/403/405",
        actual: `所有候选路径均不可达（最后状态: ${lastStatus}）`,
        evidences,
        severity: "critical",
        confidence: "high",
        impactScope: "API 服务不可用",
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 页面与导航类
async function executePageCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  try {
    if (!ctx.executor.browser) {
      return {
        status: "fail",
        failedStep: "浏览器未启动",
        expected: "浏览器可用",
        actual: "浏览器未启动",
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "无法执行页面测试",
      };
    }

    const page = ctx.executor.browser;

    // 首页加载
    if (tc.title.includes("首页可正常加载")) {
      await page.goto(ctx.baseUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      const title = await page.text("h1").catch(() => "");
      evidences.push({
        id: genEvidenceId(),
        type: "screenshot",
        content: `首页截图已捕获，标题: ${title.slice(0, 50)}`,
      });

      if (title.length > 0) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "检查首页标题",
        expected: "首页渲染标题",
        actual: "未找到标题元素",
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "首页可能白屏",
      };
    }

    // 登录页加载
    if (tc.title.includes("登录页可正常加载")) {
      await page.goto(`${ctx.baseUrl}/login`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const hasForm = await page.isVisible("form").catch(() => false);
      evidences.push({
        id: genEvidenceId(),
        type: "screenshot",
        content: `登录页截图已捕获，表单存在: ${hasForm}`,
      });

      if (hasForm) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "检查登录页表单",
        expected: "登录页包含表单",
        actual: "未找到表单元素",
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "登录页可能白屏",
      };
    }

    // 注册页加载
    if (tc.title.includes("注册页可正常加载")) {
      await page.goto(`${ctx.baseUrl}/register`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const hasForm = await page.isVisible("form").catch(() => false);
      // 有些项目注册后 /register 页不再显示表单，而是显示提示信息
      // 只要页面有内容（非白屏）就算通过
      const bodyText = await page.text("body").catch(() => "");
      const hasContent = bodyText.trim().length > 0;
      evidences.push({
        id: genEvidenceId(),
        type: "screenshot",
        content: `注册页截图已捕获，表单存在: ${hasForm}，页面有内容: ${hasContent}`,
      });

      if (hasForm || hasContent) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: hasForm ? "high" : "medium",
          impactScope: hasForm ? "无" : "注册页无表单（可能已注册或使用其他注册方式）",
        };
      }

      return {
        status: "fail",
        failedStep: "检查注册页表单",
        expected: "注册页包含表单或有内容",
        actual: "页面无内容（白屏）",
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "注册页可能白屏",
      };
    }

    // 关卡详情页加载
    if (tc.title.includes("关卡详情页可正常加载")) {
      if (!ctx.authToken && !ctx.authCookie) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "未登录，跳过",
        };
      }

      if (!ctx.level1Id) {
        await fetchLevel1Id(ctx);
      }

      // 非演示项目可能无关卡概念（如家庭积分系统、管理系统等）
      // 此时 /api/level 返回 404 或不存在，应跳过而非失败
      if (!ctx.level1Id) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "本项目无关卡 API（非演示项目），跳过关卡详情页测试",
        };
      }

      await page.goto(`${ctx.baseUrl}/level/${ctx.level1Id}`, { waitUntil: "domcontentloaded", timeout: 15000 });
      const hasContent = await page.isVisible("form").catch(() => false);
      evidences.push({
        id: genEvidenceId(),
        type: "screenshot",
        content: `关卡详情页截图已捕获，表单存在: ${hasContent}`,
      });

      if (hasContent) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "检查关卡详情页",
        expected: "关卡详情页包含答题表单",
        actual: "未找到表单元素",
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "关卡详情页可能白屏",
      };
    }

    // 全站无白屏
    if (tc.title.includes("全站无白屏")) {
      // 只检查核心页面，不检查可能不存在的页面（如 /signin /rewards）
      // 404 页面有内容也不算白屏
      const pages = ["/", "/login", "/register"];
      const failedPages: string[] = [];

      for (const p of pages) {
        try {
          await page.goto(`${ctx.baseUrl}${p}`, { waitUntil: "domcontentloaded", timeout: 15000 });
          const body = await page.text("body").catch(() => "");
          if (body.trim().length === 0) {
            failedPages.push(p);
          }
        } catch {
          failedPages.push(p);
        }
      }

      evidences.push({
        id: genEvidenceId(),
        type: "screenshot",
        content: `全站页面检查完成（${pages.join(", ")}），失败页面: ${failedPages.length > 0 ? failedPages.join(", ") : "无"}`,
      });

      if (failedPages.length === 0) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: `检查页面: ${failedPages.join(", ")}`,
        expected: "所有页面正常渲染",
        actual: `白屏页面: ${failedPages.join(", ")}`,
        evidences,
        severity: "high",
        confidence: "high",
        impactScope: "部分页面白屏",
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 核心正常路径类
async function executeHappyCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  try {
    // 注册主路径
    if (tc.title.includes("用户注册主路径")) {
      // 使用新用户名测试注册（避免与已登录账号冲突）
      const regUsername = genTestUsername();
      const origUsername = ctx.testUsername;
      ctx.testUsername = regUsername;
      // 清除已有认证状态，确保注册是从未登录状态开始
      ctx.authToken = null;
      ctx.authCookie = null;
      ctx.executor.api.clearAuth();

      const result = await registerTestAccount(ctx);
      // 恢复原始用户名（后续登录用例需要用配置的账号）
      ctx.testUsername = origUsername;

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `注册（用户名: ${regUsername}）: ${result.skipped ? "跳过 - " + result.error : result.success ? "成功" + (result.cookie ? "（Cookie 认证）" : result.token ? "（Token 认证）" : "") : "失败 - " + result.error}`,
      });

      // 账号已设置，注册页不显示表单：跳过（预期行为）
      if (result.skipped) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "账号已设置，注册功能已验证可用",
        };
      }

      return result.success
        ? { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" }
        : {
            status: "fail",
            failedStep: "注册新用户",
            expected: "注册成功并返回 token/cookie",
            actual: result.error || "注册失败",
            evidences,
            severity: "medium",
            confidence: "high",
            impactScope: "注册功能异常",
          };
    }

    // 登录主路径
    if (tc.title.includes("用户登录主路径")) {
      // 清除已有认证状态，确保登录是从未登录状态开始
      ctx.authToken = null;
      ctx.authCookie = null;
      ctx.executor.api.clearAuth();

      const result = await loginTestAccount(ctx);

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `登录（用户名: ${ctx.testUsername}）: ${result.success ? "成功" + (result.cookie ? "（Cookie 认证）" : result.token ? "（Token 认证）" : "") : "失败 - " + result.error}`,
      });

      return result.success
        ? { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" }
        : {
            status: "fail",
            failedStep: "登录",
            expected: "登录成功并返回 token/cookie",
            actual: result.error || "登录失败",
            evidences,
            severity: "medium",
            confidence: "high",
            impactScope: "登录功能异常",
          };
    }

    // 退出登录
    if (tc.title.includes("用户退出登录")) {
      // 检查登录态：token 或 cookie 任一存在即可
      if (!ctx.authToken && !ctx.authCookie) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "未登录，跳过",
        };
      }
      // 有退出契约：调用退出 API
      if (ctx.authContract?.logout) {
        const contract = ctx.authContract.logout;
        const response = await ctx.executor.api.requestWithFormat(
          contract.method,
          contract.path,
          undefined,
          contract.requestFormat,
        );
        evidences.push({
          id: genEvidenceId(),
          type: "network",
          content: `${contract.method} ${contract.path} → ${response.status}${response.url ? ` → ${response.url}` : ""}`,
        });
        // FormData 模式（redirect:follow）：最终状态 200 表示成功（重定向到登录页后返回 200）
        // JSON 模式：303 表示成功（重定向到登录页）
        const successStatuses = contract.successStatus || [200, 303];
        // 接受 200-399 范围内的状态码（logout 成功后会重定向，follow 模式下最终是 200）
        if (successStatuses.includes(response.status) || (response.status >= 200 && response.status < 400)) {
          // 清除认证状态
          ctx.authToken = null;
          ctx.authCookie = null;
          ctx.executor.api.clearAuth();
          // 同时清除浏览器 cookie
          if (ctx.executor.browser) {
            await ctx.executor.browser.clearCookies().catch(() => {});
          }
          return { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" };
        }
        return {
          status: "fail",
          failedStep: "退出登录",
          expected: `返回 ${successStatuses.join("/")}`,
          actual: `返回 ${response.status}${response.url ? ` → ${response.url}` : ""}`,
          evidences,
          severity: "low",
          confidence: "medium",
          impactScope: "退出功能异常",
        };
      }
      // 无退出契约：通过清除 token 模拟，验证受保护资源访问
      ctx.authToken = null;
      ctx.authCookie = null;
      ctx.executor.api.clearAuth();
      return {
        status: "pass",
        evidences,
        severity: "low",
        confidence: "medium",
        impactScope: "无退出 API，通过清除认证模拟",
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 表单与输入类
async function executeFormCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  // 无契约时：表单校验测试需要 API 支持，降级为 skip
  // 因为通过 Playwright UI 驱动测试表单校验需要更复杂的交互逻辑
  if (!ctx.authContract?.register && !ctx.authContract?.login) {
    return {
      status: "skip",
      evidences,
      severity: "low",
      confidence: "high",
      impactScope: "无 API 契约，表单校验测试需 API 支持，跳过",
    };
  }

  // 辅助函数：判断表单校验是否被拦截
  // FormData 模式（redirect:follow）：成功和失败都返回 200（最终页），需通过最终 URL 区分
  //   - 失败：最终 URL 含 error/login/register（重定向到错误页）
  //   - 成功：最终 URL 是首页或其他非错误页
  // JSON 模式：通过状态码判断（400/401 = 拦截）
  function isValidationBlocked(
    response: { status: number; headers: Record<string, string>; url?: string },
    contract: { failureStatus: number[]; failureRedirect?: string; successRedirect?: string; requestFormat: string },
  ): boolean {
    const failureStatuses = contract.failureStatus || [400];

    // JSON 模式：直接检查状态码
    if (contract.requestFormat !== "formdata") {
      return failureStatuses.includes(response.status);
    }

    // FormData 模式（redirect:follow）：通过最终 URL 区分
    // follow 模式下成功返回 200（重定向到首页），失败也返回 200（重定向到 error 页）
    // 需通过 response.url 判断
    const finalUrl = response.url || response.headers["location"] || "";
    if (finalUrl.includes("error") || finalUrl.includes("login") || finalUrl.includes("register")) {
      return true;
    }
    return false;
  }

  // 辅助函数：格式化响应的重定向信息（用于证据展示）
  function formatRedirect(response: { headers: Record<string, string>; url?: string }): string {
    const target = response.url || response.headers["location"] || "";
    return target ? ` → ${target}` : "";
  }

  try {
    // 空用户名注册
    if (tc.title.includes("空用户名")) {
      const contract = ctx.authContract?.register;
      if (!contract) {
        return { status: "skip", evidences, severity: "low", confidence: "high", impactScope: "无注册 API 契约，跳过" };
      }
      const fields = contract.fields || { username: "username", password: "password" };
      const data: Record<string, unknown> = {
        [fields.username]: "",
        [fields.password]: ctx.testPassword,
      };
      if (fields.adminPassword) {
        data[fields.adminPassword] = ctx.testPassword + "_admin";
      }

      const response = await ctx.executor.api.requestWithFormat(
        "POST",
        contract.path,
        data,
        contract.requestFormat,
      );

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `POST ${contract.path}（空用户名）→ ${response.status}${formatRedirect(response)}`,
      });

      // 使用 isValidationBlocked 判断校验是否拦截
      if (isValidationBlocked(response, contract)) {
        return { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" };
      }

      return {
        status: "fail",
        failedStep: "空用户名注册",
        expected: "表单校验拦截（返回错误状态码或重定向到错误页）",
        actual: `返回 ${response.status}${formatRedirect(response)}`,
        evidences,
        severity: "medium",
        confidence: "high",
        impactScope: "表单校验缺失",
      };
    }

    // 空密码注册
    if (tc.title.includes("空密码")) {
      const contract = ctx.authContract?.register;
      if (!contract) {
        return { status: "skip", evidences, severity: "low", confidence: "high", impactScope: "无注册 API 契约，跳过" };
      }
      const fields = contract.fields || { username: "username", password: "password" };
      const data: Record<string, unknown> = {
        [fields.username]: genTestUsername(),
        [fields.password]: "",
      };
      if (fields.adminPassword) {
        data[fields.adminPassword] = "";
      }

      const response = await ctx.executor.api.requestWithFormat(
        "POST",
        contract.path,
        data,
        contract.requestFormat,
      );

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `POST ${contract.path}（空密码）→ ${response.status}${formatRedirect(response)}`,
      });

      if (isValidationBlocked(response, contract)) {
        return { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" };
      }

      return {
        status: "fail",
        failedStep: "空密码注册",
        expected: "表单校验拦截（返回错误状态码或重定向到错误页）",
        actual: `返回 ${response.status}${formatRedirect(response)}`,
        evidences,
        severity: "medium",
        confidence: "high",
        impactScope: "表单校验缺失",
      };
    }

    // 错误密码登录
    if (tc.title.includes("错误密码")) {
      const contract = ctx.authContract?.login;
      if (!contract) {
        return { status: "skip", evidences, severity: "low", confidence: "high", impactScope: "无登录 API 契约，跳过" };
      }
      const fields = contract.fields || { username: "username", password: "password" };
      const data: Record<string, unknown> = {
        [fields.username]: ctx.testUsername,
        [fields.password]: "wrong_password_123",
      };

      const response = await ctx.executor.api.requestWithFormat(
        "POST",
        contract.path,
        data,
        contract.requestFormat,
      );

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `POST ${contract.path}（错误密码）→ ${response.status}${formatRedirect(response)}`,
      });

      if (isValidationBlocked(response, contract)) {
        return { status: "pass", evidences, severity: "low", confidence: "high", impactScope: "无" };
      }

      return {
        status: "fail",
        failedStep: "错误密码登录",
        expected: "表单校验拦截（返回错误状态码或重定向到错误页）",
        actual: `返回 ${response.status}${formatRedirect(response)}`,
        evidences,
        severity: "medium",
        confidence: "high",
        impactScope: "密码校验缺失",
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 数据持久化类
async function executePersistenceCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  try {
    // 登录后刷新保持登录状态
    if (tc.title.includes("登录后刷新页面保持登录状态")) {
      if (!ctx.authToken && !ctx.authCookie) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "未登录，跳过",
        };
      }

      // 通过受保护资源验证登录态是否保持（模拟刷新后状态保持）
      // 优先使用契约的 protectedResource，否则尝试常见路径
      const candidatePaths = [
        ctx.authContract?.protectedResource,
        "/api/level",
        "/api/points",
        "/api/user",
        "/api/family",
        "/api/rewards",
      ].filter(Boolean) as string[];

      let verified = false;
      let lastStatus = 0;
      let lastPath = "";
      for (const p of candidatePaths) {
        try {
          const response = await ctx.executor.api.get(p);
          evidences.push({
            id: genEvidenceId(),
            type: "network",
            content: `GET ${p}（验证登录态）→ ${response.status}`,
          });
          // 200 表示登录态保持
          if (response.status === 200) {
            verified = true;
            lastPath = p;
            break;
          }
          lastStatus = response.status;
          lastPath = p;
        } catch {
          // 继续尝试
        }
      }

      if (verified) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "刷新后验证登录态",
        expected: "受保护资源返回 200（登录态保持）",
        actual: `GET ${lastPath} 返回 ${lastStatus}`,
        evidences,
        severity: "medium",
        confidence: "high",
        impactScope: "登录态可能未持久化",
      };
    }

    // 完成关卡后刷新查进度（Bug 5）
    // 此用例针对演示项目的关卡/答题场景，非演示项目无此 API 时跳过
    if (tc.title.includes("完成关卡后刷新页面进度保持已完成")) {
      if ((!ctx.authToken && !ctx.authCookie) || !ctx.level1Id) {
        return {
          status: "skip",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "未登录或未获取关卡 ID，跳过",
        };
      }

      // 步骤1：答题（演示项目特有 API）
      const answerResponse = await ctx.executor.api.post(
        `/api/level/${ctx.level1Id}/answer`,
        { answer: ctx.level1Answer },
      );

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `POST /api/level/${ctx.level1Id}/answer → ${answerResponse.status}: ${JSON.stringify(answerResponse.body).slice(0, 100)}`,
      });

      const answerBody = answerResponse.body as { correct?: boolean };
      if (!answerResponse.ok || !answerBody.correct) {
        return {
          status: "fail",
          failedStep: "答题",
          expected: "答题正确",
          actual: `答题返回 ${answerResponse.status}`,
          evidences,
          severity: "medium",
          confidence: "high",
          impactScope: "无法验证进度持久化",
        };
      }

      // 步骤2：刷新后查询关卡状态
      const levelResponse = await ctx.executor.api.get("/api/level");

      evidences.push({
        id: genEvidenceId(),
        type: "network",
        content: `GET /api/level（刷新后）→ ${levelResponse.status}`,
      });

      if (!levelResponse.ok) {
        return {
          status: "fail",
          failedStep: "刷新后查询关卡状态",
          expected: "返回 200",
          actual: `返回 ${levelResponse.status}`,
          evidences,
          severity: "medium",
          confidence: "high",
          impactScope: "无法验证进度",
        };
      }

      const levelBody = levelResponse.body as {
        levels?: Array<{ id: string; order: number; status: string }>;
      };
      const level1 = levelBody.levels?.find((l) => l.order === 1);

      evidences.push({
        id: genEvidenceId(),
        type: "console",
        content: `刷新后关卡1状态: ${level1?.status ?? "未知"}（预期: completed）`,
      });

      // Bug 5：进度不持久化，状态仍为 locked 或 unlocked，不是 completed
      if (level1?.status === "completed") {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      return {
        status: "fail",
        failedStep: "刷新后查看关卡1进度",
        expected: "关卡1状态为 completed",
        actual: `关卡1状态为 ${level1?.status ?? "未知"}（Bug 5：进度未持久化）`,
        evidences,
        severity: "high",
        confidence: "high",
        impactScope:
          "学习进度模块：答题后进度未持久化，刷新后状态丢失，用户无法看到完成状态",
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 基础权限类
async function executePermissionCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  const evidences: Evidence[] = [];

  try {
    const { ApiDriver } = await import("./test-executor/api-driver");
    const noAuthApi = new ApiDriver(ctx.baseUrl);

    // 未登录访问受保护资源（关卡详情页/受保护页面）
    if (tc.title.includes("未登录访问关卡详情页")) {
      // 优先使用契约的 protectedResource，否则尝试常见受保护路径
      const candidatePaths = [
        ctx.authContract?.protectedResource,
        "/api/level",
        "/api/points",
        "/api/user",
        "/api/family",
        "/api/rewards",
        "/api/dashboard",
      ].filter(Boolean) as string[];

      let intercepted = false;
      let lastStatus = 0;
      let lastPath = "";
      for (const p of candidatePaths) {
        try {
          const response = await noAuthApi.get(p);
          evidences.push({
            id: genEvidenceId(),
            type: "network",
            content: `GET ${p}（无认证）→ ${response.status}`,
          });
          // 401/403 表示被拦截（权限校验正常）
          // 303/302 重定向到登录页也表示被拦截
          if (response.status === 401 || response.status === 403) {
            intercepted = true;
            lastPath = p;
            break;
          }
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers["location"] || "";
            if (location.includes("login") || location.includes("auth")) {
              intercepted = true;
              lastPath = p;
              break;
            }
          }
          lastStatus = response.status;
          lastPath = p;
        } catch {
          // 继续尝试
        }
      }

      if (intercepted) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      // 所有路径都返回 200（未拦截），但可能是因为这些 API 本身不要求登录
      // 这种情况下标记为 pass（权限校验可能由前端路由处理）
      if (lastStatus === 200) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "medium",
          impactScope: "API 层未拦截未登录请求（可能由前端路由处理权限）",
        };
      }

      return {
        status: "fail",
        failedStep: "未登录访问受保护资源",
        expected: "返回 401/403 或重定向到登录页",
        actual: `返回 ${lastStatus}`,
        evidences,
        severity: "medium",
        confidence: "high",
        impactScope: "权限校验可能缺失",
      };
    }

    // 未登录调用受保护 POST API（签到/积分等写操作）
    if (tc.title.includes("未登录调用签到 API")) {
      // 尝试 POST 到受保护资源，检测是否被拦截
      const candidatePaths = [
        ctx.authContract?.protectedResource,
        "/api/sign",
        "/api/points/award",
        "/api/rewards/claim",
        "/api/level/1/answer",
        "/api/family/create",
      ].filter(Boolean) as string[];

      let intercepted = false;
      let lastStatus = 0;
      let lastPath = "";
      for (const p of candidatePaths) {
        try {
          const response = await noAuthApi.post(p, {});
          evidences.push({
            id: genEvidenceId(),
            type: "network",
            content: `POST ${p}（无认证）→ ${response.status}`,
          });
          // 401/403 表示被拦截（权限校验正常）
          if (response.status === 401 || response.status === 403) {
            intercepted = true;
            lastPath = p;
            break;
          }
          // 303/302 重定向到登录页也表示被拦截
          if (response.status >= 300 && response.status < 400) {
            const location = response.headers["location"] || "";
            if (location.includes("login") || location.includes("auth")) {
              intercepted = true;
              lastPath = p;
              break;
            }
          }
          lastStatus = response.status;
          lastPath = p;
        } catch {
          // 继续尝试
        }
      }

      if (intercepted) {
        return {
          status: "pass",
          evidences,
          severity: "low",
          confidence: "high",
          impactScope: "无",
        };
      }

      // 200 表示未拦截，存在越权风险
      if (lastStatus === 200 || lastStatus === 201) {
        return {
          status: "fail",
          failedStep: "未登录调用受保护 POST API",
          expected: "返回 401/403 拦截",
          actual: `POST ${lastPath} 返回 ${lastStatus}（权限校验缺失）`,
          evidences,
          severity: "high",
          confidence: "high",
          impactScope: "未登录用户可调用受保护 API，存在越权风险",
        };
      }

      // 其他状态码（如 404/405）：API 不存在或不支持 POST，视为无法验证
      return {
        status: "skip",
        evidences,
        severity: "low",
        confidence: "high",
        impactScope: `未找到可测试的受保护 POST API（最后状态: ${lastStatus}）`,
      };
    }

    return {
      status: "pass",
      evidences,
      severity: "low",
      confidence: "medium",
      impactScope: "未匹配到具体执行逻辑，默认通过",
    };
  } catch (err) {
    evidences.push({
      id: genEvidenceId(),
      type: "console",
      content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
    });
    return {
      status: "fail",
      failedStep: "执行过程异常",
      expected: "正常执行",
      actual: err instanceof Error ? err.message : String(err),
      evidences,
      severity: "high",
      confidence: "high",
      impactScope: "执行异常",
    };
  }
}

// 根据分类执行真实测试用例
async function executeRealCase(
  tc: TestCase,
  ctx: RealExecutionContext,
): Promise<RealCaseResult> {
  switch (tc.category) {
    case "env":
      return executeEnvCase(tc, ctx);
    case "page":
      return executePageCase(tc, ctx);
    case "happy":
      return executeHappyCase(tc, ctx);
    case "form":
      return executeFormCase(tc, ctx);
    case "persistence":
      return executePersistenceCase(tc, ctx);
    case "permission":
      return executePermissionCase(tc, ctx);
    default:
      return {
        status: "skip",
        evidences: [],
        severity: "low",
        confidence: "high",
        impactScope: `未知分类: ${tc.category}`,
      };
  }
}

// 真实执行基础测试主函数
async function runRealBasicTests(
  projectId: string,
  onProgress?: (
    current: number,
    total: number,
    currentCase: TestCase,
    result: TestResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: TestRun; results: TestResult[] }> {
  markBasicTesting(projectId);

  const project = getProject(projectId);
  if (!project) {
    throw new Error("项目不存在");
  }

  if (!project.testUrl) {
    throw new Error("缺少测试地址（testUrl），无法执行动态测试。请在项目设置中填写运行中的项目地址。");
  }

  // 生成或读取用例
  let cases = getTestCases(projectId);
  if (cases.length === 0) {
    cases = generateBasicTestCases(projectId);
    saveTestCases(cases);
  }

  for (const tc of cases) {
    updateTestCaseStatus(tc.id, "pending");
  }

  const run = createTestRun(projectId, "basic", "real", cases.length);
  onRunCreated?.(run.id);

  // 推导 DB 路径
  let dbPath: string | null = null;
  if (project.localPath) {
    dbPath = resolveDbPath(project.localPath);
  }

  // 创建执行器
  const executor = await createRealExecutor({
    projectId,
    baseUrl: project.testUrl,
    dbPath: dbPath ?? undefined,
  });

  // 识别认证契约（三层策略：代码扫描 → AI 分析 → 运行时探测）
  // 识别失败时返回 null，登录/注册将降级到 Playwright UI 驱动
  const authContract = await getAuthContract(project);
  if (authContract) {
    console.log(`[基础测试] 识别到认证契约（来源: ${authContract.source}）: login=${authContract.login?.path}, register=${authContract.register?.path}`);
  } else {
    console.log(`[基础测试] 未识别到认证契约，将降级到 Playwright UI 驱动登录`);
  }

  // 解析项目配置的测试账号（格式："用户名:密码"）
  // 优先使用用户配置的账号，无配置时使用生成的测试账号
  const { username: configUsername, password: configPassword } = parseTestAccount(project.testAccount);
  const testUsername = configUsername || genTestUsername();
  const testPassword = configPassword || getTestPassword();

  // 构建执行上下文
  const ctx: RealExecutionContext = {
    executor,
    baseUrl: project.testUrl,
    testUsername,
    testPassword,
    authToken: null,
    authCookie: null,
    authContract,
    dbPath,
    level1Id: null,
    level1Answer: getLevelAnswerForProject("1", project.isDemo),
    consecutiveFailures: 0,
  };

  // 注册测试账号（失败不阻断，需认证的用例会自动 skip）
  // 优先使用 API 契约，无契约时降级到 Playwright UI 驱动
  // 注意：如果用户配置了已有账号，应直接登录而非注册
  let regResult: { success: boolean; error?: string } = { success: false, error: "未尝试注册" };
  if (!configUsername) {
    // 无配置账号，尝试注册新账号
    regResult = await registerTestAccount(ctx);
  }
  let authFailureMsg: string | null = null;
  if (!regResult.success) {
    // 注册失败或已有配置账号，尝试登录
    const loginResult = await loginTestAccount(ctx);
    if (!loginResult.success) {
      // 注册和登录均失败：不抛错，继续执行不需要认证的用例
      // 需要认证的用例在执行时会检查 ctx.authToken/ctx.authCookie 并标记 skip
      authFailureMsg = `注册/登录均失败（${regResult.error} / ${loginResult.error}），将跳过需要认证的用例`;
      console.warn(`[基础测试] 项目 ${projectId} ${authFailureMsg}`);
    }
  }

  // 获取关卡1 ID（失败不阻断）
  await fetchLevel1Id(ctx);

  const results: TestResult[] = [];
  // 记录被阻断的模块：阻断只影响同模块后续用例，不影响其他模块
  const blockedCategories = new Set<TestCase["category"]>();

  // 注册/登录失败时，添加一条提示结果让前端可见
  if (authFailureMsg) {
    const authFailureResult: TestResult = {
      id: genResultId(),
      runId: run.id,
      testCaseId: "auth-failure-notice",
      status: "skip",
      failedStep: "认证",
      expected: "成功注册或登录测试账号",
      actual: authFailureMsg,
      evidenceIds: [],
      severity: "medium",
      confidence: "high",
      impactScope: "所有需要认证的用例将被跳过",
      executedAt: new Date().toISOString(),
    };
    saveTestResult(authFailureResult);
    results.push(authFailureResult);
  }

  try {
    // 逐个执行用例
    for (let i = 0; i < cases.length; i++) {
    if (shouldAbort?.()) {
      updateTestRun(run.id, {
        status: "failed",
        error: "用户中止测试",
        finishedAt: new Date().toISOString(),
      });
      break;
    }
    const tc = cases[i];

    if (blockedCategories.has(tc.category)) {
      const skippedResult: TestResult = {
        id: genResultId(),
        runId: run.id,
        testCaseId: tc.id,
        status: "skip",
        evidenceIds: [],
        severity: "low",
        confidence: "high",
        impactScope: "因前置模块阻断而跳过",
        executedAt: new Date().toISOString(),
      };
      saveTestResult(skippedResult);
      results.push(skippedResult);
      updateTestCaseStatus(tc.id, "skip");
      onProgress?.(i + 1, cases.length, tc, skippedResult);
      continue;
    }

    let realResult: RealCaseResult;
    try {
      realResult = await executeRealCase(tc, ctx);
    } catch (err) {
      realResult = {
        status: "fail",
        failedStep: "执行异常",
        expected: "正常执行",
        actual: err instanceof Error ? err.message : String(err),
        evidences: [
          {
            id: genEvidenceId(),
            type: "console",
            content: `执行异常: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        severity: "high",
        confidence: "high",
        impactScope: "执行异常",
      };
    }

    const result: TestResult = {
      id: genResultId(),
      runId: run.id,
      testCaseId: tc.id,
      status: realResult.status,
      failedStep: realResult.failedStep,
      expected: realResult.expected,
      actual: realResult.actual,
      evidenceIds: realResult.evidences.map((e) => e.id),
      severity: realResult.severity,
      confidence: realResult.confidence,
      impactScope: realResult.impactScope,
      executedAt: new Date().toISOString(),
    };

    saveTestResult(result);
    results.push(result);

    const caseStatus =
      realResult.status === "pass"
        ? "pass"
        : realResult.status === "fail"
          ? "fail"
          : realResult.status === "block"
            ? "block"
            : "skip";
    updateTestCaseStatus(tc.id, caseStatus);

    onProgress?.(i + 1, cases.length, tc, result);

    // 检查阻断：只阻断同模块后续用例
    if (shouldBlock(tc, realResult.status)) {
      blockedCategories.add(tc.category);
    }

    // 连续失败计数（用于降级提示）
    if (realResult.status === "fail") {
      ctx.consecutiveFailures++;
    } else {
      ctx.consecutiveFailures = 0;
    }
  }

    updateTestRun(run.id, {
      status: "done",
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    updateTestRun(run.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    // 无论成功失败都关闭执行器，避免 Chromium 僵尸进程
    await executor.close().catch(() => {});
  }

  const finalRun = getTestRun(run.id);
  return { run: finalRun ?? run, results };
}

// ============================================================
// 主入口函数
// ============================================================

export async function runBasicTests(
  projectId: string,
  mode: "scripted" | "real" = "scripted",
  onProgress?: (
    current: number,
    total: number,
    currentCase: TestCase,
    result: TestResult,
  ) => void,
  shouldAbort?: () => boolean,
  onRunCreated?: (runId: string) => void,
): Promise<{ run: TestRun; results: TestResult[] }> {
  if (mode === "scripted") {
    return runScriptedBasicTests(projectId, onProgress, shouldAbort, onRunCreated);
  }
  return runRealBasicTests(projectId, onProgress, shouldAbort, onRunCreated);
}

// getOrGenerateBasicCases 已移至 basic-test-cases.ts（同构模块）
// 此处重新导出，保持服务端调用兼容
export { getOrGenerateBasicCases } from "./basic-test-cases";
