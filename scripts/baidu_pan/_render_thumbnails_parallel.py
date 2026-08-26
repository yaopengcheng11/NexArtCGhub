"""Render thumbnails in parallel with N workers.

The thumbnail work is single-process (Blender is mostly single-threaded
for its render path, and the system already has 24 resources).  What
saves time is overlapping Blender's startup + .blend load (15-30s per
file) with the next resource's preparation.  Two workers is the sweet
spot: more adds contention and OOM risk for the 1.5 GB Charge file.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from lib import db as dbmod  # noqa: E402

SCRIPT = HERE / "manage.py"
PY = HERE / ".venv" / "Scripts" / "python.exe"


def pick_targets() -> list[tuple[int, str]]:
    """Every Blender resource that still lacks a usable thumbnail.

    Includes both the formal blend-asset pipeline (tagGroups.schema ==
    blend-asset-v1) and bare Blender uploads from the bulk cover import
    (which set only blenderVersion / renderEngine). The thumbnail script
    doesn't need the manifest, only a source .blend.
    """
    out: list[tuple[int, str]] = []
    for r in dbmod.list_all():
        cat = (r.get("category") or "").lower()
        if cat not in ("blender",):
            continue
        asset_dir = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(r["id"])
        thumb = asset_dir / "thumbnail.png"
        if thumb.is_file() and thumb.stat().st_size > 4096:
            continue
        out.append((int(r["id"]), r["title"]))
    out.sort()
    return out


def chunks(items: list[tuple[int, str]], n: int) -> list[list[tuple[int, str]]]:
    return [items[i::n] for i in range(n)]


def run(worker_id: int, items: list[tuple[int, str]], log_path: Path) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fail = 0
    with log_path.open("a", encoding="utf-8") as log:
        for rid, title in items:
            t0 = time.time()
            proc = subprocess.run(
                [str(PY), str(SCRIPT), "thumbnail", str(rid), "--size", "2048", "--force"],
                capture_output=True, text=True, timeout=900,
            )
            dt = time.time() - t0
            asset_dir = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(rid)
            png = asset_dir / "thumbnail.png"
            ok = png.is_file() and png.stat().st_size > 1024
            line = (f"[w{worker_id}] id={rid:>3}  {title[:24]:<25}  "
                    f"rc={proc.returncode}  png={png.stat().st_size//1024 if ok else 0} KB  "
                    f"{dt:5.1f}s")
            print(line)
            log.write(line + "\n")
            log.flush()
            if not ok:
                fail += 1
                # Surface the relevant tail of the script's stderr for diagnosis
                tail = (proc.stderr or "")[-400:]
                log.write(f"     stderr: {tail!r}\n")
                log.flush()
    return fail


def main(argv: Iterable[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args(argv)

    items = pick_targets()
    if not items:
        print("nothing to render — every blend asset already has a thumbnail.")
        return 0
    print(f"{len(items)} resources, {args.workers} workers")
    parts = chunks(items, args.workers)
    log_dir = dbmod.PROJECT_ROOT / "cache" / "covers"
    log_dir.mkdir(parents=True, exist_ok=True)
    # Clear old logs
    for i in range(args.workers):
        p = log_dir / f"thumb_w{i}.log"
        if p.is_file():
            p.unlink()

    import concurrent.futures
    fails = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = [pool.submit(run, i, parts[i] if i < len(parts) else [],
                            log_dir / f"thumb_w{i}.log")
                for i in range(args.workers)]
        for f in concurrent.futures.as_completed(futs):
            fails += f.result()
    print(f"\n=== done. fails={fails} ===")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
