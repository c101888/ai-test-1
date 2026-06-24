# demo-project Dockerfile（Sealos 部署用）
# 被测演示项目：闯关学习 + 签到积分
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Render 会在构建时注入 NODE_ENV=production，导致 npm ci 跳过 devDependencies
# tailwindcss 在 devDependencies，缺失会导致 PostCSS 不处理 CSS → 样式丢失
# 解决：npm ci 时临时清空 NODE_ENV，确保 devDependencies 被安装
COPY package.json package-lock.json* ./
RUN NODE_ENV= npm ci || NODE_ENV= npm install

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4010

COPY --from=base /app ./
RUN mkdir -p prisma

EXPOSE 4010
CMD ["sh", "-c", "npx prisma db push && npm start"]
