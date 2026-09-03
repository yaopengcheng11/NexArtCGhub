#!/usr/bin/env bash
# ============================================================
# 一键部署 cg-resource-hub 到任意 Linux 服务器
# 适用: Ubuntu 20+/Debian 11+/CentOS 8+(已支持 systemd)
# 流程: 安装 Docker → 装 swap(2G 内存) → 拉项目 → 跑 docker compose
# 用法:
#   curl -fsSL https://你的部署脚本URL/setup_server.sh | sudo bash -s -- \
#        --repo https://github.com/你的用户名/cg-resource-hub.git \
#        --dir /opt/cg-resource-hub
# 或者在已 clone 的项目目录下:
#   sudo ./scripts/setup_server.sh
# ============================================================
set -euo pipefail

# -------- 参数解析 --------
REPO_URL="https://github.com/yourname/cg-resource-hub.git"
APP_DIR="/opt/cg-resource-hub"
DO_SWAP=true
SWAP_SIZE="4G"
ENABLE_NGINX=true
DOMAIN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="$2"; shift 2 ;;
    --dir)  APP_DIR="$2"; shift 2 ;;
    --no-swap) DO_SWAP=false; shift ;;
    --swap-size) SWAP_SIZE="$2"; shift 2 ;;
    --no-nginx) ENABLE_NGINX=false; shift ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

# -------- 工具函数 --------
log() { printf "\033[1;32m[setup]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[setup]\033[0m %s\n" "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && err "请用 root 运行:sudo $0"

# -------- 1. 系统信息 --------
. /etc/os-release
log "检测到系统: ${PRETTY_NAME}"

# -------- 2. 加 swap(2G 内存机器强烈建议) --------
if $DO_SWAP && [[ $(free -b | awk '/Mem:/{print int($2/1024/1024/1024)}') -le 4 ]]; then
    if ! swapon --show | grep -q "/swapfile"; then
        log "内存 ≤4G,添加 ${SWAP_SIZE} swap"
        fallocate -l ${SWAP_SIZE} /swapfile
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        grep -q "/swapfile" /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab
        sysctl vm.swappiness=10
        grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=10" >> /etc/sysctl.conf
    else
        log "swap 已存在,跳过"
    fi
fi

# -------- 3. 装 Docker --------
if ! command -v docker &>/dev/null; then
    log "安装 Docker"
    case "${ID}" in
        ubuntu|debian)
            apt-get update -y
            apt-get install -y ca-certificates curl gnupg
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/${ID}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
            apt-get update -y
            apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        centos|rhel|rocky|almalinux)
            dnf -y install dnf-plugins-core
            dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
            dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            ;;
        *) err "暂不支持的系统: ${ID}" ;;
    esac
    systemctl enable --now docker
else
    log "Docker 已安装: $(docker --version)"
fi

# docker compose v2 子命令检查
docker compose version &>/dev/null || err "未检测到 docker compose v2"

# -------- 4. 拉项目 --------
if [[ ! -d ${APP_DIR}/.git ]]; then
    log "克隆项目: ${REPO_URL} → ${APP_DIR}"
    apt-get install -y git || dnf -y install git
    git clone ${REPO_URL} ${APP_DIR}
else
    log "项目已存在: ${APP_DIR}"
    cd ${APP_DIR}
    git pull --ff-only || log "git pull 失败,继续用现有代码"
fi

cd ${APP_DIR}

# -------- 5. 环境变量 --------
if [[ ! -f .env ]]; then
    log "生成 .env(请编辑填入真实密钥)"
    cp .env.example .env
    SECRET=$(openssl rand -hex 64)
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${SECRET}|" .env
    PASS=$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9' | head -c 16)
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PASS}|" .env
    log "已生成临时管理员密码: ${PASS}(写在 .env 里)"
fi

# -------- 6. 起服务 --------
log "构建并启动容器"
docker compose build
docker compose up -d

# -------- 7. Nginx 反代(可选) --------
if $ENABLE_NGINX; then
    if ! command -v nginx &>/dev/null; then
        log "安装 Nginx"
        case "${ID}" in
            ubuntu|debian) apt-get install -y nginx ;;
            centos|rhel|rocky|almalinux) dnf -y install nginx ;;
        esac
        systemctl enable --now nginx
    fi

    cat > /etc/nginx/sites-available/cg-resource-hub.conf <<'NGINX'
upstream cg_app {
    server 127.0.0.1:8788;
}

server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER;

    client_max_body_size 100M;

    # 上传 / 长耗时接口单独缓冲,避免被 nginx 拦截
    location /api/tools/ {
        proxy_pass http://cg_app;
        proxy_http_version 1.1;
        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        proxy_request_buffering off;
        proxy_buffering off;
    }

    location / {
        proxy_pass http://cg_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
    sed -i "s|DOMAIN_PLACEHOLDER|${DOMAIN:-_}|" /etc/nginx/sites-available/cg-resource-hub.conf
    ln -sf /etc/nginx/sites-available/cg-resource-hub.conf /etc/nginx/sites-enabled/cg-resource-hub.conf
    rm -f /etc/nginx/sites-enabled/default
    nginx -t && systemctl reload nginx
    log "Nginx 已配置"
fi

# -------- 8. systemd 守护(Docker 启动时自动拉起) --------
cat > /etc/systemd/system/cg-resource-hub.service <<'SERVICE'
[Unit]
Description=CG Resource Hub (docker compose)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/cg-resource-hub
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
ExecReload=/usr/bin/docker compose restart
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable cg-resource-hub.service

# -------- 9. 输出 --------
log "============================================================"
log "部署完成!"
log "项目目录: ${APP_DIR}"
log "访问:"
if $ENABLE_Nginx; then
    log "  http://${DOMAIN:-<服务器IP>}/"
else
    log "  http://<服务器IP>:8788/"
fi
log "管理命令:"
log "  cd ${APP_DIR} && docker compose logs -f     # 看日志"
log "  cd ${APP_DIR} && docker compose restart     # 重启"
log "  cd ${APP_DIR} && docker compose down        # 停止"
log "  systemctl status cg-resource-hub            # systemd 状态"
log "============================================================"