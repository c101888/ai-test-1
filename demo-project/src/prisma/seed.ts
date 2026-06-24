import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "node:path";

// 数据库文件路径（相对于项目根目录）
const dbPath = path.join(process.cwd(), "src", "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({
  url: `file:${dbPath}`,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("开始清理数据库...");
  await prisma.exchange.deleteMany();
  await prisma.progress.deleteMany();
  await prisma.signRecord.deleteMany();
  await prisma.reward.deleteMany();
  await prisma.level.deleteMany();
  await prisma.user.deleteMany();

  console.log("插入关卡数据...");
  // 5 个关卡，每关答题正确得 10 积分
  await prisma.level.create({
    data: {
      order: 1,
      title: "第一关：HTML 基础",
      question: "HTML 中表示一级标题的标签是？（写出标签名，包含尖括号）",
      answer: "<h1>",
      points: 10,
    },
  });
  await prisma.level.create({
    data: {
      order: 2,
      title: "第二关：CSS 选择器",
      question: "CSS 中选择 id 为 box 的元素的选择器是？（包含前缀符号）",
      answer: "#box",
      points: 10,
    },
  });
  await prisma.level.create({
    data: {
      order: 3,
      title: "第三关：JavaScript 变量",
      question: "JavaScript 中声明常量的关键字是？",
      answer: "const",
      points: 10,
    },
  });
  await prisma.level.create({
    data: {
      order: 4,
      title: "第四关：React 组件",
      question: "React 中用于管理组件状态的 Hook 名称是？（不含 use 前缀，仅单词，首字母大写）",
      answer: "State",
      points: 10,
    },
  });
  await prisma.level.create({
    data: {
      order: 5,
      title: "第五关：Next.js 路由",
      question: "Next.js App Router 中，定义页面所用文件名是？（不含扩展名）",
      answer: "page",
      points: 10,
    },
  });

  console.log("插入奖励数据...");
  // 3 个奖励，cost 分别为 30/50/100，stock 为 100/50/10
  await prisma.reward.create({
    data: {
      title: "学习徽章",
      cost: 30,
      stock: 100,
    },
  });
  await prisma.reward.create({
    data: {
      title: "高级课程优惠券",
      cost: 50,
      stock: 50,
    },
  });
  await prisma.reward.create({
    data: {
      title: "限量纪念T恤",
      cost: 100,
      stock: 10,
    },
  });

  console.log("种子数据插入完成！");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
