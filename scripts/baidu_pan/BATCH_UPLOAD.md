# blend_assets 批量上传百度网盘指南

## 0. 为什么需要这一步

本项目通过 **百度网盘** 分发 Blender/Houdini 等大文件:
- 服务器只存 SQLite(里面写 `fileUrl + panCode`)
- 用户点下载走百度网盘
- 资源本体(9.5 GB `data/blend_assets/`)在本地,需上传到百度

## 1. 首次配置(只做一次)

### 1.1 装依赖

```bash
cd scripts/baidu_pan
python -m pip install -r requirements.txt
```

### 1.2 初始化百度网盘授权

`manage.py` 用的是 `bypy`(百度网盘 Python 客户端),首次跑会弹 OAuth 链接:

```bash
python manage.py verify
# 第一次会显示一个 URL,复制到浏览器登录百度账号授权
# 授权后会得到一个 code,粘贴回终端
# bypy 把 token 缓存到 ~/.bypy/bypy.json,以后不用再授权
```

### 1.3 配置要上传到的网盘目录

```bash
cp config.example.yaml config.yaml
nano config.yaml
# 改 remote_root 为你在百度网盘建的目录,例如:/CGResourcesHub
```

### 1.4 在百度网盘建好目录结构

`docs/BAIDU_PAN.md` 里列了 10 个软件目录,先创建好:

```python
# 一键创建(可在 manage.py 里加个 mkdir 命令,或直接走网盘客户端)
# Blender/  Houdini/  UnrealEngine/  Maya/  3dsMax/  Nuke/
# ZBrush/  SubstancePainter/  Cinema4D/  Other/
```

## 2. 给每个资源补 manifest.json

工具会读 `data/blend_assets/<id>/manifest.json`,缺字段会用目录名兜底。

最小可用的 manifest.json:
```json
{
  "title": "African Rhinoceros Rig",
  "software": "Blender",
  "description": "完整骨骼绑定的非洲犀牛模型,含 4K 贴图",
  "element": ["animal", "rigging"],
  "technique": ["modeling", "rigging"]
}
```

没有 manifest 的资源也能传,只是 title 默认为目录名。

## 3. 批量上传

### 3.1 先 dry-run 看会传什么

```bash
cd scripts/baidu_pan
python batch_upload_blend_assets.py --dry-run --limit 3
# 应该打印出 3 条 manage.py upload 命令,但不真传
```

### 3.2 真传一个试试

```bash
python batch_upload_blend_assets.py --id 14
# 看 manage.py upload 输出,确认百度网盘目录、文件、分享链接都对
```

### 3.3 全量上传

```bash
python batch_upload_blend_assets.py
```

每个资源会:
1. 调用 `manage.py upload <file> --software Blender --title ...`
2. `manage.py` 内部:
   - 用 `bypy` 上传到百度 `/apps/bdpan/CGResourcesHub/Blender/<Title>_full.zip`
   - 创建公开分享链接 → 写入 `resources.fileUrl`
   - 4 位提取码 → 写入 `resources.panCode`
   - 在 SQLite 里 INSERT/REPLACE 一条 `resources` 记录
3. 重复上传(同 title 已存在)会自动跳过(`--reuse-if-exists`)

## 4. 验证

```bash
python manage.py verify --all
```

会 HEAD 每个分享链接 + 在百度网盘 ls 期望路径,确认 DB 与实际文件一致。

## 5. 注意事项

| 事项 | 说明 |
|---|---|
| **bypy token** | 缓存 `~/.bypy/bypy.json`,换电脑或重装系统要重新 OAuth |
| **百度网盘限速** | 普通账号上传稳定 ~2 MB/s,9.5 GB 大概要 1.5 小时;SVIP 可到 10 MB/s |
| **目录命名** | 严格按 `lib/path.py` 推导,不要手改路径 |
| **断点续传** | bypy 自身支持,中途中断重跑会跳过已上传文件 |
| **DB 一致性** | 必须经 `manage.py` 走,不要绕过 CLI 直接调 bypy |
| **资源重复** | 同 title 已存在 → 跳过上传,只更新 DB(由 manage.py 实现) |

## 6. 失败排查

```bash
# 看 bypy token 是否过期
python -c "import bypy; b = bypy.ByPy(); b.info()"

# 看 DB 状态
sqlite3 ../../api/data/database.sqlite "SELECT id, title, category, panCode FROM resources ORDER BY id DESC LIMIT 10"

# 看百度网盘目录
python -c "import bypy; b = bypy.ByPy(); b.listdir('/CGResourcesHub/Blender')"
```