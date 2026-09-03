<p align="center">
  <img src="docs/cover.jpg" alt="CG Resource Hub" />
</p>

<h1 align="center">CG Resource Hub</h1>

<p align="center">
  面向 CG / 3D 创作者的资源展示与下载平台。<br />
  采用自研 <strong>Ethereal</strong> 暖色调编辑风设计，支持公开浏览、分类筛选、下载统计、邀请码注册、Houdini/Blender 在线工具与后台 CRUD。
</p>

<p align="center">
  <a href="#能力概览">能力</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#后端接口">API</a> ·
  <a href="#安全模型">安全</a> ·
  <a href="#设计系统">设计系统</a>
</p>

---

## 能力概览

### 用户侧

- 浏览资源卡片网格，支持按软件（**Houdini / Unreal / Blender**）筛选
- 查看封面、标题、描述、标签 pills、下载次数；点击「下载」累加计数
- 邀请码注册 + 邮箱 / 用户名登录

### 在线工具（`/tools/*`）

- **HIP Path Doctor**：上传 `.hip`，后台跑 Houdini hython，自动修复 `$HIP` / `$JOB` 路径错误（4 种 feature：转 slash、整段替换、找缺失、abs/rel 切换）
- **HIP Format Bridge**：上传 `.step` / `.stl` / `.3ds` 等格式，自动通过 FreeCAD 转换成 `.hip`
- **3DGS Auto Trainer**：上传图片 zip，自动跑 COLMAP 稀疏重建 + Houdini ML 3DGS TOP cook
- 每个工具：每用户 5 req/min 限流、10 min hython watchdog、50 MB stdout 上限，失败返回 zip 内嵌 audit `.md`

### 管理员侧（`/admin`）

- JWT + HttpOnly Cookie 登录后台（30 天有效期）
- **Resources** 标签页：表格 + 模态框表单 + 多维度标签选择器（software / element / technique）
- **Users** 标签页：列表 / 删除（自己 / 最后一个 admin 不可删）
- **Invites** 标签页：生成 / 复制链接 / 撤销邀请码
- Stripe checkout（配置 key 后启用）：credits 购买 + HDA license 一次性签名下载

### 支付（`/pricing`）

- **支付宝 电脑网站支付 + 微信支付 Native 扫码**：人民币直连渠道（个体户/企业资质），零 SDK 依赖、
  自实现 RSA2 / APIv3 签名验签；CN 用户点购买 → 选支付方式 → 支付宝跳转收银台 / 微信扫码二维码，
  前端轮询订单状态自动跳转
- **Stripe Checkout**：国际卡支付（USD 区），配置 key 后启用
- 三渠道共用同一张 `payments` 表与发放逻辑（加积分 / 发 HDA license），回调均验签 + 金额比对 + 事务幂等
- `PAYMENT_MOCK=1`（仅 dev）本地假收银台，无商户号也能端到端联调
- 资质与密钥申请路线图见 [docs/payment-roadmap.html](./docs/payment-roadmap.html)

---

## 技术栈

**前端** — `web/`

- React 19 + Vite 6 + React Router 7
- Tailwind CSS 4（`@tailwindcss/vite`）
- `motion/react` 动画 · `lucide-react` 图标
- 所有 fetch 走 `lib/api.ts` 包装（带 credentials: 'include' + AbortController + 类型守卫）
- i18n 双语（EN/ZH）强类型：`t('tool.foo')` 编译期校验
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`

**后端** — `api/`

- Express 4 + `cookie-parser` + `express-rate-limit`
- JWT（`jsonwebtoken`）+ `bcryptjs`（cost 12）
- SQLite（`sqlite3` 驱动，`sqlite` 包装，WAL 模式，busy_timeout=5000，foreign_keys=ON）
- Python 子进程：`spawn` hython.exe / blender.exe（10 min watchdog）
- 自带 Stripe REST helper（无 npm SDK 依赖）+ HMAC webhook 签名校验 + 幂等表
- 支付宝（RSA2 签名验签 + 电脑网站支付）与微信支付 APIv3（请求签名 / Native 下单 / 回调验签 + AES-GCM 解密）helper，同样零依赖（`server/payment/`）
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`

**设计**

- 自研 **Ethereal** 设计令牌（详见 [设计系统](#设计系统)）
- 字体：Fraunces（衬线 display）、Inter（无衬线）、JetBrains Mono（标签）
- 全屏噪点纹理 + 三颗悬浮光球 + 玻璃态卡片

---

## 快速开始

### 环境要求

- Node.js **20 LTS** 或更新
- npm 9 或更新
- 可选：Houdini（Hython）for `/tools/hip-*` 与 `/tools/gsplats-trainer`，Blender for `/api/admin/blend-assets`

### 安装与启动

项目是 **two-package monorepo**，前后端各自独立安装、独立运行：

```bash
# 后端 — Express + SQLite
cd api
npm install
npm run dev          # tsx watch 模式，端口 8789

# 前端 — Vite + React（另开一个终端）
cd web
npm install
npm run dev          # 端口 5173，自动把 /api/* 代理到 8789
```

打开 <http://127.0.0.1:5173>。

### 后台登录

访问 <http://127.0.0.1:5173/admin>，使用：

```text
email:    yao_pengcheng@outlook.com
password: 123456
```

> ⚠️ 默认管理员账号来自 `api/.env`（SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD），**首次启动且仅当这两个 env 未设置时**，数据库初始化会用环境变量里配置的凭据创建管理员。后续重启不会再覆盖已存在的管理员密码。生产环境部署前请：
> 1. 生成强随机 JWT_SECRET：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
> 2. 修改 SUPER_ADMIN_PASSWORD
> 3. 删除或替换 `api/.env` 中的默认值

---

## 目录结构

```
cg-resource-hub/
|-- api/                           # 后端 — Express 4 + SQLite
|   |-- server.ts                  # 路由 + 中间件 + startServer()
|   |-- server/
|   |   |-- db.ts                  # Schema + 迁移 + admin seed
|   |   |-- stripe.ts              # Stripe REST + webhook sig verify
|   |   |-- payment/               # CN 直连支付渠道（零 SDK 依赖）
|   |   |   |-- alipay.ts          # RSA2 签名/验签 + 电脑网站支付 + notify 校验
|   |   |   |-- wechat.ts          # APIv3 签名 + Native 下单 + 回调验签/解密
|   |   |   `-- fulfil.ts          # 三渠道共享发货逻辑（积分 / license）
|   |   `-- lib/
|   |       `-- toolEndpoint.ts    # createToolEndpoint(spec) — 三个工具路由共享
|   |-- tools/                     # Python 脚本（被 hython / blender 子进程调用）
|   |   |-- hip_path_doctor.py
|   |   |-- hip_format_bridge.py
|   |   |-- gsplats_auto_trainer.py
|   |   `-- blend_*.py
|   |-- data/                      # SQLite 数据库（gitignore）
|   |-- .env.example               # 环境变量模板
|   `-- package.json
|
|-- web/                           # 前端 — Vite 6 + React 19
|   |-- src/
|   |   |-- pages/                 # 路由页面
|   |   |   |-- Home.tsx           # /                — 资源列表
|   |   |   |-- ResourceDetail.tsx # /resource/:id    — 详情 + 下载
|   |   |   |-- ToolHipPathDoctor.tsx
|   |   |   |-- ToolHipFormatBridge.tsx
|   |   |   |-- ToolGsplatsTrainer.tsx
|   |   |   |-- Pricing.tsx         # /pricing         — Stripe checkout
|   |   |   |-- Login.tsx          # /login
|   |   |   |-- Register.tsx       # /register
|   |   |   `-- Admin.tsx          # /admin           — 控制台
|   |   |-- components/             # 共享 + admin-scoped 组件
|   |   |   |-- ProtectedRoute.tsx # 路由守卫
|   |   |   |-- NotFound.tsx
|   |   |   |-- ErrorBoundary.tsx
|   |   |   |-- ConfirmDialog.tsx  # 替换 window.confirm，键盘可达
|   |   |   |-- Toast.tsx          # 替换 alert，3 色自动消失
|   |   |   `-- admin/             # Admin 子组件
|   |   |       |-- UsersTab.tsx
|   |   |       |-- InvitesTab.tsx
|   |   |       |-- ResourceEditModal.tsx
|   |   |       `-- FilePicker.tsx
|   |   |-- hooks/
|   |   |   `-- useToolRun.ts      # 工具页共享 state machine
|   |   |-- lib/
|   |   |   `-- api.ts             # apiFetch<T>() 包装（cookie + 类型守卫）
|   |   |-- i18n/
|   |   |   |-- I18nContext.tsx
|   |   |   |-- dictionaries.ts     # 强类型 DictKey
|   |   |   `-- zh.ts               # Record<DictKey, string>
|   |   |-- types/
|   |   |   `-- admin.ts           # 共享前端类型
|   |   |-- context/
|   |   |   `-- AuthContext.tsx
|   |   |-- App.tsx
|   |   `-- main.tsx
|   `-- package.json
|
|-- scripts/baidu_pan/             # Baidu 网盘资源上传工具（独立 CLI）
|-- docs/
|   |-- cover.jpg                  # README 顶部封面图
|   |-- BAIDU_PAN.md               # 网盘工具使用文档
|   `-- payment-roadmap.html       # 收款上线路线图（个体户/备案/支付宝微信/补贴）
|-- DESIGN.md                      # 视觉风格指南
|-- .gitignore
`-- README.md                      # ← you are here
```

### 为什么不合并前后端？

- **更干净的安装。** 前端开发者只需 `npm install` 在 `web/`，后端开发者只需 `npm install` 在 `api/`。互不污染 200MB+ 的无关依赖。
- **独立扩缩容。** 把静态 `web/dist/` 部署到 CDN，API 跑在反向代理后；或者单 box 部署，由 API 直接 serve `web/dist/`（默认行为）。
- **不同运行时。** API 用 Node 22 LTS，前端 bundle 跑在浏览器里。

---

## 生产构建

```bash
cd web
npm run build       # → web/dist/

cd ../api
NODE_ENV=production npm start
```

设置 `NODE_ENV=production` 后，API 自动把 `web/dist/` 作为静态文件 serve，加 SPA fallback 到 `index.html`。**单端口（默认 8789）同时托管 bundle 与 API**。

`npm run preview`（在 `web/`）跑生产构建的本地预览，同样带 `/api` 代理。

---

## 环境变量

复制 `api/.env.example` 为 `api/.env` 后按需修改：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8789` | API 监听端口 |
| `JWT_SECRET` | *（必填）* | ≥32 字符随机字符串；占位符或过短时服务**拒绝启动** |
| `INVITE_CODE` | `ethereal-2026` | 邀请码静态回退；admin 在 `/admin` 生成的码覆盖它 |
| `CORS_ORIGIN` | `http://localhost:5173` | dev CORS 来源，逗号分隔 |
| `SUPER_ADMIN_EMAIL` | *（必填才能 seed）* | 引导 admin 邮箱 |
| `SUPER_ADMIN_PASSWORD` | *（必填才能 seed）* | 引导 admin 密码 |
| `HYTHON_PATH` | *(工具需要)* | `hython.exe` 绝对路径 |
| `BLENDER_EXE` | `D:/Blender/blender.exe` | Blender 路径 |
| `HDA_FILE_PATH` | *(可选)* | `.hda` 二进制路径（Stripe 销售用） |
| `STRIPE_SECRET_KEY` | *(空 → /checkout 503)* | Stripe live secret |
| `STRIPE_WEBHOOK_SECRET` | *(用了 Stripe 必填)* | webhook 签名密钥 |
| `STRIPE_PUBLISHABLE_KEY` | *(可选)* | 暴露给 `/api/pricing` 给前端 |
| `PUBLIC_ORIGIN` | *(生产必填)* | 对外域名（支付回调 / 成功页跳转根） |
| `FRONTEND_ORIGIN` | *(dev 前后端分离时)* | 浏览器落地 origin（支付宝 return_url / mock 跳转用） |
| `ALIPAY_APP_ID` / `ALIPAY_PRIVATE_KEY` / `ALIPAY_PUBLIC_KEY` | *(空 → 不启用)* | 支付宝电脑网站支付三件套；配好后 CNY 区自动切直连 |
| `WXPAY_MCHID` / `WXPAY_APPID` / `WXPAY_SERIAL_NO` / `WXPAY_PRIVATE_KEY` / `WXPAY_APIV3_KEY` | *(空 → 不启用)* | 微信支付 APIv3 Native；平台证书自动拉取缓存 |
| `PAYMENT_MOCK` | `0` | `1` 时用本地假收银台替换 CN 网关（仅 dev，生产拒绝启用） |
| `DB_PATH` | `./data/database.sqlite` | 相对 `api/` cwd |

**前端无运行时环境变量**（刻意为之 —— API 是唯一可信源）。

---

## 后端接口

后端入口 `api/server.ts`。所有路由以 `/api` 为前缀。鉴权用 HttpOnly cookie `admin_token`（JWT，30 天有效期）。

### 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/auth/register` | `{ code, username, email, password }` |
| `POST` | `/api/auth/login` | `{ username, password }`（username 可为邮箱） |
| `POST` | `/api/auth/logout` | 清 cookie |
| `GET` | `/api/auth/me` | 当前用户（需登录） |
| `GET` | `/api/resources[?category=]` | 资源列表 |
| `GET` | `/api/resources/:id` | 资源详情（解析 `tagGroups`） |
| `POST` | `/api/resources/:id/download` | 计数 +1 |
| `GET` | `/api/credits/balance` | `{ credits, isSubscribed, resetAt }`（需登录） |
| `POST` | `/api/checkout/credits` | credits 结账（需登录；CNY 按 `method` 走支付宝/微信，USD 走 Stripe） |
| `POST` | `/api/checkout/hda` | HDA license 结账（同上） |
| `GET` | `/api/payments/lookup?session_id=\|payment_id=` | success 页元数据（Stripe / CN 直通）（需登录） |
| `GET` | `/api/payments/:id/status` | 订单状态轮询（微信扫码用，需登录本人订单） |
| `GET` | `/api/hda/download?token=…` | HDA 一次性签名下载 |
| `GET` | `/api/pricing` | 价格表 + 区域 |
| `GET` | `/api/blend-assets/:id/{assets,thumbnail,renders,manifest}` | blend 资产公开读 |

### 工具接口（限流：每用户 5 req/min）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/tools/hip-path-doctor/run` | 上传 `.hip` → 修复后的 `.hip` + audit `.md` zip |
| `POST` | `/api/tools/hip-format-bridge/run` | 上传 `.3ds`/`.step`/etc → `.hip` + audit zip |
| `POST` | `/api/tools/gsplats-trainer/run` | 上传图片 zip → `.hip` + COLMAP cook |

### 管理员接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/admin/resources` | 创建（支持 multipart 上传） |
| `PUT` | `/api/admin/resources/:id` | 更新 |
| `DELETE` | `/api/admin/resources/:id` | 删除（同时清 `data/blend_assets/:id/`） |
| `POST` | `/api/admin/blend-assets` | `.blend` + 可选 `textures.zip` → manifest 流水线 |
| `GET` | `/api/admin/users` | 用户列表 |
| `DELETE` | `/api/admin/users/:id` | 删除（自己 / 最后一个 admin 不可删） |
| `POST` | `/api/admin/users/:id/toggle-admin` | 升降级（最后一个 admin 不可降） |
| `POST` | `/api/admin/users/:id/toggle-subscribe` | 手动切换订阅 |
| `GET` | `/api/admin/invites` | 邀请码列表 |
| `POST` | `/api/admin/invites` | 生成新码 |
| `DELETE` | `/api/admin/invites/:id` | 撤销 |
| `POST` | `/api/admin/credits/grant` | 手动积分 |
| `GET` | `/api/admin/credits/users` | 积分余额 |

### 支付回调（按配置启用）

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/webhooks/stripe` | 原始 body + HMAC 校验 + **幂等**（webhook_events 表） |
| `POST` | `/api/webhooks/alipay` | RSA2 验签 + app_id/金额比对 + 事务幂等；应答 `success`/`fail` 文本 |
| `POST` | `/api/webhooks/wechat` | APIv3 平台证书验签 + AES-256-GCM 解密 + 金额比对；应答 `{"code":"SUCCESS"}` |

---

## 安全模型

这是真实生产代码，安全不是事后补丁。

- **鉴权**：bcrypt 哈希（cost 12），JWT 写入 HttpOnly cookie，30 天有效期；JWT_SECRET 启动时强制要求 ≥32 字符且非占位符
- **授权**：三层中间件 `requireAuth`（验 JWT + 每月积分重置）→ `requireAdmin`（角色检查）→ 路由内业务逻辑；`toggle-admin` 与 `DELETE /api/admin/users/:id` 都拒绝把最后一个 admin 降级/删除，控制台永不自我锁定
- **支付回调（三家渠道）**：Stripe HMAC-SHA256 + 5 min 重放窗口；支付宝 RSA2 验签 + app_id/金额比对；微信 APIv3 平台证书验签 + AES-256-GCM 解密。三渠道共享 `fulfilPayment`：`BEGIN IMMEDIATE` 事务 + `payments.status='pending'` 守卫 + 金额比对，重复投递不会重复发积分或 license
- **子进程安全**：所有 spawn 用 `argv` 列表（不经过 shell）；启动前校验扩展名 + 大小；10 分钟 watchdog 强杀子进程；50 MB stdout 上限；任何退出路径都清理 tmp 目录
- **并发写安全**：SQLite WAL 模式 + `busy_timeout=5000` + 外键强制；积分扣减是单条原子 `UPDATE … WHERE creditsRemaining > 0`，并发请求不可能双花
- **限流**：工具端点 5 req/min/user（`express-rate-limit`）
- **错误隔离**：catch 块记 stdout 详细日志，客户端永远拿到 generic JSON；全局 Express error middleware 接住任何逃逸的异步异常

数据库表：`users`、`resources`、`invites`、`payments`、`licenses`、`hdaDownloads`、`webhook_events`、`collectionShareLinks`。关键约束：`users.role` / `payments.kind` / `payments.status` / `licenses.tier` 都有 `CHECK`，`payments.providerSessionId` / `licenses.key` / `hdaDownloads.token` 都有 `UNIQUE`。索引：`resources(createdAt DESC)`、`resources(category)`、`payments(userId)`、`licenses(userId)`、`invites(createdBy)`。

---

## 设计系统

详见 [DESIGN.md](./DESIGN.md)。速查：

- 背景 oat `#F2EFE8`，表面白 `#FBFAF6`
- 主色 rose-gold `#A8806B`
- Display：Fraunces（衬线）· UI：Inter（无衬线）· Mono：JetBrains Mono
- 柔和噪点纹理、磨砂光球、无硬阴影

---

## 路线图

- 增加资源审核、上下架状态
- 收藏 / 评分 / 评论等社区能力
- 将 SQLite 升级到 MySQL / PostgreSQL（schema 已 portable，仅需替换 `api/server/db.ts`）
