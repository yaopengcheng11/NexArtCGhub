#!/usr/bin/env bash
# ============================================================
# 部署后体检脚本:检查服务是否健康、内存/磁盘状态、容器日志
# 用法: ./scripts/healthcheck.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/cg-resource-hub}"
cd ${APP_DIR}

echo "============================================================"
echo "  CG Resource Hub - 健康检查"
echo "  $(date)"
echo "============================================================"

# 1. 容器状态
echo
echo "[1] Docker 容器状态"
docker compose ps

# 2. 健康检查接口
echo
echo "[3] HTTP 健康检查"
if curl -fsS --max-time 5 http://127.0.0.1:8788/api/health 2>/dev/null; then
    echo " ✓ 接口正常"
else
    echo " ✗ 接口不可达,请检查容器日志: docker compose logs app"
fi

# 4. 内存 / 磁盘 / swap
echo
echo "[4] 内存 / 磁盘 / swap"
free -h 2>/dev/null || echo "(free 命令缺失)"
df -h / /app 2>/dev/null | head -10
swapon --show 2>/dev/null || echo "(无 swap)"

# 5. 日志 tail
echo
echo "[5] 最近 20 行应用日志"
docker compose logs --tail=20 app 2>/dev/null || true