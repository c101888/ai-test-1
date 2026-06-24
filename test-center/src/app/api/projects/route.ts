import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/store";

// 获取项目列表
export async function GET() {
  const projects = listProjects();
  return NextResponse.json({ projects });
}

// 创建项目
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = createProject({
      name: body.name ?? "",
      description: body.description ?? "",
      type: body.type ?? "",
      codeUploaded: body.codeUploaded ?? false,
      docUploaded: body.docUploaded ?? false,
      testUrl: body.testUrl ?? "",
      startCommand: body.startCommand ?? "",
      testAccount: body.testAccount ?? "",
      adminAccount: body.adminAccount ?? "",
      isDemo: body.isDemo ?? false,
      status: body.status ?? "draft",
      localPath: body.localPath,
      parsedInfo: body.parsedInfo,
      docs: body.docs,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "创建项目失败" },
      { status: 500 },
    );
  }
}
