"""
bdpan CLI wrapper.  Provides typed Python functions that internally
shell out to the `bdpan` binary, parse its output, and raise clear
exceptions on failure.

Why wrap the CLI instead of using the HTTP API directly:
  * bdpan handles OAuth token refresh, rapid upload (md5 short-circuit),
    and resume — re-implementing that is a lot of work and we'd just
    drift from baidu's API.
  * The CLI is the only supported interface for the `/apps/bdpan/`
    namespace (the "app data" sandbox that the open platform gives us).

Subprocess gotchas addressed:
  * bdpan.exe is the Windows binary; we call it directly (no Git Bash
    needed), so MSYS_NO_PATHCONV is irrelevant here.
  * Some commands (mkdir/mv/rm/ls) print to stderr in colour; we
    capture both streams and check return code.
  * `share` returns `<url>` on stdout; we parse it.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Final

# Allow override via env var (e.g. for a different machine).
BDPAN_BIN: Final[str] = os.environ.get(
    "BDPAN_BIN",
    r"C:\Users\yao_p\.local\bin\bdpan.exe",
)


def bdpan_available() -> bool:
    return Path(BDPAN_BIN).is_file() or shutil.which(BDPAN_BIN) is not None


# --- low-level runner --------------------------------------------------

class BdpanError(RuntimeError):
    """Raised when bdpan exits non-zero or output is unparseable."""


def _run(args: list[str], *, timeout: int = 600) -> str:
    """Run bdpan with the given args, return stdout (utf-8).  Raise on error."""
    if not bdpan_available():
        raise BdpanError(
            f"bdpan binary not found at {BDPAN_BIN}. "
            f"Run `bash $HOME/.minimax/agents/mavis/skills/baidu-drive/scripts/install.sh`."
        )
    cmd = [BDPAN_BIN] + list(args)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError as exc:
        raise BdpanError(f"bdpan binary missing: {BDPAN_BIN}") from exc
    except subprocess.TimeoutExpired as exc:
        raise BdpanError(f"bdpan timeout after {timeout}s: {args}") from exc

    if proc.returncode != 0:
        err = (proc.stderr or "").strip() or (proc.stdout or "").strip()
        raise BdpanError(f"bdpan {args[0]!r} failed (rc={proc.returncode}): {err}")
    return proc.stdout


# --- typed wrappers ---------------------------------------------------

def ensure_folder(remote_path: str) -> bool:
    """mkdir -p the chain of folders in `remote_path`.

    Returns True if the folder already existed, False if newly created.
    Tolerates "already exists" errors (treats them as already-present).
    """
    # Walk up, mkdir each segment
    parts = [p for p in remote_path.split("/") if p]
    cur = ""
    existed = True
    for i, part in enumerate(parts):
        cur += "/" + part
        # Skip the root path "/" (first iteration makes cur = "/apps")
        if i == 0 and cur == "/apps":
            continue
        try:
            _run(["mkdir", cur])
            existed = False
        except BdpanError as e:
            # bdpan prints "ERR xxx" or "已存在" — we treat existence as success
            if "已存在" in str(e) or "already exists" in str(e).lower():
                continue
            raise
    return existed


def upload(local_path: str, remote_path: str) -> None:
    """Upload a local file to baidu pan.

    Uses bdpan's rapid upload (md5 short-circuit) by default — the
    binary already has rapidupload=True set.
    """
    local_abs = str(Path(local_path).resolve())
    if not Path(local_abs).is_file():
        raise FileNotFoundError(f"local file not found: {local_abs}")
    _run(["upload", local_abs, remote_path])


def download(remote_path: str, local_path: str) -> None:
    Path(local_path).parent.mkdir(parents=True, exist_ok=True)
    _run(["download", remote_path, str(local_path)])


def ls(remote_path: str) -> list[dict[str, str]]:
    """List a baidu-pan directory.  Returns rows with keys: type, size, mtime, name."""
    out = _run(["ls", remote_path])
    rows: list[dict[str, str]] = []
    for raw in out.splitlines():
        line = raw.strip()
        if not line or set(line) <= {"─", "-", " "}:
            continue
        # Format: " 类型      大小       修改时间                 文件名"
        parts = re.split(r"\s{2,}", line)
        if len(parts) < 4 or parts[0] in ("类型", "类型", "type"):
            continue
        # Skip the "共 N 项" footer
        if parts[0].startswith("共") or parts[0].startswith("Total"):
            continue
        rows.append({
            "type": parts[0],
            "size": parts[1],
            "mtime": parts[2],
            "name": " ".join(parts[3:]).strip(),
        })
    return rows


def mv(src: str, dst: str) -> None:
    """Move (or rename) a remote file/dir.  `dst` is the destination path
    (NOT a folder + filename — bdpan mv takes full dest path)."""
    _run(["mv", src, dst])


def rm(remote_path: str) -> None:
    _run(["rm", remote_path])


def share(remote_path: str, *, period_days: int = 0) -> tuple[str, str]:
    """Create a baidu-pan share link.  period_days=0 -> permanent (default:
    resource-hub links must never silently expire).

    Returns (url, extraction_code).  The URL has `?pwd=CODE` stripped
    so it can be stored cleanly in the DB; the code is returned
    separately.
    """
    out = _run(["share", "--period", str(period_days), remote_path])
    url = _extract_first_url(out)
    if not url:
        raise BdpanError(f"could not parse share URL from bdpan output:\n{out}")
    code = _extract_pwd_from_url(url)
    clean_url = url.split("?", 1)[0]
    return clean_url, (code or "")


def quota() -> tuple[int, int]:
    """Return (used_bytes, total_bytes)."""
    out = _run(["quota", "--json"])
    import json
    data = json.loads(out)
    return int(data.get("used", 0)), int(data.get("total", 0))


# --- output parsing helpers ------------------------------------------

_URL_RE = re.compile(r"https?://[^\s\"']+")
_PWD_RE = re.compile(r"[?&]pwd=([A-Za-z0-9]+)")


def _extract_first_url(text: str) -> str | None:
    m = _URL_RE.search(text)
    return m.group(0) if m else None


def _extract_pwd_from_url(url: str) -> str | None:
    m = _PWD_RE.search(url)
    return m.group(1) if m else None
