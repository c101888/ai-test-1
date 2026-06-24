import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/store";
import {
  parseLocalProject,
  parseZipProject,
  type ParsedProjectInfo,
} from "@/lib/project-parser";

// 解析项目代码：接收本地路径或 ZIP 文件，将解析结果存入项目
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const existing = getProject(id);
  if (!existing) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  try {
    let parsedInfo: ParsedProjectInfo;
    let localPath: string | undefined;

    // 判断请求类型：FormData（ZIP 文件）或 JSON（本地路径）
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      // ZIP 文件上传模式
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "未提供 ZIP 文件" },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      parsedInfo = await parseZipProject(buffer, file.name);
    } else {
      // 本地路径模式
      const body = await request.json();
      const path = body.localPath;
      if (!path || typeof path !== "string") {
        return NextResponse.json(
          { error: "未提供本地项目路径" },
          { status: 400 },
        );
      }
      localPath = path;
      parsedInfo = await parseLocalProject(path);
    }

    // 将解析结果存入项目
    const patch: Partial<typeof existing> = {
      parsedInfo,
      codeUploaded: true,
    };
    if (localPath) {
      patch.localPath = localPath;
    }
    updateProject(id, patch);

    return NextResponse.json({ parsedInfo });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "解析项目失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
