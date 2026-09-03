#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
batch_upload_blend_assets.py
=============================
扫描本地 data/blend_assets/<id>/ 下的 Blender 资源,批量调用 manage.py upload 上传到百度网盘。

每个资源目录约定:
    data/blend_assets/<id>/
        manifest.json         ← 资源元数据(title/description/element/technique...)
        source.blend          ← 源文件(manage.py 默认会打包目录里的所有内容)
        fixed.blend           ← 处理后的版本
        thumbnail.png         ← 缩略图
        textures/             ← 贴图
        *_full.zip            ← 已有打包(优先用这个)

manifest.json 期望字段(可缺失,会用目录名兜底):
{
  "title": "Red Autumn Forest",
  "software": "Blender",
  "description": "...",
  "element": ["foliage", "rocks"],
  "technique": ["procedural", "shader"]
}

用法:
    python batch_upload_blend_assets.py              # 扫描全部
    python batch_upload_blend_assets.py --id 14      # 只跑 id=14
    python batch_upload_blend_assets.py --dry-run    # 模拟,不真传
    python batch_upload_blend_assets.py --limit 3    # 只跑前 3 个(测试)

注意:必须先在 manage.py 里初始化百度网盘授权:
    python manage.py  # 内部调用 bypy info 需要 token
    # 第一次运行 manage.py 任一命令会引导 OAuth 登录
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BLEND_ASSETS_DIR = REPO_ROOT / "data" / "blend_assets"
MANAGE_PY = Path(__file__).resolve().parent / "manage.py"


def load_manifest(asset_dir: Path) -> dict:
    """读 manifest.json,字段缺失时用目录名兜底。"""
    mf = asset_dir / "manifest.json"
    fallback = {"title": asset_dir.name, "software": "Blender"}
    if not mf.is_file():
        return fallback
    try:
        data = json.loads(mf.read_text(encoding="utf-8"))
        for k, v in fallback.items():
            data.setdefault(k, v)
        return data
    except Exception as e:
        print(f"  ⚠ manifest.json 解析失败({e}),用目录名兜底", file=sys.stderr)
        return fallback


def find_upload_file(asset_dir: Path) -> Path | None:
    """优先用 *_full.zip;否则用 source.blend 或 fixed.blend。"""
    zips = sorted(asset_dir.glob("*_full.zip"))
    if zips:
        return zips[0]
    for name in ("source.blend", "fixed.blend"):
        p = asset_dir / name
        if p.is_file():
            return p
    return None


def upload_one(asset_id: str, dry_run: bool = False) -> tuple[bool, str]:
    """上传单个资源,返回 (success, message)。"""
    asset_dir = BLEND_ASSETS_DIR / asset_id
    if not asset_dir.is_dir():
        return False, f"目录不存在: {asset_dir}"

    upload_file = find_upload_file(asset_dir)
    if upload_file is None:
        return False, "找不到可上传的文件(*_full.zip / source.blend / fixed.blend)"

    meta = load_manifest(asset_dir)
    title = meta.get("title", asset_id)
    software = meta.get("software", "Blender")
    description = meta.get("description", "")
    elements = meta.get("element", [])
    techniques = meta.get("technique", [])

    cmd = [
        sys.executable, str(MANAGE_PY), "upload",
        str(upload_file),
        "--software", software,
        "--title", title,
    ]
    if description:
        cmd += ["--description", description]
    if elements:
        cmd += ["--element", *elements]
    if techniques:
        cmd += ["--technique", *techniques]

    if dry_run:
        cmd.append("--dry-run")

    print(f"\n[{asset_id}] {upload_file.name}  →  {software} / {title}")
    print(f"  CMD: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return False, "上传超时(>10min)"
    except Exception as e:
        return False, f"调用失败: {e}"

    ok = result.returncode == 0
    output = (result.stdout + result.stderr).strip()
    return ok, output[-500:] if len(output) > 500 else output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--id", help="只处理指定 asset id")
    parser.add_argument("--limit", type=int, default=0, help="最多处理几个(0=全部)")
    parser.add_argument("--dry-run", action="store_true", help="不真传,只看命令")
    args = parser.parse_args()

    if not BLEND_ASSETS_DIR.is_dir():
        print(f"❌ 找不到 {BLEND_ASSETS_DIR}", file=sys.stderr)
        sys.exit(1)

    if args.id:
        ids = [args.id]
    else:
        ids = sorted([d.name for d in BLEND_ASSETS_DIR.iterdir() if d.is_dir()], key=lambda x: int(x) if x.isdigit() else 999999)

    if args.limit > 0:
        ids = ids[:args.limit]

    print(f"📦 准备上传 {len(ids)} 个资源 {'(DRY-RUN)' if args.dry_run else ''}")

    success, failed = 0, 0
    for asset_id in ids:
        ok, msg = upload_one(asset_id, dry_run=args.dry_run)
        if ok:
            success += 1
            print(f"  ✓ [{asset_id}] 成功")
        else:
            failed += 1
            print(f"  ✗ [{asset_id}] 失败: {msg}")

    print(f"\n汇总: 成功 {success} / 失败 {failed} / 总计 {len(ids)}")
    sys.exit(0 if failed == 0 else 2)


if __name__ == "__main__":
    main()