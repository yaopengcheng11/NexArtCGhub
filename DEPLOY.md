# 生产部署指南

本目录下的文件组成一套完整的生产部署:

| 文件 | 作用 |
|---|---|
| `Dockerfile` | 多阶段构建镜像(已存在) |
| `docker-compose.yml` | 容器编排 + 资源限制 + 数据卷 |
| `.env.example` | 环境变量样例 |
| `scripts/setup_server.sh` | 一键部署(装 Docker + swap + 拉项目 + 起服务) |
| `scripts/add_swap.sh` | 单独加 swap |
| `scripts/migrate_data_to_disk.sh` | 数据迁移到独立云盘 |
| `scripts/migrate_data_to_cos.sh` | 数据迁移到对象存储 |
| `scripts/healthcheck.sh` | 部署后体检 |

## 快速开始(腾讯云轻量 2C/2G/4M)

```bash
# 1. 准备
git clone <你的仓库> /opt/cg-resource-hub
cd /opt/cg-resource-hub

# 2. 配置环境变量
cp .env.example .env
nano .env   # 至少改 JWT_SECRET 和 ADMIN_PASSWORD

# 3. 一键部署
sudo ./scripts/setup_server.sh
```

部署完成后会自动:
- 检测内存 ≤4G 时加 4GB swap
- 装 Docker + Docker Compose v2
- 构建并启动容器(资源限制:1.5G 内存 / 1.5 核)
- 安装 Nginx 反代(可选,可用 `--no-nginx` 关掉)
- 注册 systemd 服务,开机自启

## 日常运维

```bash
# 看日志
docker compose logs -f app

# 健康检查
./scripts/healthcheck.sh

# 重启
docker compose restart

# 升级
git pull && docker compose build && docker compose up -d

# 备份数据库
cp api/data/database.sqlite backup/db-$(date +%Y%m%d).sqlite
```

## 数据迁移建议

**重要**:本项目的资源文件(9.5 GB `.blend` 等)走**百度网盘分发**,不在服务器本地,见 `docs/BAIDU_PAN.md`。

服务器只负责:
- 跑 Web 服务(Express + React 静态)
- 存 SQLite 数据库(`api/data/database.sqlite`,通常 < 1 MB)
- 收用户上传的临时文件(`data/tools_uploads/`)

数据库里 `resources.fileUrl + panCode` 指向百度网盘分享链接,用户点下载就走百度。

所以**不需要"数据迁移"脚本**,服务器上 `data/blend_assets/` 是空的。

唯一需要关注的是 `data/tools_uploads/`(在线工具上传的 `.hip`/`.zip` 等),如果用得多,挂到大点的云盘:

| 目录 | 月成本 | 何时考虑 |
|---|---|---|
| `data/tools_uploads/`(用户上传) | 留系统盘 / 挂云盘 | 用户量大了再分 |

## 注意事项

- 2GB 内存机器一定要执行 `add_swap.sh`,否则 Node + SQLite + tsx 启动很容易 OOM
- docker-compose.yml 已限制容器内存 1.5G,触发 OOM 会被 kill 但不会拖死整机
- 跑 Houdini 工具时(hython 子进程),建议临时把内存限制调到 3G+ 或停掉容器内存限制

## 支付接入(支付宝 / 微信支付 / Stripe)

三套渠道共用同一张 `payments` 表和同一份发放逻辑(加积分 / 发 HDA license),
在 `api/.env` 里配好哪家用哪家的,定价页(CNY 区)自动出现对应入口:

| 渠道 | 适用 | 需要的资质 |
| --- | --- | --- |
| 支付宝 电脑网站支付 | 中国大陆用户,人民币直结 | 支付宝开放平台企业/个体工商户 + 签约"电脑网站支付" |
| 微信支付 Native 扫码 | 中国大陆用户,人民币直结 | 微信支付商户号 + 开通"Native 支付" |
| Stripe (card / Alipay / WeChat) | 国际卡用户 | 境外主体(大陆个人/企业无法开户) |

**支付宝**(`api/.env`):`ALIPAY_APP_ID` + `ALIPAY_PRIVATE_KEY`(应用私钥 PKCS8)+
`ALIPAY_PUBLIC_KEY`(支付宝公钥,不是你的应用公钥)。无需在开放平台配置固定回调地址,
下单时带 `notify_url`(`https://你的域名/api/webhooks/alipay`)。

**微信支付**:`WXPAY_MCHID` + `WXPAY_APPID` + `WXPAY_SERIAL_NO`(API 证书序列号)+
`WXPAY_PRIVATE_KEY`(apiclient_key.pem)+ `WXPAY_APIV3_KEY`(32 位)。
回调地址固定为 `https://你的域名/api/webhooks/wechat`,平台证书自动拉取缓存。

**上线前检查**:

- `PUBLIC_ORIGIN` 必须设置成对外域名(回调、支付跳转都靠它)
- 支付宝商户平台把网关加白 / 微信商户平台配置好回调域名
- 不要在生产开 `PAYMENT_MOCK=1`(它会替换成假收银台,且仅 dev 模式生效)
- 真实支付验证:各渠道先付最小档(¥35),确认积分到账、`payments` 表
  `status=completed`、微信/支付宝后台能看到这笔交易