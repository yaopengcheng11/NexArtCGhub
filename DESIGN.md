# CG Resource Hub — Visual Direction

> 风格名:**Ethereal** —— 极简中的呼吸感(燕麦白 + 玫瑰金 + 衬线大字 + 漂浮柔光斑)
> 触发背景:用户给的参考仓库 `yaopengcheng11/Ethereal` 不可访问,授权后由我基于 "Ethereal" 字面意境自定。
> Scope 约束:**只改视觉/风格**,不重构组件、不改 API、不动后端、不增功能。

---

## 1. 调色板

### 1.1 主色 (燕麦白底 / 暖陶土强调)

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg-base` | `#F2EFE8` | 页面主背景(暖燕麦白) |
| `--bg-elevated` | `#FBFAF6` | 卡片/弹窗/表头 |
| `--bg-deep` | `#E8E2D5` | 次级背景、hover 块 |
| `--bg-input` | `#F7F4EC` | 输入框底 |

### 1.2 文字

| Token | 值 | 用途 |
| --- | --- | --- |
| `--fg-primary` | `#1A1814` | 标题、主文 |
| `--fg-secondary` | `#4A453E` | 次文、表格内容 |
| `--fg-muted` | `#8A8278` | 标签、说明 |
| `--fg-faint` | `#C5BFB1` | 占位、极淡分隔 |

### 1.3 强调 (玫瑰金 / 暖陶土)

| Token | 值 | 用途 |
| --- | --- | --- |
| `--accent` | `#A8806B` | 主按钮、激活态、链接 hover |
| `--accent-soft` | `#D4B896` | 弱化强调、tag 背景 |
| `--accent-glow` | `rgba(168,128,107,0.25)` | hover 光晕、focus ring |

### 1.4 雾光斑 (背景装饰层)

| Token | 值 | 用途 |
| --- | --- | --- |
| `--orb-warm` | `rgba(212,184,150,0.45)` | 左上暖金 |
| `--orb-cool` | `rgba(176,196,212,0.35)` | 右上冷蓝 |
| `--orb-veil` | `rgba(220,204,228,0.4)` | 中下雾紫 |

### 1.5 边框 / 阴影

- 边框:几乎不用,需要时用 `rgba(26,24,20,0.08)`,仅 1px
- 阴影(卡片):`0 1px 0 rgba(26,24,20,0.03), 0 20px 50px -25px rgba(26,24,20,0.12)`
- 阴影(弹窗):`0 1px 0 rgba(26,24,20,0.04), 0 30px 80px -20px rgba(26,24,20,0.20)`

---

## 2. 字体

通过 Google Fonts CDN 加载,预连接 `fonts.googleapis.com` / `fonts.gstatic.com`。

| 角色 | 字体 | 字重 | 用途 |
| --- | --- | --- | --- |
| Display | **Fraunces** (variable) | 300–400 | 页面 H1/H2(serif 衬线,自带 ethereal 感) |
| Body | **Inter** (variable) | 300–500 | 正文、按钮、表格 |
| Mono | **JetBrains Mono** | 400 | `/LIBRARY/ASSETS` 这种 label、下载计数 |

CSS 变量绑定:
```css
--font-display: 'Fraunces', ui-serif, Georgia, serif;
--font-body:    'Inter', ui-sans-serif, system-ui, sans-serif;
--font-mono:    'JetBrains Mono', ui-monospace, monospace;
```

字重基调:大量 `font-light` (300),只有 mono/数字用 400,标题用 Fraunces 300-400,不做字重对比。

---

## 3. 间距 / 圆角

| 元素 | 值 |
| --- | --- |
| 卡片 | `rounded-3xl` (24px) |
| 按钮 | `rounded-full` (pill) |
| 输入框 | `rounded-xl` (12px) |
| 标签/徽章 | `rounded-full` (pill) |
| 区块内边距 | 6 / 8 (24-32px) |
| 区块之间 | 8 / 12 (32-48px) |

---

## 4. 装饰层

每个页面背景叠两层装饰:

1. **柔光斑**:3 个绝对定位 `blur-3xl` 圆(暖金/冷蓝/雾紫),透明度 0.35-0.45,`pointer-events-none`,`z-0`
2. **噪点肌理**:内联 SVG `<feTurbulence>` filter,opacity 0.04,平铺全屏,`mix-blend-overlay`

这两个层都放在 `App.tsx` 的最外层 `<div>` 下,内容层用 `relative z-10` 浮在上面。

---

## 5. 动效

| 场景 | 曲线 | 时长 |
| --- | --- | --- |
| 卡片入场 | `[0.22, 1, 0.36, 1]` | 0.7s,`y: 24 → 0` + `opacity 0 → 1` |
| 卡片 hover | linear | 0.4s,`scale 1 → 1.01`,阴影抬升 |
| 按钮 hover | linear | 0.25s,bg 从 `--accent` 提亮到 `--accent-soft` |
| 模态入场 | `[0.22, 1, 0.36, 1]` | 0.5s,`scale 0.96 → 1` + opacity |
| 链接下划线 | linear | 0.3s,宽度展开 |

**禁用**:任何 `animate-pulse` / `animate-spin`(除 loading 圈),emerald-style 强光晕。

---

## 6. 不变的(Scope 边界)

- 后端 `server.ts` / `server/db.ts`:不动
- API 路由 (`/api/auth/*`, `/api/resources/*`):不动
- 前端路由 (`/`, `/login`, `/admin`):不动
- 三个 page 文件结构 (Home / Login / Admin):不动,只改 className / 装饰
- AuthContext / 数据 fetch 逻辑:不动
- 资源数据字段 (`title/description/category/tags/imageUrl/fileUrl/downloadCount`):不动
- 三个 layout 组件结构 (Navbar / Footer):不动
