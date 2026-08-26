"""One-time: cache the as-is cover zips so manage.py thumbnail can find them.

upload_covers.py now caches as-is zips in cache/covers/<slug>_full.zip,
but the previous 8 as-is resources were processed before that fix, so
they're only on baidu.  Re-derive the source path on D:/Blender_Cover
by matching title in folder names and copy the original zip into the
cache.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from lib import db as dbmod  # noqa: E402
from lib import path as pathmod  # noqa: E402

CACHE_DIR = HERE / "cache" / "covers"
SRC_DIR = Path(r"D:\Blender_Cover")


def main() -> int:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    built = 0
    skipped = 0
    misses = []
    for r in dbmod.list_all():
        if (r.get("category") or "").lower() != "blender":
            continue
        title = r["title"]
        slug = pathmod.slugify_title(title)
        cache_zip = CACHE_DIR / f"{slug}_full.zip"
        if cache_zip.is_file() and cache_zip.stat().st_size > 0:
            skipped += 1
            continue
        norm = title.replace(" ", "").lower()
        for folder in SRC_DIR.iterdir():
            if not folder.is_dir() or norm not in folder.name.replace(" ", "").lower():
                continue
            zips = [p for p in folder.rglob("*.zip") if p.is_file()]
            if not zips:
                continue
            src = zips[0]
            shutil.copyfile(src, cache_zip)
            print(f"  cached id={r['id']:>3}  {title:<24}  <-  {src.name}  "
                  f"({cache_zip.stat().st_size//1024//1024} MB)")
            built += 1
            break
        else:
            misses.append((r["id"], title))
    print(f"\nbuilt={built}  skipped={skipped}  misses={len(misses)}")
    for rid, t in misses:
        print(f"  MISS id={rid}  {t}")
    return 0 if not misses else 1


if __name__ == "__main__":
    raise SystemExit(main())
