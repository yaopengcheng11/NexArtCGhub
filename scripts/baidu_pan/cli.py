"""
baidu_pan CLI — a thin, friendly wrapper over the `bypy` library.

All commands print results through `rich` for readable output.
Run `python cli.py --help` to see the full command list, or
`python cli.py <command> --help` for a specific command.

Quick start:

    # 1. (one-time) Walk the OAuth flow — opens a browser URL, paste back the code
    python cli.py init

    # 2. Check who you're logged in as + storage quota
    python cli.py whoami
    python cli.py quota

    # 3. Look at the folder you just created
    python cli.py ls /CGResourcesHub
    python cli.py tree /CGResourcesHub --depth 2

    # 4. Push a local file or folder
    python cli.py upload ./my-asset.zip /CGResourcesHub/my-asset.zip

    # 5. Mirror a local directory to /CGResourcesHub (and back)
    python cli.py sync up
    python cli.py sync down
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml
from rich.console import Console
from rich.table import Table

# bypy is the official Python binding for Baidu Personal Cloud Storage.
# It handles the OAuth dance internally, stores the refresh token locally,
# and exposes a tiny API for upload / download / list / share.
import bypy

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "config.yaml"
CONFIG_EXAMPLE = SCRIPT_DIR / "config.example.yaml"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

console = Console()
err = Console(stderr=True, style="red")
warn = Console(stderr=True, style="yellow")

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------


def load_config() -> dict[str, Any]:
    """Load config.yaml, falling back to config.example.yaml if missing."""
    path = CONFIG_PATH if CONFIG_PATH.exists() else CONFIG_EXAMPLE
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


# ---------------------------------------------------------------------------
# Bypy client
# ---------------------------------------------------------------------------


def get_client() -> bypy.Bypy:
    """Return a configured bypy client.

    bypy reads its token from `~/.bypy/bypy.json` after the first
    `init` run, so subsequent calls just work.
    """
    cfg = load_config()
    concurrency = int(cfg.get("concurrency", 3))
    return bypy.Bypy(rapidupload=True)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_init(_args: argparse.Namespace) -> int:
    """Walk the OAuth flow and persist tokens locally."""
    console.print("[bold]百度网盘 Open API — 首次授权[/bold]")
    console.print(
        "即将打开一个授权 URL, 用绑定了 [cyan]CGResourcesHub[/cyan] 的百度账号登录,\n"
        "同意授权后, 浏览器会跳转到一个 [green]localhost:8989/?code=...[/green] 的页面,\n"
        "把那个 [bold]code[/bold] 参数(整段)复制回来粘贴到下面。"
    )
    # bypy's `Bypy().auth()` walks the flow. The user pastes the redirect URL
    # or just the `code` value.
    try:
        bp = bypy.Bypy(rapidupload=True)
    except Exception as exc:  # noqa: BLE001
        err.print(f"bypy 初始化失败: {exc}")
        return 1
    # bypy's own auth — it prints a URL, then asks for the code via stdin.
    # We let its built-in flow run.
    rc = os.system("bypy info")
    if rc != 0:
        err.print("授权未完成, 请再试一次: `python cli.py init`")
        return rc
    console.print("[green]授权成功, token 已缓存到 ~/.bypy/[/green]")
    return 0


def cmd_whoami(_args: argparse.Namespace) -> int:
    bp = get_client()
    try:
        info = bp.quota()  # quota() returns (used, total) in bytes
    except Exception as exc:  # noqa: BLE001
        err.print(f"未授权或 token 过期, 请先跑 `init`: {exc}")
        return 1
    used, total = info
    console.print(
        f"[bold]登录态有效[/bold]  配额: [cyan]{used / 2**30:.2f} GiB[/cyan] / "
        f"[cyan]{total / 2**30:.2f} GiB[/cyan]"
    )
    return 0


def cmd_quota(_args: argparse.Namespace) -> int:
    bp = get_client()
    try:
        used, total = bp.quota()
    except Exception as exc:  # noqa: BLE001
        err.print(f"未授权或 token 过期: {exc}")
        return 1
    pct = (used / total) * 100 if total else 0
    bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
    console.print(f"[bold]百度网盘配额[/bold]")
    console.print(f"  [cyan]{used / 2**30:8.2f} GiB[/cyan] / {total / 2**30:8.2f} GiB  [{pct:5.1f}%]")
    console.print(f"  [green]{bar}[/green]")
    return 0


def _format_size(n: int | float) -> str:
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if n < 1024:
            return f"{n:6.1f} {unit}"
        n /= 1024
    return f"{n:6.1f} PiB"


def cmd_ls(args: argparse.Namespace) -> int:
    bp = get_client()
    remote = args.path or "/"
    try:
        entries = bp.list(remote)
    except Exception as exc:  # noqa: BLE001
        err.print(f"list {remote} 失败: {exc}")
        return 1
    table = Table(title=f"📁 {remote}", show_lines=False)
    table.add_column("name", style="cyan")
    table.add_column("size", justify="right", style="magenta")
    table.add_column("mtime", style="green")
    if not entries:
        console.print(f"[dim]空目录: {remote}[/dim]")
        return 0
    for entry in entries:
        size = entry.get("size", 0)
        mtime = entry.get("md5", "") or entry.get("server_mtime", "")
        table.add_row(
            entry.get("path", "?"),
            _format_size(int(size)) if size else "[dim]—[/dim]",
            str(mtime),
        )
    console.print(table)
    return 0


def cmd_mkdir(args: argparse.Namespace) -> int:
    bp = get_client()
    try:
        bp.mkdir(args.path)
    except Exception as exc:  # noqa: BLE001
        err.print(f"mkdir {args.path} 失败: {exc}")
        return 1
    console.print(f"[green]已创建: {args.path}[/green]")
    return 0


def cmd_upload(args: argparse.Namespace) -> int:
    bp = get_client()
    local, remote = args.local, args.remote
    if not Path(local).exists():
        err.print(f"本地路径不存在: {local}")
        return 1
    console.print(f"[bold]上传[/bold]  {local}  →  {remote}")
    try:
        ok = bp.upload(local, remote)
    except Exception as exc:  # noqa: BLE001
        err.print(f"上传失败: {exc}")
        return 1
    if not ok:
        err.print("上传失败, bypy 返回 False")
        return 1
    console.print(f"[green]完成: {remote}[/green]")
    return 0


def cmd_download(args: argparse.Namespace) -> int:
    bp = get_client()
    remote, local = args.remote, args.local
    Path(local).parent.mkdir(parents=True, exist_ok=True)
    console.print(f"[bold]下载[/bold]  {remote}  →  {local}")
    try:
        ok = bp.download(remote, local)
    except Exception as exc:  # noqa: BLE001
        err.print(f"下载失败: {exc}")
        return 1
    if not ok:
        err.print("下载失败, bypy 返回 False")
        return 1
    console.print(f"[green]完成: {local}[/green]")
    return 0


def cmd_sync(args: argparse.Namespace) -> int:
    cfg = load_config()
    remote_root = cfg.get("remote_root", "/CGResourcesHub")
    local_root = cfg.get("local_root", "./data/cg_resources_pan")
    if not local_root:
        err.print("config.yaml 里没有 local_root")
        return 1
    bp = get_client()
    if args.direction == "up":
        console.print(f"[bold]sync up[/bold]  {local_root}  →  {remote_root}")
        try:
            bp.syncup(local_root, remote_root)
        except Exception as exc:  # noqa: BLE001
            err.print(f"syncup 失败: {exc}")
            return 1
        console.print("[green]sync up 完成[/green]")
    else:
        console.print(f"[bold]sync down[/bold]  {remote_root}  →  {local_root}")
        Path(local_root).mkdir(parents=True, exist_ok=True)
        try:
            bp.syncdown(remote_root, local_root)
        except Exception as exc:  # noqa: BLE001
            err.print(f"syncdown 失败: {exc}")
            return 1
        console.print("[green]sync down 完成[/green]")
    return 0


def cmd_share(args: argparse.Namespace) -> int:
    """Share a remote path and print the share link."""
    bp = get_client()
    try:
        # bypy's share method on a single file/folder, returns info dict
        result = bp.share(args.path)
    except Exception as exc:  # noqa: BLE001
        err.print(f"分享失败: {exc}")
        return 1
    console.print_json(data=result if isinstance(result, dict) else {"raw": str(result)})
    return 0


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="baidu_pan",
        description="百度网盘 Open API CLI (基于 bypy)",
    )
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="首次授权 (OAuth)")  # cmd_init
    sub.add_parser("whoami", help="检查登录态")  # cmd_whoami
    sub.add_parser("quota", help="显示存储配额")  # cmd_quota

    ls = sub.add_parser("ls", help="列出远程目录")
    ls.add_argument("path", nargs="?", default="/", help="远程路径, 默认 /")
    ls.set_defaults(func=cmd_ls)

    mkdir = sub.add_parser("mkdir", help="创建远程目录")
    mkdir.add_argument("path", help="远程路径, 例如 /CGResourcesHub/sub")
    mkdir.set_defaults(func=cmd_mkdir)

    up = sub.add_parser("upload", help="上传本地文件/目录到网盘")
    up.add_argument("local", help="本地路径")
    up.add_argument("remote", help="远程目标路径, 例如 /CGResourcesHub/file.zip")
    up.set_defaults(func=cmd_upload)

    down = sub.add_parser("download", help="下载网盘文件到本地")
    down.add_argument("remote", help="远程路径")
    down.add_argument("local", help="本地目标路径")
    down.set_defaults(func=cmd_download)

    sync = sub.add_parser("sync", help="同步本地目录 ↔ 远程")
    sync.add_argument("direction", choices=["up", "down"], help="up=推, down=拉")
    sync.set_defaults(func=cmd_sync)

    share = sub.add_parser("share", help="分享远程文件/目录, 打印 share link")
    share.add_argument("path", help="远程路径")
    share.set_defaults(func=cmd_share)

    return p


COMMANDS = {
    "init": cmd_init,
    "whoami": cmd_whoami,
    "quota": cmd_quota,
    "ls": cmd_ls,
    "mkdir": cmd_mkdir,
    "upload": cmd_upload,
    "download": cmd_download,
    "sync": cmd_sync,
    "share": cmd_share,
}


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = COMMANDS.get(args.command)
    if handler is None:
        parser.error(f"未知命令: {args.command}")
    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
