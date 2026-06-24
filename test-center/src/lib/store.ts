// 项目数据存储：内存（globalThis）+ localStorage（客户端）+ 文件持久化（服务端）
// 服务端：globalThis 缓存 + .data/projects.json 持久化，重启不丢失
// 客户端：localStorage 持久化

// 引入解析结果类型（仅类型导入，不引入运行时依赖）
import type { ParsedProjectInfo } from "./project-parser";

// 项目状态枚举（模块化平级架构：分析后可任意选择 6 个模块测试）
export type ProjectStatus =
  | "draft" // 草稿
  | "analyzing" // 分析中
  | "analyzed" // 分析完成（可进入模块选择中心）
  | "completed"; // 最终验收完成

// 测试模块类型（6 个平级模块）
export type TestModuleType =
  | "ui" // UI 测试
  | "functional" // 功能测试（原基础测试）
  | "business" // 高级业务测试（原高级测试，核心）
  | "security" // 入侵安全测试
  | "database" // 数据库测试
  | "concurrency"; // 并发测试

// 模块状态
export type ModuleStatus = "not_started" | "testing" | "done";

// 6 个模块的状态映射
export interface ModuleStatusMap {
  ui: ModuleStatus;
  functional: ModuleStatus;
  business: ModuleStatus;
  security: ModuleStatus;
  database: ModuleStatus;
  concurrency: ModuleStatus;
}

// 创建默认模块状态（全部 not_started）
export function createDefaultModuleStatuses(): ModuleStatusMap {
  return {
    ui: "not_started",
    functional: "not_started",
    business: "not_started",
    security: "not_started",
    database: "not_started",
    concurrency: "not_started",
  };
}

// 旧状态值到新状态的映射（向后兼容）
export function migrateLegacyStatus(status: string): ProjectStatus {
  switch (status) {
    case "basic_testing":
    case "basic_done":
    case "advanced_testing":
    case "advanced_done":
      return "analyzed";
    default:
      return status as ProjectStatus;
  }
}

// 来源标记：结论的依据来源
export type SourceType =
  | "doc" // 文档明确
  | "code" // 代码确认
  | "runtime" // 运行确认
  | "ai" // AI 推断
  | "unknown"; // 未知

// 置信度
export type Confidence = "high" | "medium" | "low";

// 风险等级
export type RiskLevel = "low" | "medium" | "high" | "critical";

// 三方对照条目
export interface CrossCheckItem {
  feature: string; // 功能点
  doc: string; // 文档侧描述
  code: string; // 代码侧描述
  runtime: string; // 运行侧描述
  conclusion: string; // 结论
  source: SourceType; // 来源
  confidence: Confidence; // 置信度
}

// 风险条目
export interface RiskItem {
  area: string; // 风险区域
  level: RiskLevel; // 风险等级
  reason: string; // 风险原因
  priority: string; // 测试优先级
}

// 状态机流转
export interface StateTransition {
  subject: string; // 状态主体（如：签到、关卡）
  states: string[]; // 状态列表
  flows: { from: string; to: string; event: string }[]; // 合法流转
  illegalFlows: { from: string; to: string; note: string }[]; // 非法流转
}

// 数据关系
export interface DataRelation {
  from: string; // 主体
  to: string; // 客体
  type: string; // 关系类型（如：1:N）
}

// 数据对象
export interface DataObject {
  name: string;
  description: string;
}

// 角色权限
export interface RolePermission {
  role: string; // 角色名
  pages: string[]; // 可访问页面
  dataScope: string; // 数据归属
}

// 功能节点（树形）
export interface FeatureNode {
  name: string; // 功能名
  risk?: RiskLevel; // 风险等级（叶子节点）
  children?: FeatureNode[]; // 子功能
}

// 项目概况
export interface ProjectOverview {
  projectType: string; // 项目类型
  targetUser: string; // 面向用户
  coreFunctions: string[]; // 核心功能
  businessObjects: string[]; // 核心业务对象
  techStack: string[]; // 技术栈
  database: string; // 数据库
  apis: string[]; // API 列表
  authMethod: string; // 登录方式
  permissionSystem: string; // 权限体系
}

// 完整分析模型（B1-B7）
export interface AnalysisModel {
  overview: ProjectOverview; // B1 项目概况
  featureMap: FeatureNode[]; // B2 功能地图
  roleMap: RolePermission[]; // B3 角色权限地图
  stateMap: StateTransition[]; // B4 状态机地图
  dataMap: { objects: DataObject[]; relations: DataRelation[] }; // B5 数据地图
  riskMap: RiskItem[]; // B6 风险地图
  crossCheck: CrossCheckItem[]; // B7 三方对照
  consistencyRisks?: string[]; // 一致性风险（数据地图补充）
}

// 项目数据
export interface Project {
  id: string;
  name: string;
  description: string;
  type: string; // 项目类型
  codeUploaded: boolean; // 是否上传代码
  docUploaded: boolean; // 是否上传文档
  testUrl: string; // 测试环境地址
  startCommand: string; // 启动命令
  testAccount: string; // 测试账号
  adminAccount: string; // 管理员账号
  isDemo: boolean; // 是否为演示项目
  status: ProjectStatus;
  moduleStatuses?: ModuleStatusMap; // 6 个模块的独立状态（向后兼容：undefined 时按需初始化）
  analysisModel?: AnalysisModel; // 分析结果
  issuesFound: number; // 发现问题数
  localPath?: string; // 本地项目路径
  parsedInfo?: ParsedProjectInfo; // 解析结果
  docs?: string; // 上传的文档文本
  codePackagePath?: string; // 上传代码包的服务端保存路径
  docFilePath?: string; // 上传文档的服务端保存路径
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "test-center:projects";

// ============================================================
// 服务端文件持久化（.data/projects.json）
// 使用 eval("require") 动态加载 Node.js 模块，避免客户端构建引入
// ============================================================
let _dynamicRequire: NodeRequire | null = null;
function getDynamicRequire(): NodeRequire {
  if (_dynamicRequire) return _dynamicRequire;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  _dynamicRequire = eval("require") as NodeRequire;
  return _dynamicRequire;
}

function isServerSide(): boolean {
  return typeof window === "undefined";
}

// 服务端文件路径
function getProjectsFilePath(): string {
  const path = getDynamicRequire()("path");
  return path.join(process.cwd(), ".data", "projects.json");
}

// 从文件加载项目到 globalThis（仅服务端，首次访问时调用）
function loadProjectsFromFile(): void {
  if (!isServerSide()) return;
  const g = globalThis as unknown as { __tcProjects?: Map<string, Project>; __tcProjectsLoaded?: boolean };
  if (g.__tcProjectsLoaded) return; // 已加载过
  g.__tcProjectsLoaded = true;
  try {
    const fs = getDynamicRequire()("fs");
    const filePath = getProjectsFilePath();
    if (!fs.existsSync(filePath)) {
      if (!g.__tcProjects) g.__tcProjects = new Map();
      return;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw) as [string, Project][];
    g.__tcProjects = new Map(arr);
  } catch (err) {
    console.error("[store] 从文件加载项目失败:", err);
    if (!g.__tcProjects) g.__tcProjects = new Map();
  }
  // 启动时状态修复：修复进程崩溃后残留的中间状态
  // 触发 runs/advRuns/issues 的加载（getMap 内部调用 loadMapFromFile 会修复残留状态）
  repairStaleState();
}

// 将 globalThis 中的项目持久化到文件（仅服务端）
function persistProjectsToFile(): void {
  if (!isServerSide()) return;
  try {
    const fs = getDynamicRequire()("fs");
    const path = getDynamicRequire()("path");
    const filePath = getProjectsFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const g = globalThis as unknown as { __tcProjects?: Map<string, Project> };
    const arr = Array.from((g.__tcProjects ?? new Map()).entries());
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error("[store] 持久化项目到文件失败:", err);
  }
}

// 获取存储 Map（服务端用 globalThis + 文件，客户端用 localStorage）
function getStoreMap(): Map<string, Project> {
  if (typeof window !== "undefined") {
    // 客户端：从 localStorage 读取
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const entries = JSON.parse(raw) as [string, Project][];
        return new Map(entries);
      }
    } catch {
      // 解析失败时忽略，使用空 Map
    }
    return new Map();
  }
  // 服务端：首次访问时从文件加载，后续使用 globalThis 缓存
  loadProjectsFromFile();
  const g = globalThis as unknown as { __tcProjects?: Map<string, Project> };
  if (!g.__tcProjects) {
    g.__tcProjects = new Map();
  }
  return g.__tcProjects;
}

// 保存存储 Map
function saveStoreMap(map: Map<string, Project>) {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(map.entries())),
      );
    } catch {
      // 写入失败时忽略
    }
    return;
  }
  // 服务端：globalThis 上的 Map 已通过引用更新，同步持久化到文件
  persistProjectsToFile();
}

// 生成项目 ID
function genId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 创建项目
export function createProject(
  input: Omit<Project, "id" | "createdAt" | "updatedAt" | "status" | "issuesFound"> &
    Partial<Pick<Project, "status" | "issuesFound">>,
): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: genId(),
    name: input.name,
    description: input.description,
    type: input.type,
    codeUploaded: input.codeUploaded,
    docUploaded: input.docUploaded,
    testUrl: input.testUrl,
    startCommand: input.startCommand,
    testAccount: input.testAccount,
    adminAccount: input.adminAccount,
    isDemo: input.isDemo ?? false,
    status: input.status ?? "draft",
    analysisModel: input.analysisModel,
    issuesFound: input.issuesFound ?? 0,
    localPath: input.localPath,
    parsedInfo: input.parsedInfo,
    docs: input.docs,
    codePackagePath: input.codePackagePath,
    docFilePath: input.docFilePath,
    createdAt: now,
    updatedAt: now,
  };
  const map = getStoreMap();
  map.set(project.id, project);
  saveStoreMap(map);
  return project;
}

// 获取单个项目
export function getProject(id: string): Project | undefined {
  return getStoreMap().get(id);
}

// 存储完整项目对象（用于客户端与服务端同步）
// 当项目在服务端创建后，需要同步到客户端 localStorage，或反向同步
export function putProject(project: Project): void {
  const map = getStoreMap();
  map.set(project.id, project);
  saveStoreMap(map);
}

// 获取项目列表（按更新时间倒序）
export function listProjects(): Project[] {
  return Array.from(getStoreMap().values()).sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

// 更新项目
export function updateProject(
  id: string,
  patch: Partial<Project>,
): Project | undefined {
  const map = getStoreMap();
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: Project = {
    ...existing,
    ...patch,
    id: existing.id, // ID 不可变
    createdAt: existing.createdAt, // 创建时间不可变
    updatedAt: new Date().toISOString(),
  };
  map.set(id, updated);
  saveStoreMap(map);
  return updated;
}

// 删除项目及其所有关联数据（测试用例、运行记录、结果、问题、高级测试、回归用例、复测、最终报告）
export function deleteProject(id: string): boolean {
  const map = getStoreMap();
  if (!map.has(id)) return false;
  map.delete(id);
  saveStoreMap(map);

  // 清理基础测试关联数据
  // 1. 测试用例
  const casesMap = getMap<TestCase>(CASES_KEY, "__tcCases");
  for (const [caseId, tc] of casesMap.entries()) {
    if (tc.projectId === id) casesMap.delete(caseId);
  }
  saveMap(CASES_KEY, casesMap);

  // 2. 测试运行 + 结果 + 问题（按 runId 关联）
  const runsMap = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  const resultsMap = getMap<TestResult>(RESULTS_KEY, "__tcResults");
  const issuesMap = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  for (const [runId, run] of runsMap.entries()) {
    if (run.projectId === id) {
      runsMap.delete(runId);
      // 删除该 run 的所有结果
      for (const [resId, res] of resultsMap.entries()) {
        if (res.runId === runId) resultsMap.delete(resId);
      }
      // 删除该 run 的所有问题
      for (const [issId, iss] of issuesMap.entries()) {
        if (iss.runId === runId) issuesMap.delete(issId);
      }
    }
  }
  saveMap(RUNS_KEY, runsMap);
  saveMap(RESULTS_KEY, resultsMap);
  saveMap(ISSUES_KEY, issuesMap);

  // 3. 高级测试关联数据
  const advRunsMap = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  const advResultsMap = getMap<AdvancedPathResult>(ADV_RESULTS_KEY, "__tcAdvResults");
  const advIssuesMap = getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues");
  for (const [runId, run] of advRunsMap.entries()) {
    if (run.projectId === id) {
      advRunsMap.delete(runId);
      for (const [resId, res] of advResultsMap.entries()) {
        if (res.runId === runId) advResultsMap.delete(resId);
      }
      for (const [issId, iss] of advIssuesMap.entries()) {
        if (iss.runId === runId) advIssuesMap.delete(issId);
      }
    }
  }
  saveMap(ADV_RUNS_KEY, advRunsMap);
  saveMap(ADV_RESULTS_KEY, advResultsMap);
  saveMap(ADV_ISSUES_KEY, advIssuesMap);

  // 4. 回归用例
  const regCasesMap = getMap<RegressionCase>(REGRESSION_CASES_KEY, "__tcRegCases");
  for (const [caseId, rc] of regCasesMap.entries()) {
    if (rc.projectId === id) regCasesMap.delete(caseId);
  }
  saveMap(REGRESSION_CASES_KEY, regCasesMap);

  // 5. 高级复测结果
  const advRetestMap = getMap<AdvancedRetestResult>(ADV_RETEST_KEY, "__tcAdvRetest");
  for (const [retestId, ar] of advRetestMap.entries()) {
    if (ar.projectId === id) advRetestMap.delete(retestId);
  }
  saveMap(ADV_RETEST_KEY, advRetestMap);

  // 6. 最终质量报告
  const finalReportMap = getMap<FinalQualityReport>(FINAL_REPORT_KEY, "__tcFinalReport");
  finalReportMap.delete(id);
  saveMap(FINAL_REPORT_KEY, finalReportMap);

  return true;
}

// 获取项目的分析模型
export function getProjectModel(id: string): AnalysisModel | undefined {
  return getStoreMap().get(id)?.analysisModel;
}

// 计算接入完整度（百分比）
// 本地路径或上传代码 = 50%，测试地址 = 20%，文档 = 15%，启动说明 = 10%，测试账号 = 5%
export function calcCompleteness(project: {
  codeUploaded: boolean;
  docUploaded: boolean;
  localPath?: string;
  docs?: string;
  testUrl: string;
  startCommand: string;
  testAccount: string;
  adminAccount: string;
}): number {
  let score = 0;
  // 本地路径或上传代码 = 50%
  if (project.localPath?.trim() || project.codeUploaded) score += 50;
  // 测试地址 = 20%
  if (project.testUrl.trim()) score += 20;
  // 文档（上传文档或文档文本） = 15%
  if (project.docUploaded || project.docs?.trim()) score += 15;
  // 启动说明 = 10%
  if (project.startCommand.trim()) score += 10;
  // 测试账号 = 5%
  if (project.testAccount.trim()) score += 5;
  return score;
}

// 判断是否具备动态测试条件
export function canRunDynamicTest(project: {
  testUrl: string;
  testAccount: string;
}): boolean {
  return Boolean(project.testUrl.trim() && project.testAccount.trim());
}

// 状态展示信息：徽章严重等级 + 中文标签
type BadgeSeverity = "critical" | "warning" | "info" | "accent" | "pass";

export const statusDisplay: Record<
  ProjectStatus,
  { label: string; severity: BadgeSeverity; stage: string; next: string }
> = {
  draft: {
    label: "草稿",
    severity: "info",
    stage: "项目接入",
    next: "去分析",
  },
  analyzing: {
    label: "分析中",
    severity: "warning",
    stage: "智能分析",
    next: "查看分析结果",
  },
  analyzed: {
    label: "分析完成",
    severity: "accent",
    stage: "智能分析",
    next: "模块选择中心",
  },
  completed: {
    label: "已验收",
    severity: "pass",
    stage: "最终验收",
    next: "查看报告",
  },
};

// 模块展示信息
export const moduleDisplay: Record<
  TestModuleType,
  { label: string; description: string; icon: string; available: boolean }
> = {
  ui: {
    label: "UI 测试",
    description: "布局合理性、一致性、美观性、响应式、文字截断、边界溢出等多终端 UI 检测",
    icon: "Monitor",
    available: false, // Phase 3 实现
  },
  functional: {
    label: "功能测试",
    description: "AI 全栈代码审计 + 运行时功能测试，检测代码错误、功能错误、功能边界",
    icon: "Code",
    available: false, // Phase 2 实现
  },
  business: {
    label: "高级业务测试",
    description: "AI 根据项目业务功能动态生成业务 bug 测试清单，逐项 Playwright 执行（核心模块）",
    icon: "Sparkles",
    available: true, // Phase 1 实现
  },
  security: {
    label: "入侵安全测试",
    description: "AI 分析项目后列出安全漏洞和注入测试清单，覆盖 SQL 注入/XSS/CSRF/路径遍历等",
    icon: "Shield",
    available: false, // Phase 4 实现
  },
  database: {
    label: "数据库测试",
    description: "数据库方案合理性、字段合理性、冗余能力、业务 bug、承载能力测试",
    icon: "Database",
    available: false, // Phase 5 实现
  },
  concurrency: {
    label: "并发测试",
    description: "模拟并发访问测试最大承载能力（仅支持公网部署项目）",
    icon: "Zap",
    available: false, // Phase 6 实现
  },
};

// 根据状态获取下一步跳转路径
export function getNextRoute(id: string, status: ProjectStatus): string {
  switch (status) {
    case "draft":
    case "analyzing":
      return `/projects/${id}/analysis`;
    case "analyzed":
      return `/projects/${id}/modules`; // 模块选择中心
    case "completed":
      return `/projects/${id}/final`;
    default:
      return `/projects/${id}/analysis`;
  }
}

// 获取模块的路由前缀
export function getModuleRoutePrefix(module: TestModuleType): string {
  switch (module) {
    case "ui":
      return "ui-test";
    case "functional":
      return "functional";
    case "business":
      return "advanced"; // 高级业务测试复用原 advanced 路由
    case "security":
      return "security-test";
    case "database":
      return "database-test";
    case "concurrency":
      return "concurrency-test";
  }
}

// 获取模块状态（向后兼容：无 moduleStatuses 时按旧 status 推导）
export function getModuleStatus(project: Project, module: TestModuleType): ModuleStatus {
  if (project.moduleStatuses) {
    return project.moduleStatuses[module];
  }
  // 向后兼容：旧项目无 moduleStatuses，根据旧 status 推导
  const legacyStatus = project.status as string;
  if (legacyStatus === "basic_testing" || legacyStatus === "basic_done") {
    if (module === "functional") return legacyStatus === "basic_done" ? "done" : "testing";
  }
  if (legacyStatus === "advanced_testing" || legacyStatus === "advanced_done") {
    if (module === "business") return legacyStatus === "advanced_done" ? "done" : "testing";
  }
  return "not_started";
}

// 设置模块状态
export function setModuleStatus(projectId: string, module: TestModuleType, status: ModuleStatus): void {
  const project = getProject(projectId);
  if (!project) return;
  const moduleStatuses = project.moduleStatuses ?? createDefaultModuleStatuses();
  moduleStatuses[module] = status;
  updateProject(projectId, { moduleStatuses });
}

// 检查模块是否可用（并发测试需公网地址）
export function isModuleAvailable(project: Project, module: TestModuleType): boolean {
  if (!moduleDisplay[module].available) return false;
  if (module === "concurrency") {
    // 并发测试仅支持公网部署项目
    const url = project.testUrl?.trim() ?? "";
    if (!url) return false;
    // 排除本地地址
    if (/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(url)) {
      return false;
    }
  }
  return true;
}

// 统计已完成模块数
export function countCompletedModules(project: Project): number {
  if (!project.moduleStatuses) return 0;
  return Object.values(project.moduleStatuses).filter((s) => s === "done").length;
}

// ============================================================
// 基础测试模块数据模型（模块 C + D）
// ============================================================

// 测试用例类型
export type TestCaseType = "basic" | "advanced";

// 用例优先级
export type TestCasePriority = "P0" | "P1" | "P2";

// 阻断等级：blocking 表示失败会阻断对应模块；non_blocking 仅记录
export type BlockingLevel = "blocking" | "non_blocking";

// 用例分类（6 大类）
export type BasicTestCategory =
  | "env" // 环境与启动
  | "page" // 页面与导航
  | "happy" // 核心正常路径
  | "form" // 表单与输入
  | "persistence" // 数据持久化
  | "permission"; // 基础权限

// 测试用例
export interface TestCase {
  id: string;
  projectId: string;
  type: TestCaseType;
  title: string;
  objective: string; // 测试目标
  preconditions: string[]; // 前置条件
  steps: string[]; // 执行步骤
  expectedResult: string; // 预期结果
  priority: TestCasePriority;
  blockingLevel: BlockingLevel;
  category: BasicTestCategory; // 分类（仅基础测试用例使用）
  source: SourceType; // 来源
  status: "pending" | "pass" | "fail" | "block" | "skip"; // 当前状态
}

// 执行结果状态
export type ResultStatus = "pass" | "fail" | "block" | "skip";

// 证据类型
export interface Evidence {
  id: string;
  type: "screenshot" | "console" | "network"; // 截图描述 / Console 日志 / 网络请求
  content: string;
}

// 单个用例的执行结果
export interface TestResult {
  id: string;
  runId: string;
  testCaseId: string;
  status: ResultStatus;
  failedStep?: string; // 失败步骤描述
  expected?: string; // 预期结果（失败时记录）
  actual?: string; // 实际结果（失败时记录）
  evidenceIds: string[]; // 关联证据 ID
  severity: RiskLevel; // 严重等级
  confidence: Confidence; // 置信度
  impactScope: string; // 影响范围
  executedAt: string; // 执行时间
}

// 一次测试运行
export interface TestRun {
  id: string;
  projectId: string;
  type: TestCaseType;
  mode: "scripted" | "real"; // 剧本回放 / 真实执行
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  skipped: number;
  status: "running" | "done" | "failed";
  error?: string; // 失败原因（status=failed 时）
  startedAt: string;
  finishedAt?: string;
  resultIds: string[]; // 关联结果 ID
}

// 问题状态
export type IssueStatus =
  | "open" // 待修复
  | "fixing" // 修复中
  | "retesting" // 复测中
  | "fixed" // 已修复
  | "wont_fix"; // 不修复

// 问题（由失败用例生成）
export interface Issue {
  id: string;
  projectId: string;
  runId: string;
  testCaseId: string;
  resultId: string;
  title: string;
  severity: RiskLevel;
  impactModules: string[]; // 影响模块
  reproduceSteps: string[]; // 复现步骤
  expected: string;
  actual: string;
  evidences: Evidence[];
  possibleCauses: string[]; // 可能原因
  fixDirections: string[]; // 修复方向
  aiInstruction: string; // 给编程 AI 的修复指令
  prohibitions: string[]; // 禁止事项
  acceptanceCriteria: string[]; // 修复后验收标准
  status: IssueStatus;
  retestRounds: number; // 已复测轮数
  maxRetestRounds: number; // 最大复测轮数
  createdAt: string;
  updatedAt: string;
}

// 修复指南包（聚合视图，便于页面渲染）
export interface RepairGuide {
  issueId: string;
  title: string;
  severity: RiskLevel;
  impactModules: string[];
  reproduceSteps: string[];
  expected: string;
  actual: string;
  evidences: Evidence[];
  possibleCauses: string[];
  fixDirections: string[];
  aiInstruction: string;
  prohibitions: string[];
  acceptanceCriteria: string[];
}

// 基础测试报告
export interface BasicTestReport {
  projectId: string;
  runId: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  nonBlockingFailed: number; // 非阻断失败数
  passRate: number; // 通过率
  issues: Issue[];
  repairGuides: RepairGuide[];
  generatedAt: string;
}

// ============================================================
// 测试运行 / 结果 / 问题 / 修复指南 存储
// 使用与项目存储一致的双模式：globalThis（服务端）+ localStorage（客户端）
// ============================================================

const RUNS_KEY = "test-center:runs";
const RESULTS_KEY = "test-center:results";
const ISSUES_KEY = "test-center:issues";
const CASES_KEY = "test-center:cases";

// ============================================================
// 通用 Map 存储：服务端用 globalThis + 文件持久化，客户端用 localStorage
// 文件持久化：每个数据类型对应 .data/{name}.json，服务端重启后自动恢复
// 后续迁入持久化数据库时，只需替换 getMap/saveMap 的实现
// ============================================================

// 服务端文件持久化：从文件加载到 globalThis（仅服务端，首次访问时调用）
function loadMapFromFile<T>(
  globalKey: string,
  fileName: string,
): void {
  if (!isServerSide()) return;
  const g = globalThis as unknown as Record<
    string,
    { map: Map<string, T>; loaded?: boolean } | undefined
  >;
  // 兼容旧格式：如果 globalThis 上已存在旧格式（直接是 Map），重置为新格式
  if (g[globalKey] instanceof Map) {
    const oldMap = g[globalKey] as unknown as Map<string, T>;
    g[globalKey] = { map: oldMap, loaded: false };
  }
  if (!g[globalKey]) {
    g[globalKey] = { map: new Map() };
  }
  if (g[globalKey]!.loaded) return;
  g[globalKey]!.loaded = true;
  try {
    const fs = getDynamicRequire()("fs");
    const path = getDynamicRequire()("path");
    const filePath = path.join(process.cwd(), ".data", fileName);
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf8");
    const arr = JSON.parse(raw) as [string, T][];
    g[globalKey]!.map = new Map(arr);
  } catch (err) {
    console.error(`[store] 从文件加载 ${fileName} 失败:`, err);
  }
  // 启动时状态修复：修复进程崩溃后残留的中间状态
  if (repairStaleMapState<T>(globalKey, g[globalKey]!.map)) {
    persistMapToFile<T>(globalKey, fileName);
  }
}

// 服务端文件持久化：将 globalThis 中的 Map 写入文件
function persistMapToFile<T>(
  globalKey: string,
  fileName: string,
): void {
  if (!isServerSide()) return;
  try {
    const fs = getDynamicRequire()("fs");
    const path = getDynamicRequire()("path");
    const filePath = path.join(process.cwd(), ".data", fileName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const g = globalThis as unknown as Record<
      string,
      { map: Map<string, T> } | undefined
    >;
    const map = g[globalKey]?.map ?? new Map();
    const arr = Array.from(map.entries());
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf8");
  } catch (err) {
    console.error(`[store] 持久化 ${fileName} 到文件失败:`, err);
  }
}

// 数据类型 → 文件名映射（用于文件持久化）
const MAP_FILE_NAMES: Record<string, string> = {
  __tcCases: "cases.json",
  __tcRuns: "runs.json",
  __tcResults: "results.json",
  __tcIssues: "issues.json",
  __tcAdvRuns: "adv-runs.json",
  __tcAdvResults: "adv-results.json",
  __tcAdvIssues: "adv-issues.json",
  __tcRegCases: "regression-cases.json",
  __tcAdvRetest: "adv-retest.json",
  __tcFinalReport: "final-report.json",
};

// 通用 Map 存储：服务端用 globalThis + 文件持久化，客户端用 localStorage
function getMap<T>(key: string, globalKey: string): Map<string, T> {
  if (typeof window !== "undefined") {
    // 客户端：从 localStorage 读取
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const entries = JSON.parse(raw) as [string, T][];
        return new Map(entries);
      }
    } catch {
      // 解析失败时忽略
    }
    return new Map();
  }
  // 服务端：首次访问时从文件加载，后续使用 globalThis 缓存
  loadMapFromFile<T>(globalKey, MAP_FILE_NAMES[globalKey] ?? `${globalKey}.json`);
  const g = globalThis as unknown as Record<
    string,
    { map: Map<string, T> } | undefined
  >;
  if (!g[globalKey]) {
    g[globalKey] = { map: new Map() };
  }
  return g[globalKey]!.map;
}

function saveMap<T>(key: string, map: Map<string, T>): void {
  if (typeof window !== "undefined") {
    // 客户端：写入 localStorage
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify(Array.from(map.entries())),
      );
    } catch {
      // 写入失败时忽略
    }
    return;
  }
  // 服务端：globalThis 上的 Map 已通过引用更新，同步持久化到文件
  // 通过 globalKey 反查文件名
  for (const [gKey, fileName] of Object.entries(MAP_FILE_NAMES)) {
    const g = globalThis as unknown as Record<
      string,
      { map: Map<string, T> } | undefined
    >;
    if (g[gKey]?.map === map) {
      persistMapToFile<T>(gKey, fileName);
      return;
    }
  }
  // 兜底：遍历所有已知 globalKey 持久化（确保不遗漏）
  // 这种情况理论上不会发生，因为 map 总是从 getMap 返回的引用
}

// 启动时状态修复：修复单个 Map 中的残留状态
// 返回 true 表示有数据被修复（需要持久化）
function repairStaleMapState<T>(
  globalKey: string,
  map: Map<string, T>,
): boolean {
  let repaired = false;
  if (globalKey === "__tcRuns") {
    // TestRun: running → failed
    for (const [, value] of map.entries()) {
      const run = value as unknown as TestRun;
      if (run.status === "running") {
        run.status = "failed";
        run.error = "进程重启时未完成";
        run.finishedAt = new Date().toISOString();
        repaired = true;
      }
    }
  } else if (globalKey === "__tcAdvRuns") {
    // AdvancedTestRun: running → failed
    for (const [, value] of map.entries()) {
      const run = value as unknown as AdvancedTestRun;
      if (run.status === "running") {
        run.status = "failed";
        run.error = "进程重启时未完成";
        run.finishedAt = new Date().toISOString();
        repaired = true;
      }
    }
  } else if (globalKey === "__tcIssues") {
    // Issue: retesting → open
    for (const [, value] of map.entries()) {
      const issue = value as unknown as Issue;
      if (issue.status === "retesting") {
        issue.status = "open";
        repaired = true;
      }
    }
  }
  return repaired;
}

// 启动时状态修复：修复进程崩溃后残留的中间状态
// - TestRun/AdvancedTestRun: running → failed
// - Issue: retesting → open
// - Project: 旧状态值迁移 + moduleStatuses.testing → not_started
function repairStaleState(): void {
  // 修复 TestRun
  const runsMap = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  let runsRepaired = false;
  for (const [, run] of runsMap.entries()) {
    if (run.status === "running") {
      run.status = "failed";
      run.error = "进程重启时未完成";
      run.finishedAt = new Date().toISOString();
      runsRepaired = true;
    }
  }
  if (runsRepaired) saveMap(RUNS_KEY, runsMap);

  // 修复 AdvancedTestRun
  const advRunsMap = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  let advRunsRepaired = false;
  for (const [, run] of advRunsMap.entries()) {
    if (run.status === "running") {
      run.status = "failed";
      run.error = "进程重启时未完成";
      run.finishedAt = new Date().toISOString();
      advRunsRepaired = true;
    }
  }
  if (advRunsRepaired) saveMap(ADV_RUNS_KEY, advRunsMap);

  // 修复 Issue
  const issuesMap = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  let issuesRepaired = false;
  for (const [, issue] of issuesMap.entries()) {
    if (issue.status === "retesting") {
      issue.status = "open";
      issuesRepaired = true;
    }
  }
  if (issuesRepaired) saveMap(ISSUES_KEY, issuesMap);

  // 修复 Project：旧状态迁移 + 模块 testing 状态回退
  const projectsMap = getStoreMap();
  let projectsRepaired = false;
  for (const [id, project] of projectsMap.entries()) {
    let needUpdate = false;

    // 旧状态值迁移到新状态
    const legacyStatus = project.status as string;
    if (["basic_testing", "basic_done", "advanced_testing", "advanced_done"].includes(legacyStatus)) {
      project.status = migrateLegacyStatus(legacyStatus);
      needUpdate = true;
    }

    // 初始化 moduleStatuses（向后兼容）
    if (!project.moduleStatuses) {
      // 旧项目根据原状态推导初始模块状态
      const statuses = createDefaultModuleStatuses();
      if (legacyStatus === "basic_done" || legacyStatus === "advanced_testing" || legacyStatus === "advanced_done") {
        statuses.functional = "done";
      }
      if (legacyStatus === "advanced_done") {
        statuses.business = "done";
      }
      project.moduleStatuses = statuses;
      needUpdate = true;
    }

    // 模块 testing 状态回退为 not_started（进程崩溃时中断的测试）
    if (project.moduleStatuses) {
      for (const key of Object.keys(project.moduleStatuses) as TestModuleType[]) {
        if (project.moduleStatuses[key] === "testing") {
          project.moduleStatuses[key] = "not_started";
          needUpdate = true;
        }
      }
    }

    if (needUpdate) {
      projectsMap.set(id, project);
      projectsRepaired = true;
    }
  }
  if (projectsRepaired) {
    const g = globalThis as unknown as { __tcProjects?: Map<string, Project> };
    if (g.__tcProjects) {
      g.__tcProjects = projectsMap;
    }
    persistProjectsToFile();
  }
}

// 生成短 ID
function genShortId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// -------------------- 测试用例 --------------------

// 保存测试用例（批量）
export function saveTestCases(cases: TestCase[]): void {
  const map = getMap<TestCase>(CASES_KEY, "__tcCases");
  for (const c of cases) {
    map.set(c.id, c);
  }
  saveMap(CASES_KEY, map);
}

// 获取项目的所有测试用例
export function getTestCases(projectId: string): TestCase[] {
  const map = getMap<TestCase>(CASES_KEY, "__tcCases");
  return Array.from(map.values())
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// 获取单个测试用例
export function getTestCase(id: string): TestCase | undefined {
  return getMap<TestCase>(CASES_KEY, "__tcCases").get(id);
}

// 更新测试用例状态
export function updateTestCaseStatus(
  id: string,
  status: TestCase["status"],
): TestCase | undefined {
  const map = getMap<TestCase>(CASES_KEY, "__tcCases");
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: TestCase = { ...existing, status };
  map.set(id, updated);
  saveMap(CASES_KEY, map);
  return updated;
}

// -------------------- 测试运行 --------------------

// 创建测试运行
export function createTestRun(
  projectId: string,
  type: TestCaseType,
  mode: "scripted" | "real",
  total: number,
): TestRun {
  const run: TestRun = {
    id: genShortId("run"),
    projectId,
    type,
    mode,
    total,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    status: "running",
    startedAt: new Date().toISOString(),
    resultIds: [],
  };
  const map = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  map.set(run.id, run);
  saveMap(RUNS_KEY, map);
  return run;
}

// 更新测试运行
export function updateTestRun(
  id: string,
  patch: Partial<TestRun>,
): TestRun | undefined {
  const map = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: TestRun = { ...existing, ...patch, id: existing.id };
  map.set(id, updated);
  saveMap(RUNS_KEY, map);
  return updated;
}

// 获取测试运行
export function getTestRun(id: string): TestRun | undefined {
  return getMap<TestRun>(RUNS_KEY, "__tcRuns").get(id);
}

// 获取项目的最近一次测试运行
export function getLatestTestRun(
  projectId: string,
  type: TestCaseType,
): TestRun | undefined {
  const map = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  return Array.from(map.values())
    .filter((r) => r.projectId === projectId && r.type === type)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )[0];
}

// -------------------- 测试结果 --------------------

// 保存测试结果
export function saveTestResult(result: TestResult): TestResult {
  const map = getMap<TestResult>(RESULTS_KEY, "__tcResults");
  map.set(result.id, result);
  saveMap(RESULTS_KEY, map);

  // 同步更新 Run 的统计与 resultIds
  const runMap = getMap<TestRun>(RUNS_KEY, "__tcRuns");
  const run = runMap.get(result.runId);
  if (run) {
    run.resultIds.push(result.id);
    // 状态 → Run 字段映射：pass→passed, fail→failed, block→blocked, skip→skipped
    switch (result.status) {
      case "pass":
        run.passed += 1;
        break;
      case "fail":
        run.failed += 1;
        break;
      case "block":
        run.blocked += 1;
        break;
      case "skip":
        run.skipped += 1;
        break;
    }
    runMap.set(run.id, run);
    saveMap(RUNS_KEY, runMap);
  }
  return result;
}

// 获取一次运行的所有结果
export function getTestResults(runId: string): TestResult[] {
  const map = getMap<TestResult>(RESULTS_KEY, "__tcResults");
  return Array.from(map.values())
    .filter((r) => r.runId === runId)
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
}

// -------------------- 问题 --------------------

// 保存问题
export function saveIssue(issue: Issue): Issue {
  const map = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  map.set(issue.id, issue);
  saveMap(ISSUES_KEY, map);
  return issue;
}

// 获取单个问题
export function getIssue(id: string): Issue | undefined {
  return getMap<Issue>(ISSUES_KEY, "__tcIssues").get(id);
}

// 获取项目的所有问题
export function getProjectIssues(projectId: string): Issue[] {
  const map = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  return Array.from(map.values())
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// 获取一次运行的所有问题
export function getRunIssues(runId: string): Issue[] {
  const map = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  return Array.from(map.values())
    .filter((i) => i.runId === runId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// 更新问题
export function updateIssue(
  id: string,
  patch: Partial<Issue>,
): Issue | undefined {
  const map = getMap<Issue>(ISSUES_KEY, "__tcIssues");
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: Issue = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  map.set(id, updated);
  saveMap(ISSUES_KEY, map);
  return updated;
}

// -------------------- 项目状态流转辅助 --------------------

// 标记项目进入基础测试阶段（deprecated：改为设置 functional 模块状态）
/** @deprecated 使用 setModuleStatus(projectId, "functional", "testing") 代替 */
export function markBasicTesting(projectId: string): void {
  setModuleStatus(projectId, "functional", "testing");
  // 同时确保项目整体状态为 analyzed（模块化架构下不再有 basic_testing 状态）
  const project = getProject(projectId);
  if (project && project.status === "draft") {
    updateProject(projectId, { status: "analyzed" });
  }
}

// 标记项目基础测试完成（deprecated：改为设置 functional 模块状态）
/** @deprecated 使用 setModuleStatus(projectId, "functional", "done") 代替 */
export function markBasicDone(projectId: string): void {
  setModuleStatus(projectId, "functional", "done");
}

// 标记项目进入高级测试阶段（deprecated：改为设置 business 模块状态）
/** @deprecated 使用 setModuleStatus(projectId, "business", "testing") 代替 */
export function markAdvancedTesting(projectId: string): void {
  setModuleStatus(projectId, "business", "testing");
  const project = getProject(projectId);
  if (project && project.status === "draft") {
    updateProject(projectId, { status: "analyzed" });
  }
}

// 标记项目高级测试完成（deprecated：改为设置 business 模块状态）
/** @deprecated 使用 setModuleStatus(projectId, "business", "done") 代替 */
export function markAdvancedDone(projectId: string): void {
  setModuleStatus(projectId, "business", "done");
}

// 标记项目最终验收完成
export function markCompleted(projectId: string): void {
  updateProject(projectId, { status: "completed" });
}

// ============================================================
// 高级业务测试模块数据模型（模块 E + F）
// ============================================================

// 高级测试执行路径类型
export type AdvancedPathType = "normal" | "abnormal" | "cross_function";

// 高级测试执行步骤记录（剧本回放中的单步操作）
export interface AdvancedStepRecord {
  index: number; // 步骤序号
  action: string; // 浏览器操作描述
  screenshotDesc?: string; // 截图描述
  consoleLog?: string; // Console 日志
  networkRequest?: string; // 网络请求记录
  apiResponse?: string; // API 响应
  dataChange?: string; // 数据变化
  stateBefore?: string; // 前置状态
  stateAfter?: string; // 后置状态
}

// 高级测试路径执行结果
export interface AdvancedPathResult {
  id: string; // 结果 ID
  runId: string; // 关联运行 ID
  pathId: string; // 关联路径 ID（PATH-001 等）
  pathType: AdvancedPathType; // 路径类型
  title: string; // 路径标题
  status: ResultStatus; // pass / fail
  severity: RiskLevel; // 严重等级
  confidence: Confidence; // 置信度
  detectedBugId?: string; // 检测到的 Bug ID
  expectedBehavior: string; // 预期行为
  actualBehavior: string; // 实际行为
  impactScope: string; // 影响范围
  steps: AdvancedStepRecord[]; // 执行步骤记录
  executedAt: string; // 执行时间
  durationMs: number; // 执行耗时（毫秒）
}

// 高级测试运行
export interface AdvancedTestRun {
  id: string;
  projectId: string;
  type: "advanced";
  mode: "scripted" | "real";
  total: number; // 总路径数
  passed: number;
  failed: number;
  skipped: number; // 跳过/需手动验证的路径数
  detectedBugCount: number; // 发现 Bug 数
  status: "running" | "done" | "failed";
  error?: string; // 失败原因（status=failed 时）
  startedAt: string;
  finishedAt?: string;
  resultIds: string[];
  // 执行模式标注（预检降级时填充）
  executionMode?: "real" | "scripted_degraded"; // 真实执行 / 降级模拟执行
  precheckNote?: string; // 预检说明（如"项目未运行，使用模拟执行"）
}

// 高级测试问题分类（来自 issue-classifier）
export type AdvancedIssueCategory =
  | "confirmed_bug"
  | "high_prob_vulnerability"
  | "ux_defect"
  | "requirement_gap";

// 高级测试问题（扩展基础 Issue，增加分类、规则来源、置信度等字段）
export interface AdvancedIssue {
  id: string; // ISSUE-001 等
  projectId: string;
  runId: string;
  pathId: string; // 关联路径 ID
  resultId: string; // 关联结果 ID
  detectedBugId?: string; // 检测到的预埋 Bug ID
  bugNumber?: number; // Bug 编号
  title: string;
  category: AdvancedIssueCategory; // 问题分类
  categoryReason: string; // 分类依据
  severity: RiskLevel;
  confidence: Confidence; // 置信度
  ruleId: string; // 关联规则 ID
  ruleSource: string; // 规则来源（中文）
  impactModules: string[];
  reproduceSteps: string[]; // 复现步骤
  expected: string;
  actual: string;
  evidences: Evidence[]; // 证据（截图/Console/网络请求/数据变化）
  possibleCauses: string[];
  fixDirections: string[];
  aiInstruction: string; // AI 修复指令
  prohibitions: string[];
  acceptanceCriteria: string[];
  regressionScope: string[]; // 回归范围
  status: IssueStatus;
  retestRounds: number;
  maxRetestRounds: number;
  createdAt: string;
  updatedAt: string;
}

// 高级测试报告
export interface AdvancedTestReport {
  projectId: string;
  runId: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number; // 跳过/需手动验证的路径数
  detectedBugCount: number;
  // 按分类统计
  confirmedBugCount: number;
  highProbVulnerabilityCount: number;
  uxDefectCount: number;
  requirementGapCount: number;
  issues: AdvancedIssue[];
  generatedAt: string;
}

// 防回归用例（修复后沉淀的长期用例）
export interface RegressionCase {
  id: string; // 用例 ID
  projectId: string;
  issueId: string; // 关联问题 ID
  bugId?: string; // 关联 Bug ID
  title: string;
  description: string;
  steps: string[];
  expectedResult: string;
  category: "anti_regression"; // 防回归
  status: "pass" | "fail" | "pending";
  createdAt: string;
}

// 三级回归复测结果
export interface AdvancedRetestResult {
  projectId: string;
  // 第一层：原问题针对性复测
  layer1: {
    title: string;
    description: string;
    totalIssues: number;
    passedIssues: number;
    failedIssues: number;
    details: {
      issueId: string;
      bugId?: string;
      title: string;
      status: "pass" | "fail";
      note: string;
    }[];
  };
  // 第二层：相关功能回归
  layer2: {
    title: string;
    description: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    details: {
      caseId: string;
      title: string;
      status: "pass" | "fail";
      note: string;
    }[];
  };
  // 第三层：综合回归
  layer3: {
    title: string;
    description: string;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    details: {
      category: string;
      title: string;
      status: "pass" | "fail";
      note: string;
    }[];
  };
  // 防回归用例沉淀
  regressionCases: RegressionCase[];
  // 整体结果
  allPassed: boolean;
  executedAt: string;
}

// 最终质量结论
export interface FinalQualityReport {
  projectId: string;
  // 结论等级（5 级）
  conclusionLevel:
    | "no_demo" // 不建议演示
    | "internal_demo" // 可内部演示
    | "gray_release" // 可进入灰度
    | "public_test" // 可公开测试
    | "no_commercial"; // 不建议商业上线
  conclusionLabel: string;
  conclusionReason: string;
  // 质量维度
  basicQuality: { label: string; score: number; status: "pass" | "warn" | "fail" };
  businessQuality: { label: string; score: number; status: "pass" | "warn" | "fail" };
  uxQuality: { label: string; score: number; status: "pass" | "warn" | "fail" };
  // 剩余风险
  remainingRisks: string[];
  untestedModules: string[];
  requirementGaps: string[];
  // 建议下一步
  nextSteps: string[];
  // 已发现 Bug 总览
  totalBugsFound: number;
  totalBugsFixed: number;
  bugSummary: {
    bugId: string;
    bugNumber: number;
    title: string;
    detectedIn: "basic" | "advanced";
    status: "fixed" | "open";
  }[];
  generatedAt: string;
}

// ============================================================
// 高级测试存储（沿用 globalThis + localStorage 双模式）
// ============================================================

const ADV_RUNS_KEY = "test-center:adv-runs";
const ADV_RESULTS_KEY = "test-center:adv-results";
const ADV_ISSUES_KEY = "test-center:adv-issues";
const REGRESSION_CASES_KEY = "test-center:regression-cases";
const ADV_RETEST_KEY = "test-center:adv-retest";
const FINAL_REPORT_KEY = "test-center:final-report";

// -------------------- 高级测试运行 --------------------

export function createAdvancedTestRun(
  projectId: string,
  mode: "scripted" | "real",
  total: number,
): AdvancedTestRun {
  const run: AdvancedTestRun = {
    id: genShortId("advrun"),
    projectId,
    type: "advanced",
    mode,
    total,
    passed: 0,
    failed: 0,
    skipped: 0,
    detectedBugCount: 0,
    status: "running",
    startedAt: new Date().toISOString(),
    resultIds: [],
  };
  const map = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  map.set(run.id, run);
  saveMap(ADV_RUNS_KEY, map);
  return run;
}

export function updateAdvancedTestRun(
  id: string,
  patch: Partial<AdvancedTestRun>,
): AdvancedTestRun | undefined {
  const map = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: AdvancedTestRun = { ...existing, ...patch, id: existing.id };
  map.set(id, updated);
  saveMap(ADV_RUNS_KEY, map);
  return updated;
}

export function getAdvancedTestRun(id: string): AdvancedTestRun | undefined {
  return getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns").get(id);
}

export function getLatestAdvancedTestRun(
  projectId: string,
): AdvancedTestRun | undefined {
  const map = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  return Array.from(map.values())
    .filter((r) => r.projectId === projectId)
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )[0];
}

// -------------------- 高级测试结果 --------------------

export function saveAdvancedTestResult(
  result: AdvancedPathResult,
): AdvancedPathResult {
  const map = getMap<AdvancedPathResult>(ADV_RESULTS_KEY, "__tcAdvResults");
  map.set(result.id, result);
  saveMap(ADV_RESULTS_KEY, map);

  // 同步更新 Run 的统计
  const runMap = getMap<AdvancedTestRun>(ADV_RUNS_KEY, "__tcAdvRuns");
  const run = runMap.get(result.runId);
  if (run) {
    run.resultIds.push(result.id);
    if (result.status === "pass") run.passed += 1;
    else if (result.status === "fail") run.failed += 1;
    else if (result.status === "skip") run.skipped = (run.skipped ?? 0) + 1;
    if (result.detectedBugId) run.detectedBugCount += 1;
    runMap.set(run.id, run);
    saveMap(ADV_RUNS_KEY, runMap);
  }
  return result;
}

export function getAdvancedTestResults(runId: string): AdvancedPathResult[] {
  const map = getMap<AdvancedPathResult>(ADV_RESULTS_KEY, "__tcAdvResults");
  return Array.from(map.values())
    .filter((r) => r.runId === runId)
    .sort((a, b) => a.pathId.localeCompare(b.pathId));
}

// -------------------- 高级测试问题 --------------------

export function saveAdvancedIssue(issue: AdvancedIssue): AdvancedIssue {
  const map = getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues");
  map.set(issue.id, issue);
  saveMap(ADV_ISSUES_KEY, map);
  return issue;
}

export function getAdvancedIssue(id: string): AdvancedIssue | undefined {
  return getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues").get(id);
}

export function getProjectAdvancedIssues(projectId: string): AdvancedIssue[] {
  const map = getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues");
  return Array.from(map.values())
    .filter((i) => i.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getRunAdvancedIssues(runId: string): AdvancedIssue[] {
  const map = getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues");
  return Array.from(map.values())
    .filter((i) => i.runId === runId)
    .sort((a, b) => (a.bugNumber ?? 0) - (b.bugNumber ?? 0));
}

export function updateAdvancedIssue(
  id: string,
  patch: Partial<AdvancedIssue>,
): AdvancedIssue | undefined {
  const map = getMap<AdvancedIssue>(ADV_ISSUES_KEY, "__tcAdvIssues");
  const existing = map.get(id);
  if (!existing) return undefined;
  const updated: AdvancedIssue = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  map.set(id, updated);
  saveMap(ADV_ISSUES_KEY, map);
  return updated;
}

// -------------------- 防回归用例 --------------------

export function saveRegressionCases(cases: RegressionCase[]): void {
  const map = getMap<RegressionCase>(REGRESSION_CASES_KEY, "__tcRegCases");
  for (const c of cases) {
    map.set(c.id, c);
  }
  saveMap(REGRESSION_CASES_KEY, map);
}

export function getProjectRegressionCases(
  projectId: string,
): RegressionCase[] {
  const map = getMap<RegressionCase>(REGRESSION_CASES_KEY, "__tcRegCases");
  return Array.from(map.values())
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.id.localeCompare(b.id));
}

// -------------------- 三级回归复测结果 --------------------

export function saveAdvancedRetestResult(
  projectId: string,
  result: AdvancedRetestResult,
): void {
  const map = getMap<AdvancedRetestResult>(ADV_RETEST_KEY, "__tcAdvRetest");
  map.set(projectId, result);
  saveMap(ADV_RETEST_KEY, map);
}

export function getAdvancedRetestResult(
  projectId: string,
): AdvancedRetestResult | undefined {
  const map = getMap<AdvancedRetestResult>(ADV_RETEST_KEY, "__tcAdvRetest");
  return map.get(projectId);
}

// -------------------- 最终质量结论 --------------------

export function saveFinalReport(
  projectId: string,
  report: FinalQualityReport,
): void {
  const map = getMap<FinalQualityReport>(FINAL_REPORT_KEY, "__tcFinalReport");
  map.set(projectId, report);
  saveMap(FINAL_REPORT_KEY, map);
}

export function getFinalReport(
  projectId: string,
): FinalQualityReport | undefined {
  const map = getMap<FinalQualityReport>(FINAL_REPORT_KEY, "__tcFinalReport");
  return map.get(projectId);
}
