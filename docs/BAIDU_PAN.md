# 百度网盘集成规范 (CGResourceHub)

> 适用范围:`cg-resource-hub` 项目的资源分发层。
> 最后更新:2026-08-24

## 1. 总体架构

CGResourceHub 项目的资源分发走 **百度网盘开放平台** 的 OAuth 授权,通过官方 `bdpan` CLI 二进制调用百度网盘"应用数据"(app data)命名空间:

```
cg-resource-hub DB (sqlite)
   resources.fileUrl ──> https://pan.baidu.com/s/<shareId>   ← 资源分享链接(公开 URL)
   resources.panCode ──> 4-char extraction code (e.g. "vpbf") ← 提取码,跟 URL 配对
                          (URL 单独不能下,要 URL + 提取码)
                                       │
                                       ▼
                          baidu pan "我的应用数据/bdpan/CGResourcesHub/<Software>/<Title>_full.zip"
                                       │
                                       ▼
                          用户点 button → window.open(fileUrl) → baidu 提示输入提取码
                                                            → 用户复制 panCode 粘贴 → 下载
```

**关键点**:
- 文件主人(本项目背后的百度账号)打开 share URL 跳过提取码 → 看到文件直接下
- 其他人打开 share URL → "请输入提取码" 提示 → 没 panCode 输不了 → 必须从我们网站复制
- 资源**只走百度网盘**,不在本地 server 服务(避免大文件占带宽)
- baidu pan 在 `/apps/bdpan/` 这个沙盒里,网页/客户端默认隐藏,要看用"我的应用数据 → bdpan"

## 2. 目录结构约定

```
/apps/bdpan/CGResourcesHub/                  ← 根(2026-08-24 起的项目根,所有人下载/分享都看这里)
│
├── Blender/                                 ← 软件文件夹(10 个,新建时 `bdpan mkdir`)
│   ├── RedAutumnForest_full.zip             ← 每资源 1 个 .zip,文件名 = <TitleSlug>_full.zip
│   ├── AfricanRhinocerosRig_full.zip
│   └── (将来更多)
│
├── Houdini/
│   └── (将来)
│
├── UnrealEngine/                            ← "Unreal Engine" 全名,空格去掉
│
├── Maya/
├── 3dsMax/                                  ← "3ds Max" → "3dsMax"
├── Nuke/
├── ZBrush/
├── SubstancePainter/                        ← 单词首字母大写
├── Cinema4D/                                ← "Cinema 4D" → "Cinema4D"
└── Other/                                   ← 兜底,识别不出软件时用
```

**10 个软件目录**已全部建好(见 `scripts/baidu_pan/manage.py verify` 输出):
- 加新软件:`bdpan mkdir /apps/bdpan/CGResourcesHub/<SoftwareFolder>` (1 行)

## 3. 命名规则(单一函数推导)

一切文件名/路径都通过 `scripts/baidu_pan/lib/path.py` 推导,**禁止硬编码路径**。

### 3.1 软件名 → 文件夹名

```python
sanitize_software("Unreal Engine")  -> "UnrealEngine"
sanitize_software("3ds Max")        -> "3dsMax"
sanitize_software("Cinema 4D")      -> "Cinema4D"
sanitize_software("ZBrush")         -> "ZBrush"
sanitize_software("Houdini")        -> "Houdini"
sanitize_software("ue5")            -> "UnrealEngine"   # 大小写不敏感
sanitize_software("")               -> "Other"
```

规则:拆分单词,PascalCase 连接;查 `SOFTWARE_FOLDER_OVERRIDES` 兜底特殊 case(3dsMax, Cinema4D 等)。
新加软件时如果默认规则不对,加到 `SOFTWARE_FOLDER_OVERRIDES` 表里。

### 3.2 资源标题 → 文件名 slug

```python
slugify_title("Red Autumn Forest")                       -> "RedAutumnForest"
slugify_title("Houdini Procedural City Generator")        -> "HoudiniProceduralCityGenerator"
slugify_title("UE5 — Realistic Environment Pack")        -> "UE5RealisticEnvironmentPack"
slugify_title("MyTool_v2 (final)")                       -> "MyToolV2Final"
slugify_title("abc 123 def")                             -> "Abc123Def"
```

规则:PascalCase,无分隔符。数字保持原位,首字母大写。

### 3.3 完整路径

```python
baidu_path("Blender", "Red Autumn Forest")
  -> "/apps/bdpan/CGResourcesHub/Blender/RedAutumnForest_full.zip"

baidu_path("Unreal Engine", "UE5 Pack")
  -> "/apps/bdpan/CGResourcesHub/UnrealEngine/UE5Pack_full.zip"
```

**所有 baidu 路径都通过 `pathmod.baidu_path(software, title)` 推导**,禁止拼接。

## 4. DB schema 关键约定

表 `resources`(完整 schema 见 `api/server/db.ts`):

| 字段 | 用途 | 约定 |
|---|---|---|
| `id` | 主键 | 自增 |
| `title` | 资源展示名 | **人类可读**(例:"Red Autumn Forest")。用于 `slugify_title` 推导 baidu 文件名。改 title 需同步 baidu 文件名。 |
| `category` | 资源主软件 | **显示名**(例:"Unreal Engine", "Blender")。**统一首字母大写 + 空格**。历史遗留的 `"blend"`(小写)等同于 `"Blender"`,已迁移。 |
| `fileUrl` | baidu pan 分享链接(无 `?pwd=`) | 例:`https://pan.baidu.com/s/1HwSg4x4UOjFYstGNwiw8_w`。由 `bdpan share` 生成,代码里手动剥掉 query string。 |
| `panCode` | 提取码(可空) | 例:`"vpbf"`。公开分享留空,私享必填。 |
| `tagGroups.software[]` | 软件列表 | 与 `category` 一致(单元素数组)。添加资源时自动写入 `{"software": [software]}`。 |
| `tagGroups.element[]` | 元素标签 | 例:["foliage", "rocks"] |
| `tagGroups.technique[]` | 技法标签 | 例:["procedural", "shader"] |

**`fileUrl` + `panCode` 是真正的真相源**(baidu 文件路径不存 DB,推导得出)。

## 5. 资源生命周期命令

所有命令通过 `scripts/baidu_pan/manage.py` 入口,**禁止绕过这个 CLI 直接调 `bdpan`**(避免人工失误导致 DB 和 baidu 状态不一致)。

| 命令 | 行为 |
|---|---|
| `upload <local> --software X --title "Y"` | 1) 推导 baidu 路径;2) 检查 DB 重复;3) mkdir 父目录;4) 上传;5) share;6) INSERT 资源行 |
| `delete <id> [--yes]` | 1) 读 DB 找 baidu 路径;2) `bdpan rm`;3) DELETE 行 |
| `rename <id> --new-title "Y" [--yes]` | 1) 推新旧 baidu 路径;2) `bdpan mv`;3) 重新 share;4) UPDATE `title`/`fileUrl`/`panCode` |
| `recategorize <id> --new-software X [--yes]` | 1) 推新旧 baidu 路径;2) `bdpan mv`;3) 重新 share;4) UPDATE `category`/`tagGroups`/`fileUrl`/`panCode` |
| `verify [--all | <id>]` | 1) HEAD `fileUrl`;2) `bdpan ls` 期望路径;3) 输出 `[OK]/[BAD]/[--]`。**没有 fileUrl 视为 disabled,不算 BAD**。 |

**加新资源的标准流程**(以后做这事就这一段):

```powershell
# 1. 文件准备好(本地 .zip,先打包好 fixed.blend + textures)
# 2. 一行命令搞定
& "G:\AITOOLS\cg-resource-hub\scripts\baidu_pan\.venv\Scripts\python.exe" `
   "G:\AITOOLS\cg-resource-hub\scripts\baidu_pan\manage.py" upload `
   "D:\path\to\payload.zip" `
   --software "Blender" `
   --title "My New Asset" `
   --description "..." `
   --element foliage rocks `
   --technique procedural

# 3. (可选)如果 upload 提示资源已存在(DB 重复),有 4 个选择:
#    r = reuse 现有 share URL
#    o = overwrite (删旧 baidu + DB,重传)
#    n = new title (重新问标题)
#    a = abort
```

**改分类/改名**:同样一行命令,自动 mv + 重 share + 改 DB。

## 6. 故障排查 / 已知问题

### 6.1 `bdpan login --get-auth-url` 等子命令(在 Git Bash 里)

Git Bash 会把 `/apps/bdpan` 自动翻译成 `C:\Program Files\Git\apps\bdpan` 导致 ERR -7。
**修法**:`MSYS_NO_PATHCONV=1` 前缀关掉 path conversion。

Python 子进程直接调 `bdpan.exe` 不走 Git Bash,**不受影响**。

### 6.2 `bdpan ls` 显示文件为"目录"

bdpan 在某些场景(文件夹下全是文件无子目录)会把所有 entries 的 `type` 标成 "目录"。
**修法**:`manage.py verify` 的存在性检查只看 `name.endswith(".zip")`,不依赖 type 字段。

### 6.3 分享 URL 在搬动文件后失效?

`bdpan mv` 移动文件时,share URL **保持有效**(URL 绑 fs_id,不是路径)。
**但代码默认 `recategorize` / `rename` 后会重新 share**,拿一个新 URL 写回 DB。这是稳妥做法,不是必须 — 如果你想保留旧 URL,把 `manage.py` 里 `re-share` 那步注释掉即可。

### 6.4 baidu 链接有效期

`bdpan share --period N`:N ∈ {0=永久, 1, 7, 30}。**默认 7 天**(upload 时不指定就用 7)。
永久链接(0)不会过期但文件一旦删,链接会失效。所有 share 链接需要在过期前重新生成(`bdpan share` 同一文件可重复调用,新链接叠加,旧的失效)。

### 6.5 token 过期

`bdpan whoami --json` 返回 `has_valid_token: false` 时:
```bash
# 用 Mavis 装好的 login 脚本
bash "/c/Users/yao_p/.minimax/agents/mavis/skills/baidu-drive/scripts/login.sh"
```

## 7. 文件清单

```
cg-resource-hub/
├── api/
│   ├── .env.example                        ← STRIPE_* + JWT_SECRET 等
│   └── server/
│       ├── db.ts                           ← resources 表 schema + 种子
│       └── server.ts                       ← /api/resources/* endpoints
├── docs/
│   └── BAIDU_PAN.md                        ← 本文件:集成规范
├── scripts/
│   └── baidu_pan/
│       ├── README.md                       ← 安装 + OAuth 引导
│       ├── config.example.yaml             ← 用户配置(local_root 等)
│       ├── cli.py                          ← 旧 CLI(whoami/quota/ls)
│       ├── manage.py                       ← 资源生命周期主控(upload/delete/rename/recategorize/verify)
│       └── lib/
│           ├── __init__.py
│           ├── path.py                     ← sanitize_software / slugify_title / baidu_path
│           ├── baidu.py                    ← bdpan CLI subprocess wrapper
│           └── db.py                       ← sqlite3 wrapper for resources table
└── web/
    └── src/
        └── pages/
            └── ResourceDetail.tsx          ← PanCodePill 组件 (Copy 提取码)
```

## 8. 后续优化方向(已记在 todo,这次没做)

- **Houdini HDA**:可以加一个 `manage.py upload-hda <local.hda>` 自动处理 `.hda` 文件,跳过 zip 打包
- **批量**:批量上传 N 个文件,自动分配 title/description(从文件名 + EXIF/metadata)
- **CDN 缓存**:在 `/apps/bdpan/` 之外用第三方 CDN(阿里云/腾讯云)做 download 加速
- **资源版本管理**:同一资源的多个版本 (v1/v2/v3) — 现在用 `_full.zip` 强制单版本
- **自动重新 share**:脚本定期扫描快过期的 share link,自动续期

## 9. 迁移日志

- **2026-08-24** 初始实施:
  - 在 baidu pan 建 10 个软件子目录
  - 把原有 2 个 zip 从 `/apps/bdpan/CGResourcesHub/` 根目录搬到 `Blender/`
  - 修 id=14 (DB `category="blend"` → `"Blender"`,`title` 占位名 → 真实名)
  - 修 baidu 文件名 `AfricanRhinoceros_Rig_full.zip` → `AfricanRhinocerosRig_full.zip`(符合 PascalCase 规则)
  - 写 `lib/path.py` + `lib/baidu.py` + `lib/db.py` + `manage.py` 自动化脚本
  - 加 web `PanCodePill` 组件,Copy 提取码到剪贴板
