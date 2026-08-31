# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: 前端构建 (web/ → dist)
# ============================================================
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/web

# 国内镜像源 + 配置
RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fund false && \
    npm config set audit false

# 先复制清单走 Docker 层缓存
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制源码并构建
COPY web/ ./
RUN npm run build

# ============================================================
# Stage 2: 后端生产依赖
# ============================================================
FROM node:22-bookworm-slim AS backend-deps
WORKDIR /build/api

RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fund false && \
    npm config set audit false

# tsx 在 runtime 需要,所以保留 devDependencies
COPY api/package.json api/package-lock.json ./
RUN npm ci --no-audit --no-fund

# ============================================================
# Stage 3: 运行时镜像
# ============================================================
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# 运行时系统依赖(sqlite3 需要基础 c 库)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8788
ENV CORS_ORIGIN=*
ENV TRUST_PROXY=1

# 后端代码 + 完整依赖(含 tsx)
COPY --from=backend-deps /build/api/node_modules ./node_modules
COPY api/ ./api/

# 后端的 SQLite 数据库目录(运行时由 OpenShip 卷挂载覆盖)
RUN mkdir -p /app/api/data && chmod 777 /app/api/data

# 前端构建产物(由 Express 在生产模式下静态托管)
COPY --from=frontend-build /build/web/dist ./web/dist

WORKDIR /app/api
EXPOSE 8788

# 启动后端(tsx 直接跑 TS,免编译)
CMD ["npx", "tsx", "server.ts"]