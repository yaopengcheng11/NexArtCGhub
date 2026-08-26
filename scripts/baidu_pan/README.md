# baidu_pan — 百度网盘 Open API 集成

让 Mavis / 项目脚本可以程序化读写你的百度网盘(上传、下载、列目录、分享、
双向同步)。基于 [`bypy`](https://github.com/houtianze/bypy) 1.8.9 封装。

## 一次性配置

### 1. 注册百度网盘开放平台开发者

1. 浏览器打开 https://pan.baidu.com/union/home/
2. 用你刚才建 `CGResourcesHub` 文件夹的那个**百度账号**登录
3. 顶部导航 → **应用管理** → **创建应用**
   - 应用类型: **个人云存储(PCS)**
   - 应用名称: `cg-resource-hub-local` (随便起)
   - 回调 URL: 填 `http://localhost:8989/callback` (bypy 默认监听 8989)
4. 创建完后, 在应用详情里复制:
   - `AppKey` (client_id) — 等会要填
   - `SecretKey` (client_secret) — 等会要填

### 2. 走首次 OAuth 授权

```powershell
# 激活虚拟环境
& "G:\AITOOLS\cg-resource-hub\scripts\baidu_pan\.venv\Scripts\Activate.ps1"

# 配置 client_id / client_secret(bypy 读 ~/.bypy/bypy.conf)
# 如果你用 bypy 的默认 app, 这一步会自动; 用自己注册的 app 就:
bypy -c  # 走交互式配置, 粘贴 AppKey / SecretKey

# 走 OAuth 授权 — 会打印一个 URL, 浏览器打开 → 同意 → 复制回调 URL 或 code
python cli.py init
```

成功标志: 终端最后一行出现 `登录态有效  配额: 12.34 GiB / 2048.00 GiB`。

### 3. 验证 CGResourcesHub 可见

```powershell
python cli.py ls /CGResourcesHub
```

应该看到空目录列表(因为是你刚建的)。

## 常用命令

```powershell
# 看自己是谁 + 配额
python cli.py whoami
python cli.py quota

# 列出远程目录(rich 表格输出)
python cli.py ls /CGResourcesHub

# 上传/下载
python cli.py upload "G:\path\to\file.zip" /CGResourcesHub/file.zip
python cli.py download /CGResourcesHub/file.zip "G:\path\to\file.zip"

# 创建子目录
python cli.py mkdir /CGResourcesHub/Houdini_HDAs

# 分享 — 拿一个公开链接(给同事/客户用)
python cli.py share /CGResourcesHub/some-asset.zip

# 双向同步 — 需要先 cp config.example.yaml config.yaml 并编辑 remote_root / local_root
python cli.py sync up      # 本地 → /CGResourcesHub
python cli.py sync down    # /CGResourcesHub → 本地
```

## 配置 `config.yaml`

```powershell
cp config.example.yaml config.yaml
# 然后编辑里面的 remote_root / local_root
```

`config.yaml` 已被 `.gitignore` 忽略, 不会进版本控制。

## 在项目其它脚本里调用

CLI 走的是 bypy 库, 你也可以直接在 Python 里 import:

```python
import bypy
bp = bypy.Bypy(rapidupload=True)
used, total = bp.quota()
bp.upload("local/file.hda", "/CGResourcesHub/file.hda")
bp.mkdir("/CGResourcesHub/Houdini")
bp.syncdown("/CGResourcesHub", "G:/mirror/")
```

## 目录结构

```
scripts/baidu_pan/
├── README.md             # 本文件
├── cli.py                # 入口
├── config.example.yaml   # 配置模板
├── .gitignore            # 忽略 config.yaml / .venv / data/
├── .venv/                # 虚拟环境(自动生成)
└── requirements.txt
```

## 排错

| 现象 | 原因 / 修复 |
|---|---|
| `未授权或 token 过期` | 跑 `python cli.py init` 重走 OAuth |
| `quota: (-1, -1)` | bypy token 失效, 重跑 `init` |
| `授权未完成` | 浏览器里没点同意, 或回调 URL 拼错 |
| `Error 31023` (用户未登录) | 浏览器登录态掉了, 重开 baidu 页面重试 |
| 上传 4 GiB 以上文件 | PCS API 单文件上限 4 GiB, 走分卷或换大文件接口 |

## Token 在哪?

bypy 把 `access_token` + `refresh_token` 存在:
- Windows: `C:\Users\yao_p\.bypy\bypy.json`
- Linux/macOS: `~/.bypy/bypy.json`

别把这个文件 commit 出去。
