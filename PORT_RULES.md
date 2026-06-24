# 端口规则（不可更改）

> 本规则为项目固定配置，**任何情况下不得更改**。

## 固定端口分配

| 项目 | 目录 | 端口 | 访问地址 | 启动命令 |
|------|------|------|----------|----------|
| 测试中心主应用 | `test-center/` | **4000** | http://localhost:4000 | `npm run dev` |
| 演示项目（闯关学习+签到积分） | `demo-project/` | **4010** | http://localhost:4010 | `npm run dev` |

## 规则说明

1. **端口 4000** 为测试中心主应用的固定端口，已在 `test-center/package.json` 中通过 `next dev -p 4000` 和 `next start -p 4000` 硬编码。
2. **端口 4010** 为演示项目的固定端口，已在 `demo-project/package.json` 中通过 `next dev -p 4010` 和 `next start -p 4010` 硬编码。
3. 两个端口互不冲突，可同时启动运行。
4. 测试中心在分析演示项目时，`testUrl` 字段固定指向 `http://localhost:4010`。
5. 基础测试用例中访问演示项目的地址固定为 `http://localhost:4010`。

## 不可更改声明

- 上述端口值为**固定值**，不得因任何原因（端口冲突、环境差异、个人偏好等）修改。
- 如遇端口被占用，应**停止占用端口的进程**，而非更改本规则中的端口。
- 任何代码、配置、文档中对这两个端口的引用都必须与本文档一致。

## 验证方式

```bash
# 启动测试中心（端口 4000）
cd test-center
npm run dev
# 访问 http://localhost:4000

# 启动演示项目（端口 4010）
cd demo-project
npm run dev
# 访问 http://localhost:4010
```
