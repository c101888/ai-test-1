"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { type Project } from "@/lib/store";

const inputCls =
  "w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-text placeholder:text-text-3 focus:border-accent/50 focus:outline-none transition-colors";

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

export default function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 表单字段
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [startCommand, setStartCommand] = useState("");
  // 账户密码拆分输入（非必填），保存时合并为 "用户名:密码" 格式
  const [testUsername, setTestUsername] = useState("");
  const [testPassword, setTestPassword] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [docs, setDocs] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 加载项目数据
  useEffect(() => {
    (async () => {
      const { id } = await params;
      setProjectId(id);
      try {
        const res = await fetch(`/api/projects/${id}`, { method: "GET" });
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        const p = data.project as Project;
        setName(p.name || "");
        setDescription(p.description || "");
        setType(p.type || "");
        setTestUrl(p.testUrl || "");
        setStartCommand(p.startCommand || "");
        // 拆分 "用户名:密码" 格式到独立字段
        const parseAccount = (str: string): [string, string] => {
          if (!str) return ["", ""];
          const idx = str.indexOf(":");
          if (idx === -1) return [str, ""];
          return [str.slice(0, idx), str.slice(idx + 1)];
        };
        const [tu, tp] = parseAccount(p.testAccount || "");
        setTestUsername(tu);
        setTestPassword(tp);
        const [au, ap] = parseAccount(p.adminAccount || "");
        setAdminUsername(au);
        setAdminPassword(ap);
        setDocs(p.docs || "");
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [params]);

  // 保存
  const handleSave = async () => {
    if (!name.trim()) {
      setSaveMsg({ ok: false, text: "项目名称不能为空" });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    // 合并账户密码：用户名:密码 格式
    const mergedTestAccount = testUsername.trim()
      ? `${testUsername.trim()}:${testPassword.trim()}`
      : "";
    const mergedAdminAccount = adminUsername.trim()
      ? `${adminUsername.trim()}:${adminPassword.trim()}`
      : "";
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          type: type.trim(),
          testUrl: testUrl.trim(),
          startCommand: startCommand.trim(),
          testAccount: mergedTestAccount,
          adminAccount: mergedAdminAccount,
          docs: docs.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSaveMsg({ ok: false, text: `保存失败：${data.error || res.status}` });
        return;
      }
      setSaveMsg({ ok: true, text: "保存成功" });
    } catch (err) {
      setSaveMsg({
        ok: false,
        text: `保存失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async () => {
    if (
      !window.confirm(
        `确定要删除项目「${name}」吗？\n\n该操作将删除项目及其所有关联数据（测试用例、运行记录、结果、问题、报告等），且不可恢复。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        window.alert(`删除失败：${data.error || res.status}`);
        return;
      }
      router.push("/");
    } catch (err) {
      window.alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center text-sm text-text-3">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        <p className="mt-2">加载项目信息…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" />
        <h2 className="mt-3 text-base font-semibold text-text">项目不存在</h2>
        <p className="mt-1 text-sm text-text-2">
          可能该项目已被删除，或链接已失效。
        </p>
        <Button href="/" variant="ghost" className="mt-4">
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="项目设置"
        title="编辑项目信息"
        description="修改项目基本信息、测试环境配置与文档。代码包和本地路径不可编辑，如需更换请新建项目。"
        action={
          <Button href={`/projects/${projectId}/analysis`} variant="ghost" size="md">
            <ArrowLeft className="h-4 w-4" />
            返回项目
          </Button>
        }
      />

      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* 基本信息 */}
        <Panel className="p-6">
          <h3 className="text-sm font-semibold text-text">基本信息</h3>
          <div className="mt-4 space-y-4">
            <Field label="项目名称" hint="必填">
              <input
                className={inputCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：家庭积分系统"
              />
            </Field>
            <Field label="项目描述">
              <textarea
                className={inputCls}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简要描述项目用途与目标用户"
              />
            </Field>
            <Field label="项目类型">
              <input
                className={inputCls}
                value={type}
                onChange={(e) => setType(e.target.value)}
                placeholder="例如：Web 应用 · Next.js"
              />
            </Field>
          </div>
        </Panel>

        {/* 测试环境配置 */}
        <Panel className="mt-4 p-6">
          <h3 className="text-sm font-semibold text-text">测试环境配置</h3>
          <div className="mt-4 space-y-4">
            <Field
              label="测试地址"
              hint="被测项目的可访问 URL，如 http://localhost:4010"
            >
              <input
                className={inputCls}
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                placeholder="http://localhost:4010"
              />
            </Field>
            <Field label="启动命令" hint="用于自动拉起被测项目">
              <input
                className={inputCls}
                value={startCommand}
                onChange={(e) => setStartCommand(e.target.value)}
                placeholder="例如：npm run dev"
              />
            </Field>
            <Field label="测试账号" hint="普通用户账号（非必填），用户名与密码分开填写">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  value={testUsername}
                  onChange={(e) => setTestUsername(e.target.value)}
                  placeholder="用户账户"
                />
                <input
                  className={inputCls}
                  type="password"
                  value={testPassword}
                  onChange={(e) => setTestPassword(e.target.value)}
                  placeholder="用户密码"
                />
              </div>
            </Field>
            <Field label="管理员账号" hint="管理员账号（非必填），用户名与密码分开填写">
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={inputCls}
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="管理员账户"
                />
                <input
                  className={inputCls}
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="管理员密码"
                />
              </div>
            </Field>
          </div>
        </Panel>

        {/* 文档 */}
        <Panel className="mt-4 p-6">
          <h3 className="text-sm font-semibold text-text">项目文档</h3>
          <p className="mt-1 text-xs text-text-3">
            手动编辑或补充项目文档文本，用于 AI 分析时参考。
          </p>
          <textarea
            className={`${inputCls} mt-3`}
            rows={6}
            value={docs}
            onChange={(e) => setDocs(e.target.value)}
            placeholder="粘贴项目 README、需求文档或功能说明…"
          />
        </Panel>

        {/* 操作区 */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "保存中…" : "保存修改"}
            </Button>
            {saveMsg && (
              <span
                className={`flex items-center gap-1 text-xs ${
                  saveMsg.ok ? "text-green-500" : "text-red-500"
                }`}
              >
                {saveMsg.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {saveMsg.text}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-400/40 bg-transparent px-3 py-2 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {deleting ? "删除中…" : "删除项目"}
          </button>
        </div>
      </div>
    </>
  );
}
