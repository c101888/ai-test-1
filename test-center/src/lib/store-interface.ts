// 存储层抽象接口
// 抽取 store.ts 的所有导出函数签名，形成统一接口 IStore
// 目的：为未来无损迁移到数据库做好准备
// 当前 store.ts 是直接实现（globalThis + localStorage），未显式 implements IStore
// 未来可编写 DatabaseStore implements IStore 实现数据库版本，实现平滑切换

// 仅类型导入，不引入运行时依赖
import type {
  Project,
  AnalysisModel,
  ProjectStatus,
  TestCase,
  TestCaseType,
  TestRun,
  TestResult,
  Issue,
  AdvancedTestRun,
  AdvancedPathResult,
  AdvancedIssue,
  RegressionCase,
  AdvancedRetestResult,
  FinalQualityReport,
} from "./store";

// 存储层统一接口
// 所有方法签名与 store.ts 的实际导出函数完全一致
export interface IStore {
  // -------------------- 项目相关 --------------------

  // 创建项目
  createProject(
    input: Omit<
      Project,
      "id" | "createdAt" | "updatedAt" | "status" | "issuesFound"
    > & Partial<Pick<Project, "status" | "issuesFound">>,
  ): Project;

  // 获取单个项目
  getProject(id: string): Project | undefined;

  // 存储完整项目对象（用于客户端与服务端同步）
  putProject(project: Project): void;

  // 获取项目列表（按更新时间倒序）
  listProjects(): Project[];

  // 更新项目
  updateProject(id: string, patch: Partial<Project>): Project | undefined;

  // -------------------- 分析相关 --------------------

  // 获取项目的分析模型
  getProjectModel(id: string): AnalysisModel | undefined;

  // 计算接入完整度（百分比）
  calcCompleteness(project: {
    codeUploaded: boolean;
    docUploaded: boolean;
    localPath?: string;
    docs?: string;
    testUrl: string;
    startCommand: string;
    testAccount: string;
    adminAccount: string;
  }): number;

  // 判断是否具备动态测试条件
  canRunDynamicTest(project: {
    testUrl: string;
    testAccount: string;
  }): boolean;

  // 根据状态获取下一步跳转路径
  getNextRoute(id: string, status: ProjectStatus): string;

  // -------------------- 测试用例相关 --------------------

  // 保存测试用例（批量）
  saveTestCases(cases: TestCase[]): void;

  // 获取项目的所有测试用例
  getTestCases(projectId: string): TestCase[];

  // 获取单个测试用例
  getTestCase(id: string): TestCase | undefined;

  // 更新测试用例状态
  updateTestCaseStatus(
    id: string,
    status: TestCase["status"],
  ): TestCase | undefined;

  // -------------------- 测试运行相关 --------------------

  // 创建测试运行
  createTestRun(
    projectId: string,
    type: TestCaseType,
    mode: "scripted" | "real",
    total: number,
  ): TestRun;

  // 更新测试运行
  updateTestRun(id: string, patch: Partial<TestRun>): TestRun | undefined;

  // 获取测试运行
  getTestRun(id: string): TestRun | undefined;

  // 获取项目的最近一次测试运行
  getLatestTestRun(
    projectId: string,
    type: TestCaseType,
  ): TestRun | undefined;

  // -------------------- 测试结果相关 --------------------

  // 保存测试结果
  saveTestResult(result: TestResult): TestResult;

  // 获取一次运行的所有结果
  getTestResults(runId: string): TestResult[];

  // -------------------- 问题相关 --------------------

  // 保存问题
  saveIssue(issue: Issue): Issue;

  // 获取单个问题
  getIssue(id: string): Issue | undefined;

  // 获取项目的所有问题
  getProjectIssues(projectId: string): Issue[];

  // 获取一次运行的所有问题
  getRunIssues(runId: string): Issue[];

  // 更新问题
  updateIssue(id: string, patch: Partial<Issue>): Issue | undefined;

  // -------------------- 项目状态流转辅助 --------------------

  // 标记项目进入基础测试阶段
  markBasicTesting(projectId: string): void;

  // 标记项目基础测试完成
  markBasicDone(projectId: string): void;

  // 标记项目进入高级测试阶段
  markAdvancedTesting(projectId: string): void;

  // 标记项目高级测试完成
  markAdvancedDone(projectId: string): void;

  // 标记项目最终验收完成
  markCompleted(projectId: string): void;

  // -------------------- 高级测试运行相关 --------------------

  // 创建高级测试运行
  createAdvancedTestRun(
    projectId: string,
    mode: "scripted" | "real",
    total: number,
  ): AdvancedTestRun;

  // 更新高级测试运行
  updateAdvancedTestRun(
    id: string,
    patch: Partial<AdvancedTestRun>,
  ): AdvancedTestRun | undefined;

  // 获取高级测试运行
  getAdvancedTestRun(id: string): AdvancedTestRun | undefined;

  // 获取项目的最近一次高级测试运行
  getLatestAdvancedTestRun(projectId: string): AdvancedTestRun | undefined;

  // -------------------- 高级测试结果相关 --------------------

  // 保存高级测试结果
  saveAdvancedTestResult(result: AdvancedPathResult): AdvancedPathResult;

  // 获取一次高级运行的所有结果
  getAdvancedTestResults(runId: string): AdvancedPathResult[];

  // -------------------- 高级测试问题相关 --------------------

  // 保存高级测试问题
  saveAdvancedIssue(issue: AdvancedIssue): AdvancedIssue;

  // 获取单个高级测试问题
  getAdvancedIssue(id: string): AdvancedIssue | undefined;

  // 获取项目的所有高级测试问题
  getProjectAdvancedIssues(projectId: string): AdvancedIssue[];

  // 获取一次高级运行的所有问题
  getRunAdvancedIssues(runId: string): AdvancedIssue[];

  // 更新高级测试问题
  updateAdvancedIssue(
    id: string,
    patch: Partial<AdvancedIssue>,
  ): AdvancedIssue | undefined;

  // -------------------- 防回归用例相关 --------------------

  // 保存防回归用例（批量）
  saveRegressionCases(cases: RegressionCase[]): void;

  // 获取项目的所有防回归用例
  getProjectRegressionCases(projectId: string): RegressionCase[];

  // -------------------- 三级回归复测结果相关 --------------------

  // 保存三级回归复测结果
  saveAdvancedRetestResult(
    projectId: string,
    result: AdvancedRetestResult,
  ): void;

  // 获取三级回归复测结果
  getAdvancedRetestResult(projectId: string): AdvancedRetestResult | undefined;

  // -------------------- 最终质量结论相关 --------------------

  // 保存最终质量结论
  saveFinalReport(projectId: string, report: FinalQualityReport): void;

  // 获取最终质量结论
  getFinalReport(projectId: string): FinalQualityReport | undefined;
}
