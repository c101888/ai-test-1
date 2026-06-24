# test-center Dockerfile
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 构建阶段需要 devDependencies（tailwindcss/typescript）
# Render 会在构建时注入 NODE_ENV=production，导致 npm ci 跳过 devDependencies
# tailwindcss 在 devDependencies，缺失会导致 PostCSS 不处理 CSS → 样式丢失
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 复制源码并构建（构建阶段保持 NODE_ENV=development，确保 PostCSS/Tailwind 正常运行）
COPY . .
RUN npm run build

# 运行阶段
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# 只复制运行时需要的文件
COPY --from=base /app/package.json ./
COPY --from=base /app/package-lock.json* ./
COPY --from=base /app/.next ./.next
COPY --from=base /app/public ./public
COPY --from=base /app/next.config.ts ./
COPY --from=base /app/node_modules ./node_modules
RUN mkdir -p .data

EXPOSE 4000
CMD ["npm", "start"]
