import { ProjectNav } from "@/components/layout/ProjectNav";

// /projects/[id]/* 共享布局：渲染项目子导航
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <ProjectNav id={id} />
      {children}
    </div>
  );
}
