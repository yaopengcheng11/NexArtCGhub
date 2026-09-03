# syntax=docker/dockerfile:1

# ============================================================
# Stage 1: 前端构建 (web/ → dist)
# ============================================================
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /build/web

# 国内 apt 源 + npm 镜像
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fund false && \
    npm config set audit false

COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY web/ ./
RUN npm run build

# ============================================================
# Stage 2: 后端生产依赖(sqlite3 走 prebuilt 失败时自动源码编译)
# ============================================================
FROM node:22-bookworm-slim AS backend-deps
WORKDIR /build/api

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com && \
    npm config set fund false && \
    npm config set audit false

COPY api/package.json api/package-lock.json ./
# 让 sqlite3/bcryptjs 等走源码编译(已装好 build-essential)
RUN npm ci --no-audit --no-fund

# ============================================================
# Stage 3: 运行时镜像
# ============================================================
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=8788
ENV CORS_ORIGIN=*
ENV TRUST_PROXY=1

# 后端代码 + 完整依赖(含已编译的 native modules)
COPY --from=backend-deps /build/api/node_modules ./node_modules
COPY api/ ./api/

# SQLite 数据库目录(运行时由 OpenShip 卷挂载覆盖)
RUN mkdir -p /app/api/data && chmod 777 /app/api/data

# 前端构建产物(由 Express 在生产模式下静态托管)
COPY --from=frontend-build /build/web/dist ./web/dist

WORKDIR /app/api
EXPOSE 8788

CMD ["npx", "tsx", "server.ts"]