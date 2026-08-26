"""Batch-upload the D:/Blender_Cover splash-screen collection into CGResourceHub.

For each ``Blender <ver>[_<Title>]`` folder under the source dir:

* exactly one official demo ``*.zip``  -> uploaded as-is
* a raw ``*.blend``                    -> repacked (ZIP_STORED) together with any
  sibling asset files (``textures/`` etc.) into ``cache/covers/<Slug>_full.zip``
  so the baidu-side naming convention (<Title>_full.zip) stays truthful.
* junk excluded everywhere: ``*.blend1`` backups, WeChat screenshots,
  Thumbs.db / desktop.ini.

Every item goes through ``manage.cmd_upload`` (share + DB insert + duplicate
guard) with ``--period 0`` (permanent share). Afterwards the render engine is
read offline from the source .blend via ``lib.blend_reader`` (no Blender
needed) and written into tagGroups together with the folder-derived Blender
version.

Already-covered items are skipped: DB row exists -> skip; Red Autumn Forest
lives in the hub as id=17 already.

Usage:
    python upload_covers.py                 # full run
    python upload_covers.py --dry-run       # plan only, no baidu calls
    python upload_covers.py --only Charge   # retry one item by title substring
"""
from __future__ import annotations

import argparse
import re
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import manage                      # noqa: E402  (reuses cmd_upload)
from lib import db as dbmod        # noqa: E402
from lib import path as pathmod    # noqa: E402

SOURCE_DIR = Path(r"D:\Blender_Cover")
CACHE_DIR = HERE.parent.parent / "cache" / "covers"
SOFTWARE = "Blender"

FOLDER_RE = re.compile(r"^Blender (?P<ver>\d+\.\d+)(?:_(?P<title>.+))?$")

# Folder versions handled specially.
SKIP_VERSIONS = {"2.91"}          # Red Autumn Forest — already hub id=17
TITLE_OVERRIDES = {
    "3.2": "Ship Wakes",          # unnamed folder; textures/ship-wakes*.jpg
    "2.83": "PartyTug 6AM",       # folder says "PartyTug 6_00AM"
}

JUNK_RE = re.compile(
    r"^(.*\.blend1|微信截图.*|Thumbs\.db|desktop\.ini|\.DS_Store)$", re.IGNORECASE
)


def scan_items() -> list[dict]:
    """Map every source folder to an upload plan dict."""
    if not SOURCE_DIR.is_dir():
        raise SystemExit(f"source dir not found: {SOURCE_DIR}")
    items: list[dict] = []
    for folder in sorted(SOURCE_DIR.iterdir()):
        if not folder.is_dir():
            continue
        m = FOLDER_RE.match(folder.name)
        if not m:
            print(f"SKIP (unrecognized folder name): {folder.name}")
            continue
        ver = m.group("ver")
        title = TITLE_OVERRIDES.get(ver) or m.group("title")
        if not title:
            print(f"SKIP (no title and no override): {folder.name}")
            continue
        if ver in SKIP_VERSIONS:
            print(f"SKIP (already covered by existing resource): {folder.name}")
            continue

        files = [p for p in folder.rglob("*") if p.is_file() and not JUNK_RE.match(p.name)]
        zips = [p for p in files if p.suffix.lower() == ".zip"]
        blends = [p for p in files if p.suffix.lower() == ".blend"]

        if len(zips) == 1 and not blends:
            items.append(dict(version=ver, title=title, folder=folder,
                              mode="as-is", main=zips[0], assets=[]))
        elif len(blends) == 1:
            others = [p for p in files if p != blends[0] and p not in zips]
            items.append(dict(version=ver, title=title, folder=folder,
                              mode="repack", main=blends[0], assets=others))
        else:
            print(f"SKIP (ambiguous content: {len(zips)} zip / {len(blends)} blend): "
                  f"{folder.name}")
    return items


def build_repack_zip(item: dict) -> Path:
    """Pack main .blend + sibling assets into cache/covers/<Slug>_full.zip.

    For ``as-is`` items the local source is already a .zip, so we just
    mirror it into the cache. Having a stable cache path matters because
    `manage.py thumbnail` looks for cache/covers/<Slug>_full.zip first
    when the resource has no fixed.blend locally.
    """
    slug = pathmod.slugify_title(item["title"])
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"{slug}_full.zip"
    if out.exists() and out.stat().st_size > 0:
        return out  # reuse from a previous run
    if item["mode"] == "as-is":
        import shutil
        shutil.copyfile(item["main"], out)
    else:
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
            zf.write(item["main"], arcname=item["main"].name)
            for asset in item["assets"]:
                zf.write(asset, arcname=asset.relative_to(item["folder"]).as_posix())
    return out


def read_engine_from_zip(zip_path: Path, tmpdir: Path) -> str | None:
    """Extract the largest .blend member to tmpdir and read its engine."""
    from lib.blend_reader import read_engine_canonical
    with zipfile.ZipFile(zip_path) as zf:
        members = [i for i in zf.infolist()
                   if i.filename.lower().endswith(".blend") and not i.filename.endswith(".blend1")]
        if not members:
            return None
        biggest = max(members, key=lambda i: i.file_size)
        target = tmpdir / Path(biggest.filename).name
        with zf.open(biggest) as src, open(target, "wb") as dst:
            while chunk := src.read(1 << 20):
                dst.write(chunk)
    try:
        return read_engine_canonical(target)
    finally:
        target.unlink(missing_ok=True)


def backfill_spec(resource_id: int, *, engine: str | None, version: str) -> None:
    """Write renderEngine + blenderVersion into tagGroups (same pattern as
    manage.py cmd_set_renderer)."""
    import json
    import sqlite3
    con = sqlite3.connect(str(dbmod.DB_PATH))
    tg = json.loads(con.execute(
        "SELECT tagGroups FROM resources WHERE id = ?", (resource_id,)
    ).fetchone()[0])
    if engine:
        tg["renderEngine"] = engine
    if version:
        tg["blenderVersion"] = version
    con.execute(
        "UPDATE resources SET tagGroups = ?, updatedAt = datetime('now') WHERE id = ?",
        (json.dumps(tg, ensure_ascii=False), resource_id),
    )
    con.commit()
    con.close()


def process(item: dict, dry_run: bool) -> bool:
    title = item["title"]
    remote = pathmod.baidu_path(SOFTWARE, title)

    existing = dbmod.find_by_title_software(title, SOFTWARE)
    if existing:
        print(f"-- SKIP {title!r}: DB id={existing['id']} already exists")
        return True

    if not dry_run:
        # Clean any orphaned baidu file from a previously crashed run so the
        # re-upload cannot create conflict copies. Best-effort only.
        # NOTE: force=True is REQUIRED — plain `bdpan rm` asks for
        # interactive confirmation and would hang this script forever.
        try:
            manage.baidumod.rm(remote, force=True)
            print(f"   removed leftover remote file {remote}")
        except Exception:
            pass

    local = item["main"] if item["mode"] == "as-is" else build_repack_zip(item)
    ns = argparse.Namespace(
        local=str(local), software=SOFTWARE, title=title,
        description=f"Official Blender {item['version']} splash screen - {title}.",
        category=None, element=[], technique=[], period=0, dry_run=dry_run,
    )
    rc = manage.cmd_upload(ns)
    if rc != 0:
        print(f"!! upload failed for {title!r} (rc={rc})")
        return False

    if dry_run:
        return True

    row = dbmod.find_by_title_software(title, SOFTWARE)
    rid = int(row["id"]) if row else None
    if rid is None:
        print(f"?? no DB row found after upload for {title!r}")
        return False

    # Offline spec backfill: engine straight from the .blend data, version
    # from the folder name (authoritative provenance).
    engine: str | None = None
    with tempfile.TemporaryDirectory(prefix="covers_engine_") as td:
        try:
            if item["mode"] == "repack":
                from lib.blend_reader import read_engine_canonical
                engine = read_engine_canonical(item["main"])
            else:
                engine = read_engine_from_zip(Path(local), Path(td))
        except Exception as e:  # never fail the batch over metadata
            print(f"   WARN engine read failed: {e}")
    backfill_spec(rid, engine=engine, version=item["version"])
    print(f"   id={rid}  engine={engine or '?'}  blender={item['version']}")
    return True


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="substring match on title, for single retries")
    args = ap.parse_args(argv)

    items = scan_items()
    if args.only:
        items = [i for i in items if args.only.lower() in i["title"].lower()]
        if not items:
            print(f"no item matches --only {args.only!r}")
            return 1

    print(f"\n=== {len(items)} item(s) planned ===")
    for it in items:
        size_mb = sum(p.stat().st_size for p in [it["main"], *it["assets"]]) / 1e6
        print(f"  {it['version']:>4}  {it['title']:<24} {it['mode']:<6} "
              f"{size_mb:8.1f} MB  {it['main'].name}")
    print()

    ok, failed = 0, []
    for it in items:
        print(f"\n=== [{it['title']}] ===")
        try:
            if process(it, args.dry_run):
                ok += 1
            else:
                failed.append(it["title"])
        except Exception as e:
            print(f"!! EXCEPTION for {it['title']}: {e}")
            failed.append(it["title"])

    print(f"\n=== done: {ok} ok, {len(failed)} failed ===")
    for t in failed:
        print(f"  FAILED: {t}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
