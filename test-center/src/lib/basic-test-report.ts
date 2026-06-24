// 基础测试报告 + AI 修复包生成（模块 C4 + D1）
// - 生成基础测试报告：摘要、通过数、失败数、阻断数、失败详情
// - 为每个失败用例生成修复指南包（RepairGuide）
// - 包含给编程 AI 的修复指令（aiInstruction）
// - aiInstruction 优先通过 LLM 动态生成，未配置或调用失败时降级到预写模板

import "server-only";

import {
  getLatestTestRun,
  getTestResults,
  getTestCase,
  getRunIssues,
  saveIssue,
  getProject,
  type TestRun,
  type TestResult,
  type TestCase,
  type Issue,
  type RepairGuide,
  type BasicTestReport,
  type Evidence,
} from "./store";
import { runBasicTests } from "./basic-test-runner";
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

// 生成问题 ID
function genIssueId(): string {
  const num = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `ISSUE-${num}`;
}

// Bug 5 的修复指令（按需求示例格式）
function buildBug5AiInstruction(): string {
  return `# 修复 ISSUE-005：学习进度刷新后丢失

## 当前唯一目标
修复关卡完成后刷新页面进度丢失的问题

## 已确认问题
完成关卡后，Progress 表未更新 status 为 completed

## 复现路径
1. 登录用户
2. 进入 /level/1 答题正确
3. 刷新页面
4. 关卡仍显示为锁定

## 允许修改范围
- src/app/api/level/[id]/answer/route.ts
- src/app/page.tsx（读取进度逻辑）

## 禁止事项
- 不要修改签到相关代码
- 不要修改积分计算逻辑
- 不要重构整体架构

## 必须验证用例
1. 答题正确后 Progress.status 更新为 completed
2. 刷新页面后关卡显示已完成
3. 已完成关卡不可重复答题

## 修复后输出
- 修改的文件列表
- 新增的数据库操作`;
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
        "basic-report",
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
        "basic-report",
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
      "basic-report",
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
          "basic-report",
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
        "basic-report",
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
        "basic-report",
        "judging",
        `LLM 调用失败，降级到预写模板：${input.caseTitle}`,
        { level: "warning" },
      );
    }
    return fallback;
  }
}

// 根据失败用例生成 Issue
async function buildIssueFromFailure(
  projectId: string,
  runId: string,
  tc: TestCase,
  result: TestResult,
): Promise<Issue> {
  // Bug 5 特化处理
  if (tc.id === "BTC-015") {
    const evidences: Evidence[] = [
      {
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "screenshot",
        content:
          "截图描述：刷新后首页关卡列表中，已答对的关卡 1 仍显示「进入」按钮，无「已完成」标识；进度状态为 locked",
      },
      {
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "console",
        content:
          '[Network] GET /api/level 200\n[Response] levels[0].status = "locked"\n[Expected] levels[0].status = "completed"',
      },
      {
        id: `ev_${Math.random().toString(36).slice(2, 10)}`,
        type: "network",
        content:
          "POST /api/level/{levelId}/answer 200 → { correct: true, points: 10 }\n刷新后：GET /api/level 200 → levels[0].status = \"locked\"（应为 completed）",
      },
    ];

    const possibleCauses = [
      "/api/level/[id]/answer 答对后未调用 prisma.progress.upsert 更新当前关卡状态为 completed",
      "答题接口仅增加了用户积分，但未持久化 Progress.status",
      "首页 /api/level 接口读取 Progress 表时未找到 completed 记录，回退为 locked",
    ];
    const impactModules = ["学习进度模块", "关卡解锁", "答题积分路径"];
    const actual =
      "刷新后关卡仍显示为锁定 / 未完成状态，可重复答题，进度未持久化";
    const aiInstruction = await generateFixInstruction(
      buildBug5AiInstruction(),
      {
        caseTitle: "学习进度刷新后丢失",
        caseId: tc.id,
        expected: tc.expectedResult,
        actual,
        reproduceSteps: tc.steps,
        evidences,
        possibleCauses,
        impactModules,
      },
      projectId,
    );

    return {
      id: "ISSUE-005",
      projectId,
      runId,
      testCaseId: tc.id,
      resultId: result.id,
      title: "学习进度刷新后丢失",
      severity: "high",
      impactModules,
      reproduceSteps: tc.steps,
      expected: tc.expectedResult,
      actual,
      evidences,
      possibleCauses,
      fixDirections: [
        "在 /api/level/[id]/answer 答对后，调用 prisma.progress.upsert 将当前关卡 status 更新为 completed，并记录 completedAt",
        "确保 upsert 的 where 条件使用 userId_levelId 唯一约束",
        "验证 /api/level GET 接口能正确返回 completed 状态",
      ],
      aiInstruction,
      prohibitions: [
        "不要修改签到相关代码",
        "不要修改积分计算逻辑",
        "不要重构整体架构",
        "不要修改数据库 Schema",
      ],
      acceptanceCriteria: [
        "答题正确后 Progress.status 更新为 completed",
        "刷新页面后关卡显示已完成",
        "已完成关卡不可重复答题",
        "下一关正确解锁",
      ],
      status: "open",
      retestRounds: 0,
      maxRetestRounds: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // 通用失败用例的兜底 Issue
  const evidences: Evidence[] = result.evidenceIds.length
    ? [
        {
          id: `ev_${Math.random().toString(36).slice(2, 10)}`,
          type: "screenshot",
          content: `截图描述：用例 ${tc.id} 执行失败`,
        },
      ]
    : [];

  const actual = result.actual ?? "实际结果与预期不符";
  const expected = result.expected ?? tc.expectedResult;
  const fallbackInstruction = `# 修复 ${tc.id}：${tc.title}\n\n## 当前唯一目标\n修复用例 ${tc.id} 失败的问题\n\n## 已确认问题\n${actual}\n\n## 复现路径\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## 必须验证用例\n1. ${tc.expectedResult}`;
  const aiInstruction = await generateFixInstruction(fallbackInstruction, {
    caseTitle: tc.title,
    caseId: tc.id,
    expected,
    actual,
    reproduceSteps: tc.steps,
    evidences,
  }, projectId);

  return {
    id: genIssueId(),
    projectId,
    runId,
    testCaseId: tc.id,
    resultId: result.id,
    title: tc.title,
    severity: result.severity,
    impactModules: ["待补充"],
    reproduceSteps: tc.steps,
    expected,
    actual,
    evidences,
    possibleCauses: ["待分析"],
    fixDirections: ["待补充"],
    aiInstruction,
    prohibitions: ["不要修改无关代码"],
    acceptanceCriteria: [tc.expectedResult],
    status: "open",
    retestRounds: 0,
    maxRetestRounds: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Issue → RepairGuide 转换
function issueToGuide(issue: Issue): RepairGuide {
  return {
    issueId: issue.id,
    title: issue.title,
    severity: issue.severity,
    impactModules: issue.impactModules,
    reproduceSteps: issue.reproduceSteps,
    expected: issue.expected,
    actual: issue.actual,
    evidences: issue.evidences,
    possibleCauses: issue.possibleCauses,
    fixDirections: issue.fixDirections,
    aiInstruction: issue.aiInstruction,
    prohibitions: issue.prohibitions,
    acceptanceCriteria: issue.acceptanceCriteria,
  };
}

// 生成基础测试报告
// - 如果已有运行，则基于最近一次运行生成
// - 如果没有运行记录（如前端剧本回放未持久化），自动触发服务端剧本回放
// - 为每个失败用例生成 Issue 与 RepairGuide
export async function generateBasicReport(
  projectId: string,
): Promise<BasicTestReport | undefined> {
  const project = getProject(projectId);
  if (!project) return undefined;

  // 开启新的 AI 思考会话（生成报告时的思考过程）
  startAIThinkingSession(projectId, "basic-report");

  let run = getLatestTestRun(projectId, "basic");

  // 如果没有运行记录，自动触发服务端剧本回放生成持久化结果
  // 这解决了前端剧本回放不持久化导致报告页无法生成报告的问题
  if (!run) {
    try {
      await runBasicTests(projectId, "scripted");
      run = getLatestTestRun(projectId, "basic");
    } catch (err) {
      console.error("[basic-report] 自动触发剧本回放失败:", err);
    }
  }

  if (!run) return undefined;

  const results = getTestResults(run.id);

  // 收集失败结果
  const failedResults = results.filter(
    (r) => r.status === "fail" || r.status === "block",
  );

  // 检查是否已生成过 Issue（避免重复生成）
  const existingIssues = getRunIssues(run.id);
  const existingIssueMap = new Map(
    existingIssues.map((i) => [i.testCaseId, i]),
  );

  // 为新的失败用例生成 Issue
  const issues: Issue[] = [];
  for (const result of failedResults) {
    const tc = getTestCase(result.testCaseId);
    if (!tc) continue;

    const existing = existingIssueMap.get(tc.id);
    if (existing) {
      issues.push(existing);
    } else {
      const issue = await buildIssueFromFailure(
        projectId,
        run.id,
        tc,
        result,
      );
      saveIssue(issue);
      issues.push(issue);
    }
  }

  // 合并已存在的 Issue（保持顺序：失败用例优先）
  for (const existing of existingIssues) {
    if (!issues.find((i) => i.id === existing.id)) {
      issues.push(existing);
    }
  }

  const repairGuides = issues.map(issueToGuide);

  // 统计非阻断失败数
  const nonBlockingFailed = failedResults.filter((r) => {
    const tc = getTestCase(r.testCaseId);
    return tc?.blockingLevel === "non_blocking";
  }).length;

  const passRate =
    run.total > 0
      ? Math.round((run.passed / run.total) * 100)
      : 0;

  return {
    projectId,
    runId: run.id,
    total: run.total,
    passed: run.passed,
    failed: run.failed,
    blocked: run.blocked,
    nonBlockingFailed,
    passRate,
    issues,
    repairGuides,
    generatedAt: new Date().toISOString(),
  };
}

// 获取报告（不重新生成，仅读取已有数据）
export async function getBasicReport(
  projectId: string,
): Promise<BasicTestReport | undefined> {
  return generateBasicReport(projectId);
}
