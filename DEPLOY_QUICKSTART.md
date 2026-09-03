# 腾讯云轻量 2C/2G 一键部署

> 本项目真正的大文件走百度网盘分发,服务器只跑 Node 全栈 + 存 SQLite,2C/2G 完全够用。

## 1. 服务器准备

| 项 | 要求 |
|---|---|
| 系统 | Ubuntu 22.04 LTS(腾讯云轻量自带) |
| 防火墙 | 放行 80 / 8788 / 22 |
| 公网 IP | 静态(轻量默认静态) |

## 2. 准备域名(可选)

- 没域名:直接用 IP 访问 `http://你的IP/`,**不用备案**(腾讯云轻量服务器有「备案豁免」流量额度)
- 有域名:解析 A 记录到 IP,加备案后才能在 80/443 跑

## 3. 部署步骤

### 3.1 SSH 登录

```bash
ssh root@你的服务器IP
```

### 3.2 拉代码 + 部署

**A. 本地推 git,然后服务器 pull**(推荐):

```bash
# 本地
git add -A && git commit -m "deploy: 腾讯云一键部署" && git push

# 服务器(首次)
ssh root@你的IP
git clone https://github.com/你的用户名/cg-resource-hub.git /opt/cg-resource-hub
cd /opt/cg-resource-hub
```

**B. 用 scp 直接传**(临时测试):

```bash
scp -r G:/AITOOLS/cg-resource-hub root@你的IP:/opt/
ssh root@你的IP "cd /opt/cg-resource-hub && bash scripts/setup_server.sh"
```

### 3.3 跑部署脚本

```bash
cd /opt/cg-resource-hub
sudo bash scripts/setup_server.sh --domain yourdomain.com
```

脚本会自动:
1. 检测 2G 内存 → 加 4GB swap
2. 装 Docker + docker compose v2
3. 复制 `.env.example` → `.env`,生成随机 JWT_SECRET 和 ADMIN_PASSWORD
4. `docker compose build`(第一次约 5-10 分钟,装 node_modules)
5. `docker compose up -d`
6. 装 Nginx 反代
7. 注册 systemd `cg-resource-hub.service`,开机自启

### 3.4 改 .env 关键配置

```bash
nano /opt/cg-resource-hub/.env
```

至少检查 / 修改:
```env
JWT_SECRET=<自动生成,别动>
ADMIN_PASSWORD=<自己改,或者用生成的>
CORS_ORIGIN=https://yourdomain.com   # 改域名,不要再用 *
```

改完重启:
```bash
cd /opt/cg-resource-hub && docker compose restart
```

### 3.5 验证

```bash
bash scripts/healthcheck.sh
```

预期输出:
- Docker 容器状态: `running`
- HTTP 健康检查: `/api/health` 返回 200
- 内存 / 磁盘 / swap: 看到 4GB swap 已启用

浏览器访问 `http://你的IP/` 应能看到 CG Resource Hub 首页。

## 4. 日常运维

```bash
cd /opt/cg-resource-hub

# 看日志
docker compose logs -f app

# 重启
docker compose restart

# 升级(拉新代码后)
git pull && docker compose build && docker compose up -d

# 数据库备份(每天跑,加 cron)
cp api/data/database.sqlite backups/db-$(date +%Y%m%d-%H%M).sqlite

# 进入容器调试
docker compose exec app sh
```

## 5. 装 systemd 定时备份(防丢数据)

```bash
cat > /etc/systemd/system/cg-backup.service <<'EOF'
[Unit]
Description=Backup CG Resource Hub DB

[Service]
Type=oneshot
WorkingDirectory=/opt/cg-resource-hub
ExecStart=/bin/bash -c 'cp api/data/database.sqlite /opt/cg-resource-hub/backups/db-$(date +\%Y\%m\%d-\%H\%M).sqlite && find /opt/cg-resource-hub/backups -name "db-*.sqlite" -mtime +30 -delete'
EOF

cat > /etc/systemd/system/cg-backup.timer <<'EOF'
[Unit]
Description=Daily backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now cg-backup.timer
```

## 6. 故障排查

| 现象 | 检查 |
|---|---|
| 容器起不来 | `docker compose logs app` 看具体错误 |
| 502 Bad Gateway | 容器没起,或 8788 端口没监听 |
| OOM killed | `docker compose ps` 看 STATUS 列是否有 "OOMKilled";降低 docker-compose.yml 里的 memory 限制 |
| 内存仍紧张 | `free -h` 看 swap 是否真生效;`docker stats` 看容器实际占用 |

## 7. 升级到 Oracle Cloud(可选)

如果想迁到 Oracle Cloud Always Free ARM(永久免费 4C/24G),主要差异:
- 用 ARM64 镜像:`docker buildx build --platform linux/arm64 ...`
- `sqlite3` 需要在 Dockerfile 装 `python3 make g++` 给 ARM 编译
- Oracle 首尔/东京节点,国内延迟 ~70-180ms

## 8. 不需要做的事

❌ **不要**把 `data/blend_assets/` 传到服务器(走百度网盘)
❌ **不要**把 9.5 GB 数据迁移到云盘 / COS
❌ **不要**把 systemd `mysql` 之类的数据库服务装上(SQLite 已经够了)
❌ **不要**给服务器配大带宽(下载走百度,服务器只跑 API)