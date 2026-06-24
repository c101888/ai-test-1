# test-center Dockerfile（Sealos 部署用）
# 演示项目走纯剧本回放，无需 Playwright chromium
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 安装依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# 复制源码并构建
COPY . .
RUN npm run build

# 运行阶段
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=base /app ./
RUN mkdir -p .data

EXPOSE 4000
CMD ["npm", "start"]
