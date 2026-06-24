"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileCode2,
  FileText,
  Globe,
  KeyRound,
  Terminal,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  FolderSearch,
  Loader2,
  Cpu,
  Route,
  Database,
  Files,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Badge } from "@/components/ui/Badge";
import {
  createProject,
  putProject,
  calcCompleteness,
  canRunDynamicTest,
  type Project,
} from "@/lib/store";
import { demoProjectSeed } from "@/lib/demo-analysis";
import type { ParsedProjectInfo } from "@/lib/project-parser";

const inputCls =
  "w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none transition-colors";

// 表单字段
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-start">
      <div>
        <p className="text-sm font-medium text-text">{label}</p>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function NewProjectPage() {
  const router = useRouter();

  // 表单状态
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [parsedInfo, setParsedInfo] = useState<ParsedProjectInfo | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [codeUploaded, setCodeUploaded] = useState(false);
  const [docUploaded, setDocUploaded] = useState(false);
  const [codeFileName, setCodeFileName] = useState("");
  const [docFileName, setDocFileName] = useState("");
  const [codeUploading, setCodeUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [codeUploadError, setCodeUploadError] = useState("");
  const [docUploadError, setDocUploadError] = useState("");
  const [codeSavedPath, setCodeSavedPath] = useState("");
  const [docSavedPath, setDocSavedPath] = useState("");
  const [docTextContent, setDocTextContent] = useState("");
  const [docs, setDocs] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [startCommand, setStartCommand] = useState("");
  // 账户密码拆分输入（非必填），提交时合并为 "用户名:密码" 格式
  const [testUsername, setTestUsername] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  // 派生值：合并后的账户字符串（供完整度计算与动态测试判断使用）
  const testAccount = testUsername.trim()
    ? `${testUsername.trim()}:${testPassword.trim()}`
    : "";
  const adminAccount = adminUsername.trim()
    ? `${adminUsername.trim()}:${adminPassword.trim()}`
    : "";
  const [submitting, setSubmitting] = useState(false);

  // 本地路径浏览状态
  const [browsing, setBrowsing] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseCurrent, setBrowseCurrent] = useState("");
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<
    Array<{ name: string; path: string; isDir: boolean }>
  >([]);
  const [browseError, setBrowseError] = useState("");

  // 是否已提供代码（本地路径已解析或上传代码包）
  const hasCode = Boolean(localPath.trim() && parsedInfo) || codeUploaded;
  // 是否已提供文档
  const hasDocs = docUploaded || docs.trim().length > 0;

  // 接入完整度计算
  const completeness = useMemo(
    () =>
      calcCompleteness({
        codeUploaded,
        docUploaded,
        localPath,
        docs,
        testUrl,
        startCommand,
        testAccount,
        adminAccount,
      }),
    [
      codeUploaded,
      docUploaded,
      localPath,
      docs,
      testUrl,
      startCommand,
      testAccount,
      adminAccount,
    ],
  );

  // 是否具备动态测试条件
  const dynamicReady = canRunDynamicTest({ testUrl, testAccount });

  // 解析本地项目
  const handleParseLocal = async () => {
    if (!localPath.trim()) {
      setParseError("请输入本地项目路径");
      return;
    }
    setParsing(true);
    setParseError("");
    setParsedInfo(null);
    try {
      const res = await fetch("/api/projects/parse-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: localPath.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setParsedInfo(data.parsedInfo as ParsedProjectInfo);
        // 自动填充项目类型
        if (!type && data.parsedInfo.framework) {
          setType(`Web 应用 · ${data.parsedInfo.framework}`);
        }
      } else {
        setParseError(data.error || "解析失败");
      }
    } catch {
      setParseError("网络错误，解析失败");
    } finally {
      setParsing(false);
    }
  };

  // 上传代码包
  const handleUploadCode = async (file: File) => {
    setCodeUploading(true);
    setCodeUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "code");
      const res = await fetch("/api/projects/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setCodeUploaded(true);
        setCodeFileName(data.file.originalName);
        setCodeSavedPath(data.file.savedPath);
        // 如果解析成功，填充解析信息
        if (data.parsedInfo) {
          setParsedInfo(data.parsedInfo);
          if (!type && data.parsedInfo.framework) {
            setType(`Web 应用 · ${data.parsedInfo.framework}`);
          }
        }
      } else {
        setCodeUploadError(data.error || "上传失败");
      }
    } catch (err) {
      setCodeUploadError(
        `上传失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCodeUploading(false);
    }
  };

  // 上传文档
  const handleUploadDoc = async (file: File) => {
    setDocUploading(true);
    setDocUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "doc");
      const res = await fetch("/api/projects/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setDocUploaded(true);
        setDocFileName(data.file.originalName);
        setDocSavedPath(data.file.savedPath);
        // 如果是文本文件，填充到文档文本框
        if (data.textContent) {
          setDocs(data.textContent);
        }
      } else {
        setDocUploadError(data.error || "上传失败");
      }
    } catch (err) {
      setDocUploadError(
        `上传失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setDocUploading(false);
    }
  };

  // 打开本地路径浏览器
  const handleOpenBrowser = async () => {
    setBrowseOpen(true);
    setBrowseError("");
    setBrowsing(true);
    try {
      const res = await fetch("/api/projects/browse");
      const data = await res.json();
      if (res.ok) {
        setBrowseCurrent(data.current || "");
        setBrowseParent(data.parent);
        setBrowseEntries(data.entries || []);
      } else {
        setBrowseError(data.error || "无法加载目录");
      }
    } catch {
      setBrowseError("网络错误");
    } finally {
      setBrowsing(false);
    }
  };

  // 浏览到指定目录
  const handleBrowseTo = async (dirPath: string) => {
    setBrowsing(true);
    setBrowseError("");
    try {
      const res = await fetch("/api/projects/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: dirPath }),
      });
      const data = await res.json();
      if (res.ok) {
        setBrowseCurrent(data.current);
        setBrowseParent(data.parent);
        setBrowseEntries(data.entries || []);
      } else {
        setBrowseError(data.error || "无法浏览该目录");
      }
    } catch {
      setBrowseError("网络错误");
    } finally {
      setBrowsing(false);
    }
  };

  // 选择当前浏览目录作为项目路径
  const handleSelectBrowseDir = () => {
    if (browseCurrent) {
      setLocalPath(browseCurrent);
      setParsedInfo(null);
      setParseError("");
      setBrowseOpen(false);
    }
  };

  // 一键导入演示项目
  // 通过 API 在服务端创建项目，再同步到客户端
  const handleImportDemo = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...demoProjectSeed, status: "analyzing" }),
      });
      if (res.ok) {
        const data = await res.json();
        const project = data.project as Project;
        putProject(project);
        router.push(`/projects/${project.id}/analysis`);
        return;
      }
    } catch {
      // API 失败时回退
    }
    const project = createProject({
      ...demoProjectSeed,
      status: "analyzing",
    });
    router.push(`/projects/${project.id}/analysis`);
  };

  // 提交并分析
  const handleSubmit = async () => {
    if (!name.trim()) {
      alert("请填写项目名称");
      return;
    }
    if (!hasCode && !hasDocs) {
      alert("请至少提供本地项目路径、上传代码或文档中的一项");
      return;
    }
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      description: description.trim(),
      type: type.trim() || "Web 应用",
      codeUploaded: hasCode,
      docUploaded: hasDocs,
      testUrl: testUrl.trim(),
      startCommand: startCommand.trim(),
      testAccount,
      adminAccount,
      localPath: localPath.trim() || undefined,
      parsedInfo: parsedInfo || undefined,
      docs: docs.trim() || undefined,
      // 上传文件的服务端保存路径（供后续分析使用）
      codePackagePath: codeSavedPath || undefined,
      docFilePath: docSavedPath || undefined,
      isDemo: false,
      status: "analyzing" as const,
    };
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        const project = data.project as Project;
        putProject(project);
        router.push(`/projects/${project.id}/analysis`);
        return;
      }
    } catch {
      // API 失败时回退
    }
    const project = createProject(payload);
    router.push(`/projects/${project.id}/analysis`);
  };

  return (
    <>
      <PageHeader
        eyebrow="项目接入"
        title="接入新项目"
        description="提交项目基本信息、代码与文档，系统将自动评估接入完整度并生成智能分析。"
        action={
          <Button onClick={handleImportDemo} disabled={submitting}>
            <Sparkles className="h-4 w-4" />
            一键导入演示项目
          </Button>
        }
      />

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        {/* 演示项目快捷入口 */}
        <Panel
          title="快速开始"
          description="首次使用？一键导入内置演示项目，立即体验完整分析流程。"
        >
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-dim text-accent">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium text-text">
                  闯关学习 + 签到积分（演示项目）
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-2">
                  Next.js + Prisma + SQLite 实现，预埋 6 个业务 Bug，覆盖签到、积分、关卡、兑换等高风险场景。
                </p>
              </div>
            </div>
            <Button onClick={handleImportDemo} disabled={submitting} size="sm">
              导入并分析
            </Button>
          </div>
        </Panel>

        {/* 基本信息 */}
        <Panel
          title="基本信息"
          description="项目名称与描述将用于后续测试报告与问题归属。"
        >
          <div className="space-y-5">
            <Field label="项目名称">
              <input
                className={inputCls}
                placeholder="例如：电商交易中台"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="项目描述" hint="一句话说明业务范围">
              <textarea
                className={`${inputCls} h-20 resize-none`}
                placeholder="覆盖下单、支付、履约、售后的核心交易系统…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="项目类型" hint="可自动识别，也可手动填写">
              <input
                className={inputCls}
                placeholder="例如：Web 应用 · 闯关学习平台"
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </Field>
          </div>
        </Panel>

        {/* 项目接入方式 */}
        <Panel
          title="项目接入方式"
          description="支持本地项目路径、代码包上传、开发文档三种方式，可组合使用。"
        >
          <div className="space-y-5">
            {/* 方式一：本地项目路径（推荐） */}
            <div className="rounded-lg border border-accent/30 bg-accent-dim/30 p-4">
              <div className="mb-3 flex items-center gap-2">
                <FolderSearch className="h-4 w-4 text-accent" />
                <p className="text-sm font-medium text-text">
                  方式一：本地项目路径
                </p>
                <Badge severity="accent">推荐</Badge>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-text-2">
                服务端直接读取本地目录，无需上传。解析后将自动识别技术栈、路由、数据模型等信息。
              </p>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="e:\my-project"
                  value={localPath}
                  onChange={(e) => {
                    setLocalPath(e.target.value);
                    setParsedInfo(null);
                    setParseError("");
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleOpenBrowser}
                  className="shrink-0"
                >
                  <FolderSearch className="h-3.5 w-3.5" />
                  浏览…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleParseLocal}
                  disabled={parsing || !localPath.trim()}
                  className="shrink-0"
                >
                  {parsing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      解析中
                    </>
                  ) : (
                    <>
                      <FolderSearch className="h-3.5 w-3.5" />
                      解析项目
                    </>
                  )}
                </Button>
              </div>

              {/* 本地路径浏览器弹窗 */}
              {browseOpen && (
                <div className="mt-3 rounded-md border border-border bg-bg-2 px-3 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-text-2">
                      选择项目目录
                    </p>
                    <button
                      type="button"
                      onClick={() => setBrowseOpen(false)}
                      className="text-xs text-text-3 hover:text-text"
                    >
                      关闭
                    </button>
                  </div>
                  {/* 当前路径 + 返回上级 */}
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    {browseParent && (
                      <button
                        type="button"
                        onClick={() => handleBrowseTo(browseParent)}
                        disabled={browsing}
                        className="rounded border border-border bg-surface px-2 py-1 text-text-2 hover:border-accent/40 hover:text-text disabled:opacity-50"
                      >
                        ↑ 上级
                      </button>
                    )}
                    <span className="break-all font-mono text-text-3">
                      {browseCurrent || "根目录"}
                    </span>
                  </div>
                  {browseError && (
                    <p className="mb-2 text-xs text-critical">{browseError}</p>
                  )}
                  {/* 目录列表 */}
                  <div className="max-h-60 overflow-y-auto rounded border border-border bg-surface">
                    {browsing ? (
                      <div className="flex items-center justify-center px-3 py-6 text-xs text-text-3">
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        加载中…
                      </div>
                    ) : browseEntries.length === 0 ? (
                      <div className="px-3 py-6 text-center text-xs text-text-3">
                        没有可显示的子目录
                      </div>
                    ) : (
                      <ul className="divide-y divide-border">
                        {browseEntries.map((entry) => (
                          <li key={entry.path}>
                            <button
                              type="button"
                              onClick={() => handleBrowseTo(entry.path)}
                              disabled={browsing}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-2 hover:bg-bg-2 disabled:opacity-50"
                            >
                              <FolderSearch className="h-3.5 w-3.5 shrink-0 text-text-3" />
                              <span className="break-all">{entry.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* 选择当前目录按钮 */}
                  {browseCurrent && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleSelectBrowseDir}
                        disabled={browsing}
                      >
                        选择此目录
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* 解析错误提示 */}
              {parseError && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-critical/30 bg-critical-dim px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />
                  <p className="text-xs leading-relaxed text-critical">
                    {parseError}
                  </p>
                </div>
              )}

              {/* 解析结果摘要 */}
              {parsedInfo && (
                <div className="mt-3 space-y-3 rounded-md border border-border bg-bg-2 px-3 py-3">
                  <div className="flex items-center gap-1.5 text-xs text-accent">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="font-medium">解析成功</span>
                  </div>

                  {/* 技术栈 */}
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-2">
                      <Cpu className="h-3.5 w-3.5" />
                      技术栈
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {parsedInfo.techStack.map((tech) => (
                        <Badge key={tech} severity="info">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* 统计信息 */}
                  <div className="grid grid-cols-3 gap-2">
                    <ParseStat
                      icon={Route}
                      label="页面路由"
                      value={parsedInfo.pageRoutes.length}
                    />
                    <ParseStat
                      icon={Globe}
                      label="API 路由"
                      value={parsedInfo.apiRoutes.length}
                    />
                    <ParseStat
                      icon={Database}
                      label="数据模型"
                      value={parsedInfo.dataModels.length}
                    />
                  </div>

                  {/* 数据模型列表 */}
                  {parsedInfo.dataModels.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-xs font-medium text-text-2">
                        数据模型
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {parsedInfo.dataModels.map((model) => (
                          <Badge key={model} severity="accent">
                            {model}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 文件总数 */}
                  <div className="flex items-center gap-1.5 text-xs text-text-3">
                    <Files className="h-3.5 w-3.5" />
                    <span>共解析 {parsedInfo.fileCount} 个文件</span>
                  </div>

                  {/* 路由列表（可展开） */}
                  {(parsedInfo.pageRoutes.length > 0 ||
                    parsedInfo.apiRoutes.length > 0) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-text-2 hover:text-text">
                        查看路由详情
                      </summary>
                      <div className="mt-2 space-y-1 font-mono text-text-3">
                        {parsedInfo.pageRoutes.map((r) => (
                          <div key={`page-${r}`}>📄 {r}</div>
                        ))}
                        {parsedInfo.apiRoutes.map((r) => (
                          <div key={`api-${r}`}>🔌 {r}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>

            {/* 方式二 & 方式三：上传 */}
            <div className="grid gap-4 sm:grid-cols-2">
              <UploadSlot
                icon={FileCode2}
                label="方式二：上传代码包"
                hint=".zip / .tar.gz / .tgz"
                accept=".zip,.tar.gz,.tgz"
                kind="code"
                uploaded={codeUploaded}
                fileName={codeFileName}
                uploading={codeUploading}
                error={codeUploadError}
                onFileSelected={handleUploadCode}
                onClear={() => {
                  setCodeUploaded(false);
                  setCodeFileName("");
                  setCodeSavedPath("");
                  setCodeUploadError("");
                }}
              />
              <UploadSlot
                icon={FileText}
                label="方式三：上传文档"
                hint=".md / .txt / .pdf / .docx"
                accept=".md,.markdown,.txt,.pdf,.doc,.docx,.json,.yaml,.yml"
                kind="doc"
                uploaded={docUploaded}
                fileName={docFileName}
                uploading={docUploading}
                error={docUploadError}
                onFileSelected={handleUploadDoc}
                onClear={() => {
                  setDocUploaded(false);
                  setDocFileName("");
                  setDocSavedPath("");
                  setDocTextContent("");
                  setDocUploadError("");
                }}
              />
            </div>

            {/* 文档文本输入 */}
            <Field
              label="文档文本"
              hint="可直接粘贴 PRD / 需求文档内容"
            >
              <textarea
                className={`${inputCls} h-24 resize-none font-mono text-xs`}
                placeholder={"# 需求文档\n\n## 功能说明\n1. 用户注册登录\n2. 每日签到获取积分\n3. 关卡答题\n4. 积分兑换奖励"}
                value={docs}
                onChange={(e) => setDocs(e.target.value)}
              />
            </Field>

            {!hasCode && !hasDocs && (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                请至少提供本地项目路径、上传代码或文档中的一项，否则无法进行分析
              </p>
            )}
          </div>
        </Panel>

        {/* 运行环境 */}
        <Panel
          title="运行环境"
          description="测试地址与启动说明，供自动化执行与人工复测使用。"
        >
          <div className="space-y-5">
            <Field label="测试地址" hint="动态测试执行的入口">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 shrink-0 text-text-3" />
                <input
                  className={inputCls}
                  placeholder="https://staging.example.com"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                />
              </div>
            </Field>
            <Field label="启动说明" hint="拉起依赖与服务的命令">
              <div className="flex items-start gap-2">
                <Terminal className="mt-1 h-4 w-4 shrink-0 text-text-3" />
                <textarea
                  className={`${inputCls} h-20 resize-none font-mono text-xs`}
                  placeholder={"# 拉起依赖与服务\nnpm install && npm run dev"}
                  value={startCommand}
                  onChange={(e) => setStartCommand(e.target.value)}
                />
              </div>
            </Field>
            <Field label="测试账号" hint="普通用户账号（非必填）">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 shrink-0 text-text-3" />
                    <input
                      className={inputCls}
                      placeholder="用户账户"
                      value={testUsername}
                      onChange={(e) => setTestUsername(e.target.value)}
                    />
                  </div>
                  <input
                    className={inputCls}
                    type="password"
                    placeholder="用户密码"
                    value={testPassword}
                    onChange={(e) => setTestPassword(e.target.value)}
                  />
                </div>
              </div>
            </Field>
            <Field label="管理员账号" hint="管理员账号（非必填）">
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 shrink-0 text-text-3" />
                    <input
                      className={inputCls}
                      placeholder="管理员账户"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                    />
                  </div>
                  <input
                    className={inputCls}
                    type="password"
                    placeholder="管理员密码"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                </div>
              </div>
            </Field>
          </div>
        </Panel>

        {/* 接入完整度 */}
        <Panel
          title="接入完整度"
          description="根据已提交信息自动评估，达到 80% 即可启动智能分析。"
          action={
            <Badge severity={completeness >= 80 ? "pass" : "warning"}>
              {completeness >= 80 ? "可分析" : "进行中"}
            </Badge>
          }
        >
          <ProgressBar
            value={completeness}
            tone={completeness >= 80 ? "accent" : "warning"}
            label="接入完整度"
          />

          {/* 完整度明细 */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <CompletenessItem
              ok={hasCode}
              label="本地路径或上传代码（50%）"
            />
            <CompletenessItem ok={Boolean(testUrl.trim())} label="测试地址（20%）" />
            <CompletenessItem ok={hasDocs} label="文档（15%）" />
            <CompletenessItem
              ok={Boolean(startCommand.trim())}
              label="启动说明（10%）"
            />
            <CompletenessItem
              ok={Boolean(testAccount.trim())}
              label="测试账号（5%）"
            />
          </div>

          {/* 缺少测试地址提示 */}
          {!testUrl.trim() && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-dim px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-warning">
                未填写测试地址，只能进行静态代码分析，不能执行动态测试（Playwright 操作浏览器）
              </p>
            </div>
          )}

          {/* 动态测试条件提示 */}
          {testUrl.trim() && !dynamicReady && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-dim px-3 py-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs leading-relaxed text-warning">
                缺少测试账号，将无法完整执行动态测试。补充后将解锁基础与高级业务测试能力。
              </p>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs text-text-3">
              {completeness >= 80
                ? "接入完整度达标，可启动智能分析"
                : `还需补充字段以达到 80% 完整度`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setName("");
                  setDescription("");
                  setType("");
                  setLocalPath("");
                  setParsedInfo(null);
                  setParseError("");
                  setCodeUploaded(false);
                  setDocUploaded(false);
                  setDocs("");
                  setTestUrl("");
                  setStartCommand("");
                  setTestUsername("");
                  setTestPassword("");
                  setAdminUsername("");
                  setAdminPassword("");
                }}
              >
                清空
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={submitting || !name.trim() || (!hasCode && !hasDocs)}
              >
                提交并分析
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

// 上传槽位：真实文件上传
function UploadSlot({
  icon: Icon,
  label,
  hint,
  accept,
  kind,
  uploaded,
  fileName,
  uploading,
  error,
  onFileSelected,
  onClear,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  accept: string;
  kind: "code" | "doc";
  uploaded: boolean;
  fileName: string;
  uploading: boolean;
  error: string;
  onFileSelected: (file: File) => void;
  onClear: () => void;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
        uploaded
          ? "border-accent/40 bg-accent-dim"
          : "border-border bg-bg-2 hover:border-accent/30"
      }`}
    >
      <Icon
        className={`h-6 w-6 ${uploaded ? "text-accent" : "text-text-3"}`}
      />
      {uploading ? (
        <>
          <p className="mt-2 flex items-center gap-1 text-sm text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            上传中…
          </p>
          <p className="mt-1 font-mono text-xs text-text-3">请稍候</p>
        </>
      ) : uploaded ? (
        <>
          <p className="mt-2 flex items-center gap-1 text-sm text-accent">
            <CheckCircle2 className="h-3.5 w-3.5" />
            已上传
          </p>
          <p className="mt-1 font-mono text-xs text-text-3 break-all">
            {fileName}
          </p>
          <button
            type="button"
            onClick={onClear}
            className="mt-2 text-xs text-text-3 underline-offset-2 hover:text-warning hover:underline"
          >
            移除
          </button>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-2">{label}</p>
          <p className="mt-1 font-mono text-xs text-text-3">{hint}</p>
          {error && (
            <p className="mt-2 text-xs text-critical break-all">{error}</p>
          )}
          <label className="mt-3 cursor-pointer rounded-md border border-border bg-surface px-3 py-1 text-xs text-text-2 transition-colors hover:border-accent/40 hover:text-text">
            选择文件
            <input
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileSelected(file);
                // 重置 input 以便重复选择同一文件
                e.target.value = "";
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}

// 解析统计项
function ParseStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-2 text-center">
      <Icon className="mx-auto h-3.5 w-3.5 text-text-3" />
      <p className="mt-1 font-mono text-lg font-semibold text-text">{value}</p>
      <p className="text-xs text-text-3">{label}</p>
    </div>
  );
}

// 完整度明细项
function CompletenessItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
      ) : (
        <span className="h-3.5 w-3.5 rounded-full border border-border" />
      )}
      <span className={ok ? "text-text" : "text-text-3"}>{label}</span>
    </div>
  );
}
