<p align="center">
  <img src="docs/cover.jpg" alt="CG Resource Hub" />
</p>

<h1 align="center">CG Resource Hub</h1>

<p align="center">
  一个面向 CG / 3D 创作者的资源展示与下载平台。<br />
  采用自研 <strong>Ethereal</strong> 暖色调编辑风设计，支持公开浏览、分类筛选、下载统计与后台 CRUD。
</p>

<p align="center">
  <a href="#能力概览">能力</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#后端接口">API</a> ·
  <a href="#设计系统">设计系统</a>
</p>

---

## 能力概览

### 用户侧

- 浏览资源卡片网格，支持筛选与排序
- 按软件分类过滤：**All / Houdini / Unreal Engine / Blender**
- 查看封面、标题、描述、标签 pills、下载次数
- 点击「Get」按钮下载并自动累加下载计数

### 管理员侧

- JWT + HttpOnly Cookie 登录后台
- 资源表格查看、新增、编辑、删除（带二次确认）
- 标签以逗号字符串输入，自动 JSON 化
- 实时查看每条资源的下载次数

### 内置数据能力

- 首次启动自动创建 SQLite 数据库与表
- 自动创建默认管理员账号（`admin` / `admin123`）
- 数据库为空时自动注入 3 条演示资源

---

## 技术栈

**前端**

- React 19 + Vite 6 + React Router 7
- Tailwind CSS 4（`@tailwindcss/vite`）
- `motion/react`（framer-motion 继任者，资源卡入场与悬浮）
- `lucide-react` 图标

**后端**

- Express 4 + `cookie-parser`
- JWT（`jsonwebtoken`）+ `bcryptjs`
- SQLite（`sqlite3` 驱动，`sqlite` 包装）
- 开发模式由 `tsx` 运行，与 Vite 共享同一进程

**设计**

- 自研 **Ethereal** 设计令牌（详见 [设计系统](#设计系统)）
- 字体：Fraunces（衬线 display）、Inter（无衬线）、JetBrains Mono（标签）
- 全屏噪点纹理 + 三颗悬浮光球 + 玻璃态卡片

---

## 快速开始

### 环境要求

- Node.js 18 及以上（推荐 20 LTS 或更新）
- npm 9 及以上

### 安装与启动

```bash
npm install
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。

### 后台登录

访问 [http://localhost:3000/login](http://localhost:3000/login)，使用：

```text
username: admin
password: admin123
```

> ⚠️ 默认管理员账号写在初始化逻辑中，仅适合演示或内网原型。上线前请尽快修改。

---

## 技术架构

项目不是传统的"前端开发服务器 + 独立 API 服务"拆分模式，而是由一个统一的 Node 入口启动：

- 开发环境下，`server.ts` 启动 `Express`，并以中间件方式挂载 `Vite`
- 生产环境下，`Express` 直接托管 `dist/` 中的前端静态文件
- API 与前端页面共用同一个端口 `3000`

整体流程：

1. 浏览器访问 `/`
2. Express 返回前端页面
3. 前端通过 `/api/*` 调用资源与登录接口
4. 服务端通过 SQLite 读写 `data/database.sqlite`
5. 管理员登录成功后，服务端将 JWT 写入 `admin_token` Cookie
6. 后续后台接口通过 Cookie 校验管理员身份

---

## 目录结构

```text
cg-resource-hub/
|-- data/
|   `-- database.sqlite          # SQLite 数据库文件（运行后生成，已 gitignore）
|-- dist/                        # 前端构建产物
|-- docs/
|   `-- cover.png                # README 顶部封面图
|-- server/
|   `-- db.ts                    # 数据库初始化、建表、种子数据
|-- src/
|   |-- components/
|   |   `-- layout/
|   |       |-- Navbar.tsx       # 顶部导航 + 品牌 mark
|   |       `-- Footer.tsx       # 底部栏
|   |-- context/
|   |   `-- AuthContext.tsx      # 前端登录态上下文
|   |-- lib/
|   |   `-- utils.ts             # className 合并工具 (cn)
|   |-- pages/
|   |   |-- Home.tsx             # 首页 / 资源列表
|   |   |-- Login.tsx            # 管理员登录页
|   |   `-- Admin.tsx            # 资源管理后台
|   |-- App.tsx                  # 路由、全局装饰层（光球 + 噪点）
|   |-- index.css                # Tailwind 入口 + Ethereal 设计令牌
|   `-- main.tsx                 # React 挂载入口
|-- .env.example                 # 示例环境变量
|-- .gitignore
|-- index.html                   # Vite HTML 模板（字体预连接）
|-- package.json                 # 依赖与脚本
|-- server.ts                    # 服务端主入口
|-- tsconfig.json                # TypeScript 配置
`-- vite.config.ts               # Vite 配置
```

---

## 页面与功能

### 首页 `/`（`src/pages/Home.tsx`）

- 拉取 `/api/resources` 获取资源列表
- 左侧分类筛选侧栏（毛玻璃面板），右侧资源卡片网格
- 卡片含封面、标题、描述、标签 pills、下载次数与下载按钮
- `motion/react` 错峰入场，悬浮时 `y: -4` 上浮

### 登录页 `/login`（`src/pages/Login.tsx`）

- 提交用户名和密码到 `/api/auth/login`
- 登录成功后请求 `/api/auth/me` 写入 `AuthContext`
- 跳转到 `/admin`
- 页面底部展示默认管理员凭据，方便本地演示

### 后台 `/admin`（`src/pages/Admin.tsx`）

- 未登录时自动跳转到 `/login`
- 拉取全部资源，表格展示（毛玻璃容器）
- 弹窗表单新增/编辑：标题、描述、分类下拉、标签、封面 URL、下载 URL
- 删除带 `confirm()` 二次确认
- `tags` 表单以逗号分隔字符串输入，提交时转换为 JSON 字符串保存

---

## 后端接口

后端入口：`server.ts`

### 鉴权相关

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/login` | 管理员登录 | 公开 |
| `POST` | `/api/auth/logout` | 退出登录 | 已登录管理员 |
| `GET` | `/api/auth/me` | 获取当前登录用户 | 已登录管理员 |

Cookie 设置：

- 名称：`admin_token`
- 类型：`HttpOnly`
- 生产环境：`secure: true`

### 资源接口

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/resources` | 获取资源列表，支持分类与搜索 | 公开 |
| `GET` | `/api/resources/:id` | 获取单条资源详情 | 公开 |
| `POST` | `/api/resources/:id/download` | 下载计数 +1 | 公开 |
| `POST` | `/api/resources` | 新增资源 | 管理员 |
| `PUT` | `/api/resources/:id` | 更新资源 | 管理员 |
| `DELETE` | `/api/resources/:id` | 删除资源 | 管理员 |

#### 查询参数

`GET /api/resources` 支持：

- `category`：按分类过滤
- `search`：按标题或描述模糊搜索

示例：

```bash
GET /api/resources?category=Houdini
GET /api/resources?search=environment
GET /api/resources?category=UE&search=rock
```

### 资源数据格式

```json
{
  "id": 1,
  "title": "Houdini Procedural City Generator",
  "description": "A powerful Node setup for creating procedural cities instantly.",
  "category": "Houdini",
  "tags": "[\"procedural\", \"city\", \"hda\", \"generator\"]",
  "imageUrl": "https://example.com/image.jpg",
  "fileUrl": "https://example.com/download.zip",
  "downloadCount": 0,
  "createdAt": "2026-04-20 09:00:00",
  "updatedAt": "2026-04-20 09:00:00"
}
```

- `tags` 在数据库中是字符串字段，内容通常为 JSON 字符串
- 前端读取时优先尝试 `JSON.parse`，失败则退回到逗号分隔字符串模式

---

## 数据库设计

数据库初始化逻辑位于 `server/db.ts`。

### `users` 表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键，自增 |
| `username` | `TEXT` | 用户名，唯一 |
| `password` | `TEXT` | bcrypt 哈希后的密码 |

### `resources` 表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `INTEGER` | 主键，自增 |
| `title` | `TEXT` | 资源标题 |
| `description` | `TEXT` | 描述 |
| `category` | `TEXT` | 分类（Houdini / UE / Blender） |
| `tags` | `TEXT` | JSON 字符串 |
| `imageUrl` | `TEXT` | 封面图地址 |
| `fileUrl` | `TEXT` | 下载地址 |
| `downloadCount` | `INTEGER` | 下载次数，默认 0 |
| `createdAt` | `DATETIME` | 创建时间 |
| `updatedAt` | `DATETIME` | 更新时间 |

### 默认管理员

数据库首次初始化时自动创建：

- 用户名：`admin`
- 密码：`admin123`

正式项目请尽快修改默认密码。

### 种子数据

`resources` 表为空时自动写入 3 条演示资源：

- Houdini Procedural City Generator
- UE5 Realistic Environment Pack
- Blender Hard Surface Addon

---

## 设计系统

> 本节描述项目自带的 **"Ethereal"** 设计语言：一种介于杂志编辑感与创作者工具站之间的暖色调视觉风格。

### 色彩

暖色羊皮纸为底，调色板用 CSS 变量定义（见 `src/index.css` 的 `@theme`）：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-base` | `#f2efe8` | 页面底色（羊皮纸暖灰） |
| `--color-elevated` | `#fbfaf6` | 卡片/弹窗背景 |
| `--color-deep` | `#e8e2d5` | 悬浮态加深 |
| `--color-input` | `#f7f4ec` | 输入框背景 |
| `--color-fg` | `#1a1814` | 主前景（接近黑但带暖意） |
| `--color-fg-soft` | `#4a453e` | 次级前景 |
| `--color-fg-muted` | `#8a8278` | 标签 / 辅助文字 |
| `--color-fg-faint` | `#c5bfb1` | 最弱的提示线 |
| `--color-accent` | `#a8806b` | 主点缀：陶土橙 |
| `--color-accent-soft` | `#d4b896` | 辅助点缀：浅驼 |
| `--color-accent-glow` | `rgba(168,128,107,.25)` | 选中态高光 |

注意：项目**不是**深色 + emerald 风格，整套色系是浅色暖调。

### 字体

通过 `index.html` 预连接 Google Fonts 加载：

- **Fraunces**：可变字重的衬线字体，用于 H1/H2/H3 与品牌名 `Hub`
- **Inter**：300 字重的无衬线字体，用于正文与 UI 文本
- **JetBrains Mono**：用于全大写、宽 `letter-spacing` 的小标签与序号

### 视觉特效

`src/App.tsx` 与 `src/index.css` 共同实现：

- **悬浮光球（orb decoration）**：固定定位的三颗 `blur-3xl` 模糊大圆，分别使用 `--orb-warm`（暖橙）、`--orb-cool`（冷蓝灰）、`--orb-veil`（淡紫）
- **全屏噪点纹理（grain layer）**：SVG `feTurbulence` 平铺，`opacity: 0.04`，`mix-blend-mode: overlay`
- **玻璃态卡片（glassmorphism）**：所有卡片/侧栏/模态背景均使用 `rgba + backdrop-filter: blur(8–12px)`
- **Motion 入场**：`motion/react` 实现资源卡错峰 fade + 24px 上移，悬浮 `y: -4`
- **下划线动效**：导航项使用 `.ether-link::after`，宽度从 0 到 100% 平滑过渡

### 品牌 mark

Navbar 左侧 logo 故意做得很轻：单色小圆点 + `CG` + 斜体 `Hub`。整体走"少即是多"的编辑风。

---

## 环境变量

| 变量名 | 是否必需 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 建议设置 | JWT 签名密钥；未设置时会使用代码中的默认回退值 |
| `NODE_ENV` | 可选 | 控制开发/生产模式 |
| `DISABLE_HMR` | 可选 | 在 `vite.config.ts` 中控制是否禁用 HMR |

`.env.example` 中还保留了 `GEMINI_API_KEY`、`APP_URL`，这两个是 AI Studio 模板遗留项：当前业务代码并不真正调用 Gemini API，按需忽略即可。

---

## 构建与生产

```bash
npm run build      # vite build → dist/
npm run start      # NODE_ENV=production node server.ts
```

Windows PowerShell 下推荐：

```powershell
$env:NODE_ENV="production"; node server.ts
```

---

## 已知注意事项

1. 默认管理员账号写死在初始化逻辑中，仅适合演示或内网原型。
2. `JWT_SECRET` 未配置时使用硬编码回退值，不适合生产环境。
3. `start` 脚本为 Unix 风格，Windows 下兼容性一般（见上节）。
4. 资源下载接口只做下载计数累加，不负责真实文件代理或权限下载。
5. `tags` 目前存为文本字段（JSON 字符串），结构不算严格，后续可标准化。
6. 分类列表前端写死为 `Houdini / UE / Blender`。
7. 登录页直接展示默认管理员凭据，正式环境建议移除。
8. 整站为浅色暖调风格，不要误以为是深色 / emerald 主题。

---

## 后续可扩展方向

- 增加资源详情页
- 支持标签筛选和分页
- 接入对象存储或云盘签名下载
- 管理员密码修改与用户管理
- 上传图片与文件，而不是只填 URL
- 增加操作日志
- 增加资源审核、上下架状态
- 收藏、评分、评论等社区能力
- 将 SQLite 升级为 MySQL / PostgreSQL

---

如果只是想马上跑起来：

```bash
npm install
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)，使用 `admin / admin123` 进入后台。