# demo-project Dockerfile（Sealos 部署用）
# 被测演示项目：闯关学习 + 签到积分
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

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
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
