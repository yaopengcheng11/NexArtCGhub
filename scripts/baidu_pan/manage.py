"""
manage.py — programmatic resource management for the CGResourceHub
baidu-pan integration.  Wraps lib/{path,baidu,db} into a single CLI
that handles the full resource lifecycle:

    python manage.py upload  <local.zip> --software Blender --title "..."
    python manage.py delete  <resource_id>
    python manage.py rename  <resource_id> --new-title "..."
    python manage.py recategorize <resource_id> --new-software "..."
    python manage.py share-collection <resource_id> --collection "Terrains"
    python manage.py unshare-collection <resource_id> --collection "Terrains"
    python manage.py verify  [--all | <resource_id>]

Each command is a "do the right thing" wrapper that combines
filesystem ops, baidu-pan ops, and DB ops in the right order.

Idempotency
-----------
* `upload` with --reuse-if-exists shares the existing baidu-pan file
  and updates only the DB row (skips the upload + re-share).
* `delete` and `rename` are NOT idempotent — second invocation will
  fail with a clear error.
* `recategorize` is idempotent on the DB side but always re-shares
  the moved file (cheap).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Make `lib.*` importable when running from this directory.
HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from lib import path as pathmod   # noqa: E402
from lib import baidu as baidumod  # noqa: E402
from lib import db as dbmod       # noqa: E402


# --- helpers ----------------------------------------------------------

def _infer_software_from_resource(res: dict) -> str:
    """Pull the primary software out of a resource row.

    Priority: tagGroups.software[0] > category > "Other".
    """
    tg = res.get("tagGroups")
    if tg:
        try:
            obj = json.loads(tg) if isinstance(tg, str) else tg
            sw = (obj.get("software") or [])
            if sw:
                return sw[0]
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
    cat = (res.get("category") or "").strip()
    return cat or "Other"


def _derive_remote_path(res: dict) -> str:
    software = _infer_software_from_resource(res)
    return pathmod.baidu_path(software, res["title"])


def _confirm(prompt: str) -> bool:
    """Interactive y/N confirmation; default No."""
    while True:
        ans = input(f"{prompt} [y/N]: ").strip().lower()
        if ans in ("y", "yes"):
            return True
        if ans in ("n", "no", ""):
            return False
        print("  please answer y or n")


# --- commands ---------------------------------------------------------

def cmd_upload(args: argparse.Namespace) -> int:
    local = Path(args.local).resolve()
    if not local.is_file():
        print(f"ERROR: local file not found: {local}", file=sys.stderr)
        return 2

    software = args.software or "Other"
    title = args.title or local.stem  # default to filename without ext

    # 1. Compute the destination path
    remote = pathmod.baidu_path(software, title)
    folder = pathmod.baidu_folder(software)
    print(f"[1/5] path: {remote}")

    # 2. Duplicate check
    existing = dbmod.find_by_title_software(title, software)
    if existing:
        print(f"  WARNING: a resource with this title+software already exists in DB:")
        print(f"    id={existing['id']}  title={existing['title']!r}  fileUrl={existing.get('fileUrl')}")
        print(f"    baidu_path={_derive_remote_path(existing)}")
        print()
        print("  choose:")
        print("    [r]euse — skip upload, keep existing baidu file, just refresh DB")
        print("    [o]verwrite — delete existing baidu file, re-upload, re-share, UPDATE id")
        print("    [n]ew title — re-prompt for a different title")
        print("    [a]bort — cancel")
        ans = input("  > ").strip().lower()
        if ans == "a" or not ans:
            print("aborted.")
            return 1
        if ans == "r":
            file_url = existing["fileUrl"]
            pan_code = existing.get("panCode")
            print(f"  reusing existing share: {file_url}  code={pan_code}")
        elif ans == "o":
            dbmod.delete_resource(int(existing["id"]))
            try:
                baidumod.rm(_derive_remote_path(existing))
            except baidumod.BdpanError as e:
                print(f"  WARN: baidu rm failed (file may not exist on baidu): {e}")
            existing = None
        elif ans == "n":
            new_title = input("  new title: ").strip()
            return cmd_upload(argparse.Namespace(
                local=str(local),
                software=software,
                title=new_title,
                description=getattr(args, 'description', ''),
                category=getattr(args, 'category', None),
            ))
        else:
            print(f"  unknown choice {ans!r}; aborted")
            return 1

    # 3. Ensure folder exists
    print(f"[3/5] ensuring folder {folder}")
    if not args.dry_run:
        baidumod.ensure_folder(folder)

    # 4. Upload
    if existing and ans == "r":
        print(f"[4/5] SKIP upload (reuse mode)")
    else:
        print(f"[4/5] uploading {local.name} -> {remote}")
        if not args.dry_run:
            baidumod.upload(str(local), remote)

    # 5. Share + insert/update DB
    if existing and ans == "r":
        print(f"[5/5] DB already has id={existing['id']} — no change")
        return 0

    print(f"[5/5] creating share link")
    if args.dry_run:
        print(f"  [dry-run] would share {remote}")
        return 0

    file_url, pan_code = baidumod.share(remote, period_days=args.period)
    print(f"  url:  {file_url}")
    print(f"  code: {pan_code}")

    tag_groups = {"software": [software]}
    if args.element:
        tag_groups["element"] = args.element
    if args.technique:
        tag_groups["technique"] = args.technique

    # If the local input is a .blend, auto-run the parser to populate
    # the Spec section fields (blender version, frame range, FPS,
    # render engine). Same path as the web Admin /blend upload — the
    # manifest is treated as the source of truth.
    if local.suffix.lower() == ".blend":
        try:
            print("[auto-parse] running blend_asset_parser.py for spec fields…")
            tmp_manifest = local.parent / f".{local.stem}.manifest.json"
            raw_manifest = _run_blender_parser(local, tmp_manifest)
            tmp_manifest.unlink(missing_ok=True)
            scene = raw_manifest.get("scene", {}) or {}
            tag_groups["status"] = "ready"
            tag_groups["schema"] = "blend-asset-v1"
            tag_groups["blenderVersion"] = (raw_manifest.get("blend") or {}).get("blender_version")
            tag_groups["frameStart"] = scene.get("frame_start")
            tag_groups["frameEnd"] = scene.get("frame_end")
            tag_groups["fps"] = scene.get("fps")
            tag_groups["renderEngine"] = scene.get("render_engine")
            print(f"  blender: {tag_groups['blenderVersion']}  "
                  f"frames: {tag_groups['frameStart']}–{tag_groups['frameEnd']}  "
                  f"fps: {tag_groups['fps']}  engine: {tag_groups['renderEngine']}")
        except Exception as e:
            print(f"  [auto-parse] WARN: {e}  (continuing without spec fields)")

    new_id = dbmod.insert_resource(
        title=title,
        file_url=file_url,
        pan_code=pan_code or None,
        category=args.category or software,
        description=args.description or "",
        tags=json.dumps(tag_groups.get("element", []), ensure_ascii=False),
        tag_groups=tag_groups,
    )
    print(f"  inserted resource id={new_id}")
    print()
    print("done. verify with:")
    print(f"  python manage.py verify {new_id}")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    print(f"will delete:")
    print(f"  id={res['id']}  title={res['title']!r}  category={res['category']}")
    print(f"  fileUrl={res.get('fileUrl')}")
    print(f"  baidu_path={_derive_remote_path(res)}")
    if not args.yes and not _confirm("proceed?"):
        print("aborted.")
        return 1

    remote = _derive_remote_path(res)
    try:
        baidumod.rm(remote)
        print(f"  deleted baidu file: {remote}")
    except baidumod.BdpanError as e:
        print(f"  WARN: baidu rm failed: {e}")

    dbmod.delete_resource(args.resource_id)
    print(f"  deleted DB row id={args.resource_id}")
    return 0


def cmd_rename(args: argparse.Namespace) -> int:
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    old_title = res["title"]
    new_title = args.new_title.strip()
    if new_title == old_title:
        print(f"title unchanged: {old_title!r}")
        return 0

    software = _infer_software_from_resource(res)
    old_remote = _derive_remote_path(res)
    new_remote = pathmod.baidu_path(software, new_title)

    print(f"rename:")
    print(f"  id={res['id']}  {old_title!r}  ->  {new_title!r}")
    print(f"  baidu: {old_remote}  ->  {new_remote}")
    if not args.yes and not _confirm("proceed?"):
        print("aborted.")
        return 1

    # 1. Move baidu file
    try:
        baidumod.mv(old_remote, new_remote)
    except baidumod.BdpanError as e:
        print(f"ERROR: baidu mv failed: {e}", file=sys.stderr)
        return 2

    # 2. Re-share (old URL may or may not still work, be safe)
    file_url, pan_code = baidumod.share(new_remote, period_days=7)
    print(f"  new share url:  {file_url}")
    print(f"  new code:       {pan_code}")

    # 3. Update DB
    dbmod.update_title(res["id"], new_title)
    dbmod.update_file_url(res["id"], file_url=file_url, pan_code=pan_code or None)
    print(f"  updated DB id={res['id']}")
    return 0


def cmd_recategorize(args: argparse.Namespace) -> int:
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1

    old_software = _infer_software_from_resource(res)
    new_software = args.new_software.strip()
    if new_software.lower() == old_software.lower():
        print(f"category unchanged: {old_software!r}")
        return 0

    old_remote = _derive_remote_path(res)
    new_remote = pathmod.baidu_path(new_software, res["title"])

    print(f"recategorize:")
    print(f"  id={res['id']}  title={res['title']!r}")
    print(f"  software: {old_software!r}  ->  {new_software!r}")
    print(f"  baidu: {old_remote}  ->  {new_remote}")
    if not args.yes and not _confirm("proceed?"):
        print("aborted.")
        return 1

    # 1. Ensure target folder exists
    baidumod.ensure_folder(pathmod.baidu_folder(new_software))

    # 2. Move baidu file
    try:
        baidumod.mv(old_remote, new_remote)
    except baidumod.BdpanError as e:
        print(f"ERROR: baidu mv failed: {e}", file=sys.stderr)
        return 2

    # 3. Re-share
    file_url, pan_code = baidumod.share(new_remote, period_days=7)
    print(f"  new share url:  {file_url}")
    print(f"  new code:       {pan_code}")

    # 4. Update DB
    new_tag_groups = {"software": [new_software]}
    # Preserve any existing element/technique tags
    try:
        if res.get("tagGroups"):
            old_tg = json.loads(res["tagGroups"]) if isinstance(res["tagGroups"], str) else res["tagGroups"]
            for key in ("element", "technique"):
                if old_tg.get(key):
                    new_tag_groups[key] = old_tg[key]
    except (json.JSONDecodeError, TypeError, AttributeError):
        pass
    dbmod.update_category_and_tags(
        res["id"],
        category=new_software,
        tag_groups=new_tag_groups,
    )
    dbmod.update_file_url(res["id"], file_url=file_url, pan_code=pan_code or None)
    print(f"  updated DB id={res['id']}")
    return 0


def cmd_share_collection(args: argparse.Namespace) -> int:
    """Build (if needed) + upload + share a single collection's zip.

    Flow:
      1. Read resource from DB, determine software
      2. Look for cached per-collection zip at
         `<project>/data/blend_assets/<id>/cache/coll_<safeName>.zip`
         (built previously by the server's download endpoint).
      3. If not cached, run the Blender extractor to build it.
      4. Upload to `<resourceFolder>/coll_<slug>.zip` on baidu.
      5. Create share link.
      6. Save to `collectionShareLinks` (UPSERT).

    Note: the cache filename uses a different sanitization than the
    baidu filename (cache keeps underscores, baidu is PascalCase). We
    handle both forms when looking up the local zip.
    """
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    software = _infer_software_from_resource(res)
    coll = args.collection.strip()
    if not coll:
        print("ERROR: --collection is required", file=sys.stderr)
        return 1

    # baidu-side path (use posixpath so we don't get Windows backslashes
    # from pathlib on Windows — bdpan's /apps/... paths are POSIX-style)
    import posixpath
    remote_zip = pathmod.baidu_collection_path(software, res["title"], coll)
    remote_parent = posixpath.dirname(remote_zip)
    local_cache = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(args.resource_id) / "cache"

    # Look for the cached zip — try both naming conventions.
    def _safe(s: str) -> str:
        import re as _re
        return _re.sub(r"[^a-zA-Z0-9._-]", "_", s)
    cache_candidates = [
        local_cache / f"coll_{_safe(coll)}.zip",
        local_cache / f"coll_{pathmod.slugify_title(coll)}.zip",
    ]
    local_zip = next((p for p in cache_candidates if p.is_file()), None)

    if local_zip is None:
        # Try to build via the Blender extractor.
        print(f"[1/4] no cached zip; invoking Blender extractor...")
        blend_path = local_cache.parent / "fixed.blend"
        if not blend_path.is_file():
            print(f"ERROR: no fixed.blend at {blend_path}", file=sys.stderr)
            return 2
        extract_script = dbmod.PROJECT_ROOT / "api" / "tools" / "blend_asset_extractor.py"
        if not extract_script.is_file():
            print(f"ERROR: extractor not found at {extract_script}", file=sys.stderr)
            return 2
        # Find blender binary
        blender = shutil.which("blender")
        if not blender:
            for cand in (r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
                         r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
                         r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
                         r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
                         r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
                         r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe"):
                if Path(cand).is_file():
                    blender = cand
                    break
        if not blender:
            print("ERROR: no 'blender' on PATH and no Blender install found in "
                  "C:\\Program Files\\Blender Foundation\\", file=sys.stderr)
            print("Install Blender or pre-build the cache zip manually.", file=sys.stderr)
            return 3
        local_cache.mkdir(parents=True, exist_ok=True)
        out_zip = local_cache / f"coll_{_safe(coll)}.zip"
        env = {
            **os.environ,
            "BLEND_EXTRACTOR_INPUT": str(blend_path),
            "BLEND_EXTRACTOR_OUTPUT": str(out_zip),
            "BLEND_EXTRACTOR_TEXDIR": str(local_cache.parent / "textures"),
            "BLEND_EXTRACTOR_MANIFEST": str(local_cache.parent / "manifest.json"),
            "BLEND_EXTRACTOR_COLLECTION": coll,
        }
        print(f"  blender: {blender}")
        print(f"  output:  {out_zip}")
        if not args.dry_run:
            try:
                proc = subprocess.run(
                    [blender, "--background", "--python", str(extract_script)],
                    env=env, capture_output=True, text=True, timeout=600,
                )
            except subprocess.TimeoutExpired:
                print("ERROR: blender extractor timed out after 600s", file=sys.stderr)
                return 4
            except FileNotFoundError as e:
                print(f"ERROR: blender binary not executable: {e}", file=sys.stderr)
                return 3
            if proc.returncode != 0 or not out_zip.is_file():
                print("ERROR: extractor failed", file=sys.stderr)
                print("--- stdout (last 1500) ---")
                print(proc.stdout[-1500:])
                print("--- stderr (last 1500) ---")
                print(proc.stderr[-1500:])
                return 4
        local_zip = out_zip
    else:
        print(f"[1/4] using cached zip: {local_zip.name}")

    print(f"[2/4] uploading to baidu: {remote_zip}")
    if not args.dry_run:
        baidumod.ensure_folder(remote_parent)
        baidumod.upload(str(local_zip), remote_zip)

    print(f"[3/4] creating share link")
    if args.dry_run:
        print("  [dry-run] would share", remote_zip)
        return 0
    file_url, pan_code = baidumod.share(remote_zip, period_days=args.period)
    size_bytes = local_zip.stat().st_size

    print(f"[4/4] saving to collectionShareLinks")
    link_id = dbmod.upsert_collection_share(
        args.resource_id, coll,
        file_url=file_url, pan_code=pan_code or None,
        baidu_path=remote_zip, size_bytes=size_bytes,
    )
    print(f"  link id: {link_id}")
    print(f"  url:    {file_url}")
    print(f"  code:   {pan_code}")
    print(f"  size:   {size_bytes} bytes")
    return 0


def cmd_unshare_collection(args: argparse.Namespace) -> int:
    """Remove the share link row (does NOT delete the baidu file)."""
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    coll = args.collection.strip()
    existing = dbmod.get_collection_share(args.resource_id, coll)
    if not existing:
        print(f"no share link for collection {coll!r} on resource {args.resource_id}")
        return 0
    if not args.yes and not _confirm(f"remove DB row for {coll!r}? (baidu file kept)"):
        print("aborted.")
        return 1
    dbmod.delete_collection_share(args.resource_id, coll)
    print(f"removed DB row for {coll!r}")
    print(f"(baidu file still at {existing.get('baiduPath')} — re-share anytime)")
    return 0


def _find_blender_binary() -> Optional[str]:
    """Locate a `blender` binary on this machine.  Returns absolute path or None."""
    found = shutil.which("blender")
    if found:
        return found
    for cand in (
        r"D:\Blender\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.4\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.3\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
        r"C:\Program Files\Blender Foundation\Blender 3.6\blender.exe",
    ):
        if Path(cand).is_file():
            return cand
    return None


def _run_blender_parser(blend_path: Path, manifest_out: Path) -> dict:
    """Run blend_asset_parser.py on a .blend file via Blender CLI.

    Writes `manifest_out.json` next to the blend and returns the parsed
    dict (also includes the spec fields: blenderVersion, frameStart,
    frameEnd, fps, renderEngine, lightSetup, etc.).

    Raises BdpanError on Blender or parser failure.
    """
    blender = _find_blender_binary()
    if not blender:
        raise baidumod.BdpanError(
            "no 'blender' binary found. Install Blender 4.x or 5.x and re-run."
        )
    script = dbmod.PROJECT_ROOT / "api" / "tools" / "blend_asset_parser.py"
    if not script.is_file():
        raise baidumod.BdpanError(f"parser not found at {script}")
    env = {
        **os.environ,
        "BLEND_ASSET_PARSER_INPUT": str(blend_path.resolve()),
        "BLEND_ASSET_PARSER_OUTPUT": str(manifest_out.resolve()),
    }
    proc = subprocess.run(
        [blender, "--background", "--python", str(script)],
        env=env, capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0 or not manifest_out.is_file():
        raise baidumod.BdpanError(
            f"blender parser failed (rc={proc.returncode})\n"
            f"--- stdout (last 1500) ---\n{proc.stdout[-1500:]}\n"
            f"--- stderr (last 1500) ---\n{proc.stderr[-1500:]}"
        )
    return json.loads(manifest_out.read_text(encoding="utf-8"))


def cmd_set_renderer(args: argparse.Namespace) -> int:
    """Manually set the render engine on a blend asset.

    Used when the parser couldn't extract it (Blender not installed
    locally yet, or the manifest was generated before the parser was
    extended). A later `reparse` will overwrite this with the real
    value from the .blend file.

    Two ways to call:
      --engine cycles        manual value (cycles, eevee, eevee_next, workbench)
      --auto                 read from local data/blend_assets/<id>/fixed.blend
                             using lib.read_engine (no Blender required)
    """
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    if not res.get("tagGroups"):
        print(f"ERROR: resource {args.resource_id} has no tagGroups (not a blend asset?)",
              file=sys.stderr)
        return 1

    if args.auto:
        # Auto-detect from local .blend
        blend_path = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(args.resource_id) / "fixed.blend"
        if not blend_path.is_file():
            print(f"ERROR: {blend_path} not found.", file=sys.stderr)
            print(f"  pass --engine instead, or place fixed.blend at that path", file=sys.stderr)
            return 2
        # Import the reader module (lib/blend_reader.py)
        try:
            from lib.blend_reader import read_engine_canonical
        except ImportError as e:
            print(f"ERROR: cannot import lib.blend_reader: {e}", file=sys.stderr)
            return 3
        engine = read_engine_canonical(blend_path)
        if not engine:
            print(f"ERROR: could not detect engine in {blend_path}", file=sys.stderr)
            return 3
        print(f"detected: {engine}  (from {blend_path.name})")
    else:
        # Normalize manual input: accept short names and expand to
        # the canonical form the parser uses.
        raw = args.engine.strip().upper().replace(" ", "_").replace("-", "_")
        alias = {
            "CYCLES": "CYCLES",
            "EEVEE": "BLENDER_EEVEE",
            "EEVEE_NEXT": "BLENDER_EEVEE_NEXT",
            "BLENDER_EEVEE": "BLENDER_EEVEE",
            "BLENDER_EEVEE_NEXT": "BLENDER_EEVEE_NEXT",
            "WORKBENCH": "BLENDER_WORKBENCH",
            "BLENDER_WORKBENCH": "BLENDER_WORKBENCH",
        }
        engine = alias.get(raw)
        if not engine:
            print(f"ERROR: engine {args.engine!r} not recognized.", file=sys.stderr)
            print(f"  valid values: {sorted(alias.keys())}", file=sys.stderr)
            return 2

    import sqlite3, json as _json
    con = sqlite3.connect(str(dbmod.DB_PATH))
    tg = _json.loads(con.execute(
        "SELECT tagGroups FROM resources WHERE id = ?", (args.resource_id,)
    ).fetchone()[0])
    tg["renderEngine"] = engine
    con.execute(
        "UPDATE resources SET tagGroups = ?, updatedAt = datetime('now') WHERE id = ?",
        (_json.dumps(tg, ensure_ascii=False), args.resource_id),
    )
    con.commit()
    con.close()
    print(f"id={args.resource_id}  renderEngine set to: {engine}")
    print(f"  (will be overwritten next time `manage.py reparse` runs)")
    return 0


def cmd_reshare(args: argparse.Namespace) -> int:
    """Re-create share links for an existing resource and update the DB.

    Use when a link was created with a limited period (pre-2026-08-24
    defaults were 7 days) or was otherwise invalidated.  Re-shares the
    main file at its canonical baidu path; with --collections also
    re-shares every per-collection link.  The old shares simply expire
    on their own — no cancel API exists in bdpan.
    """
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1
    remote = _derive_remote_path(res)

    print(f"[main] sharing {remote}  (period={args.period})")
    try:
        url, code = baidumod.share(remote, period_days=args.period)
    except baidumod.BdpanError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    dbmod.update_file_url(args.resource_id, file_url=url, pan_code=code or None)
    print(f"  url:  {url}")
    print(f"  code: {code}")

    if not args.collections:
        return 0
    for row in dbmod.list_collection_shares(args.resource_id):
        coll = row["collectionName"]
        path = row["baiduPath"]
        print(f"[coll:{coll}] sharing {path}")
        try:
            c_url, c_code = baidumod.share(path, period_days=args.period)
        except baidumod.BdpanError as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            continue
        dbmod.upsert_collection_share(
            args.resource_id, coll,
            file_url=c_url, pan_code=c_code or None,
            baidu_path=path, size_bytes=row.get("sizeBytes"),
        )
        print(f"  url:  {c_url}")
        print(f"  code: {c_code}")
    return 0


def _locate_source_blend(resource_id: int, title: str) -> Path | None:
    """Find a usable source .blend for a resource, in priority order:
    1. data/blend_assets/<id>/fixed.blend  (proper blend-asset pipeline)
    2. cache/covers/<Slug>_full.zip member  (upload_covers.py repacks)
    3. cache/coll_*.zip member  (per-collection shares)
    4. D:/Blender_Cover/<Blender X.Y_Title>/*  (raw source dirs)
    Returns the .blend path or None.
    """
    asset_dir = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(resource_id)
    fixed = asset_dir / "fixed.blend"
    if fixed.is_file():
        return fixed

    import zipfile, tempfile
    slug = pathmod.slugify_title(title)
    cache = dbmod.PROJECT_ROOT / "cache"
    zip_candidates: list[Path] = []
    if cache.is_dir():
        zip_candidates.extend(cache.rglob(f"covers/{slug}_full.zip"))
        zip_candidates.extend(cache.rglob(f"coll_{slug}.zip"))
    for zp in zip_candidates:
        try:
            with zipfile.ZipFile(zp) as zf:
                members = [i for i in zf.infolist()
                           if i.filename.lower().endswith(".blend")
                           and not i.filename.endswith(".blend1")]
                if not members:
                    continue
                biggest = max(members, key=lambda i: i.file_size)
                tmpdir = Path(tempfile.mkdtemp(prefix=f"thumb_{resource_id}_"))
                target = tmpdir / Path(biggest.filename).name
                with zf.open(biggest) as src, open(target, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
                return target
        except Exception:
            continue

    # D:/Blender_Cover fallback (always available, survives the cache/covers
    # zip going missing).  Two shapes are handled:
    #   - the source folder contains a .blend directly (repack case)
    #   - it contains a single .zip (as-is case) -> extract the .blend
    #     to a tempdir and return that path.
    covers_root = Path(r"D:\Blender_Cover")
    if covers_root.is_dir():
        norm = title.replace(" ", "").lower()
        for folder in covers_root.iterdir():
            if not folder.is_dir() or norm not in folder.name.replace(" ", "").lower():
                continue
            blends = [p for p in folder.rglob("*.blend") if not p.name.endswith(".blend1")]
            if blends:
                return blends[0]
            zips = [p for p in folder.rglob("*.zip") if p.is_file()]
            if zips:
                try:
                    with zipfile.ZipFile(zips[0]) as zf:
                        members = [i for i in zf.infolist()
                                   if i.filename.lower().endswith(".blend")
                                   and not i.filename.endswith(".blend1")]
                        if not members:
                            continue
                        biggest = max(members, key=lambda i: i.file_size)
                        tmpdir = Path(tempfile.mkdtemp(prefix=f"thumb_{resource_id}_"))
                        target = tmpdir / Path(biggest.filename).name
                        with zf.open(biggest) as src, open(target, "wb") as dst:
                            while chunk := src.read(1 << 20):
                                dst.write(chunk)
                        return target
                except Exception:
                    continue
    return None


def cmd_thumbnail(args: argparse.Namespace) -> int:
    """Render the card thumbnail for a blend asset.

    Locates a source .blend (asset_dir/fixed.blend, or the repack zip
    in cache/covers/, or the original D:/Blender_Cover folder), runs
    blend_thumbnail_render.py via Blender CLI, writes the PNG to
    data/blend_assets/<id>/thumbnail.png, and patches resources.imageUrl
    so the card image is live.

    --all renders every Blender resource that still lacks a thumbnail.
    """
    blender = _find_blender_binary()
    if not blender:
        print("ERROR: no 'blender' binary found. Install Blender 4.x / 5.x and re-run.",
              file=sys.stderr)
        return 2
    script = dbmod.PROJECT_ROOT / "api" / "tools" / "blend_thumbnail_render.py"
    if not script.is_file():
        print(f"ERROR: {script} not found", file=sys.stderr)
        return 2

    if args.all:
        targets = []
        for r in dbmod.list_all():
            tg = r.get("tagGroups")
            try:
                tg_obj = json.loads(tg) if isinstance(tg, str) else (tg or {})
            except Exception:
                tg_obj = {}
            if (tg_obj.get("schema") == "blend-asset-v1"
                    and not r.get("imageUrl")):
                targets.append(r)
    else:
        res = dbmod.get_resource(args.resource_id)
        if not res:
            print(f"ERROR: no resource id={args.resource_id}", file=sys.stderr)
            return 1
        targets = [res]

    failed = 0
    for r in targets:
        rid = int(r["id"])
        title = r["title"]
        asset_dir = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(rid)
        asset_dir.mkdir(parents=True, exist_ok=True)
        out_png = asset_dir / "thumbnail.png"
        if out_png.is_file() and out_png.stat().st_size > 1024 and not args.force:
            print(f"-- SKIP id={rid} {title!r}: thumbnail already exists "
                  f"({out_png.stat().st_size//1024} KB). pass --force to redo.")
            continue

        src = _locate_source_blend(rid, title)
        if not src:
            print(f"!! id={rid} {title!r}: no source .blend found "
                  "(checked data/blend_assets/<id>/fixed.blend, cache/covers, "
                  "cache/coll_*.zip, D:/Blender_Cover). skipping.")
            failed += 1
            continue

        print(f"=== [id={rid}] {title}  src={src.name} ({src.stat().st_size//1024//1024} MB)")
        # Detect the real engine from the .blend data section BEFORE running
        # Blender.  We pass it as BLEND_THUMBNAIL_ENGINE so the render script
        # honors the file's own engine rather than guessing a fallback
        # (e.g. forcing EEVEE on a Cycles splash, which the user noticed).
        try:
            from lib.blend_reader import read_engine_canonical
            real_engine = read_engine_canonical(src)
        except Exception:
            real_engine = None
        if real_engine:
            print(f"   file engine: {real_engine}  (from binary read)")
        env = {
            **os.environ,
            "BLEND_THUMBNAIL_INPUT": str(src.resolve()),
            "BLEND_THUMBNAIL_OUTPUT": str(out_png.resolve()),
            "BLEND_THUMBNAIL_SIZE": str(args.size),
        }
        if real_engine:
            env["BLEND_THUMBNAIL_ENGINE"] = real_engine
        proc = subprocess.run(
            [blender, "--background", "--python", str(script)],
            env=env, capture_output=True, text=True, timeout=900,
        )
        png_ok = out_png.is_file() and out_png.stat().st_size > 1024
        if proc.returncode != 0 or not png_ok:
            print(f"   FAIL rc={proc.returncode}  png_size="
                  f"{out_png.stat().st_size if out_png.exists() else 0}")
            # The render script writes its main progress to stdout, so
            # surface BOTH stdout and stderr tails — especially helpful
            # for tracking down PyDriver / asset path failures that
            # would otherwise look like silent crashes.
            print(f"   stdout tail:\n{proc.stdout[-1200:]}")
            print(f"   stderr tail:\n{proc.stderr[-1200:]}")
            failed += 1
            continue
        size_kb = out_png.stat().st_size // 1024
        # Patch resources.imageUrl so the card image is live, and mark
        # thumbnailReady so the frontend stops polling.
        with dbmod.connect() as con:
            con.execute(
                "UPDATE resources SET imageUrl = ?, updatedAt = datetime('now') "
                "WHERE id = ?",
                (f"/api/blend-assets/{rid}/thumbnail", rid),
            )
            tg_row = con.execute(
                "SELECT tagGroups FROM resources WHERE id = ?", (rid,)
            ).fetchone()
            if tg_row and tg_row[0]:
                tg_obj = json.loads(tg_row[0])
                tg_obj["thumbnailReady"] = True
                con.execute(
                    "UPDATE resources SET tagGroups = ? WHERE id = ?",
                    (json.dumps(tg_obj, ensure_ascii=False), rid),
                )
            con.commit()
        print(f"   OK -> {out_png}  ({size_kb} KB)  imageUrl set")
        if src.parent.name.startswith("thumb_") and "_" in src.parent.name:
            import shutil as _sh
            _sh.rmtree(src.parent, ignore_errors=True)

    if args.all:
        print(f"\n=== {len(targets)-failed}/{len(targets)} thumbnails ok ===")
    return 0 if failed == 0 else 1


def cmd_reparse(args: argparse.Namespace) -> int:
    """Re-run blend_asset_parser.py on an existing resource's .blend and
    write the result back to tagGroups.  This is how to backfill the
    spec fields (Blender version, frame range, FPS, render engine,
    light setup) on resources whose manifest was generated before the
    parser was extended (2026-08-24), or just to refresh after
    re-saving the .blend.

    Looks for `data/blend_assets/<id>/fixed.blend` locally.  If not
    present, can optionally download from baidu (--from-baidu).
    """
    res = dbmod.get_resource(args.resource_id)
    if not res:
        print(f"ERROR: no resource with id={args.resource_id}", file=sys.stderr)
        return 1

    asset_dir = dbmod.PROJECT_ROOT / "data" / "blend_assets" / str(args.resource_id)
    blend_path = asset_dir / "fixed.blend"
    if not blend_path.is_file():
        if args.from_baidu:
            print(f"downloading from baidu: {res.get('fileUrl')}")
            tmp_zip = asset_dir / "_reparse_download.zip"
            asset_dir.mkdir(parents=True, exist_ok=True)
            baidumod.download(res["fileUrl"], str(tmp_zip))
            import zipfile
            with zipfile.ZipFile(tmp_zip) as zf:
                with zf.open("fixed.blend") as src, open(blend_path, "wb") as dst:
                    dst.write(src.read())
            tmp_zip.unlink(missing_ok=True)
        else:
            print(f"ERROR: {blend_path} not found locally.", file=sys.stderr)
            print(f"  Re-run with --from-baidu to download from baidu first,", file=sys.stderr)
            print(f"  or place fixed.blend at that path manually.", file=sys.stderr)
            return 2

    manifest_out = asset_dir / "manifest.json"
    print(f"[1/3] parsing {blend_path.name} via Blender…")
    try:
        raw_manifest = _run_blender_parser(blend_path, manifest_out)
    except baidumod.BdpanError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3
    except Exception as e:
        print(f"ERROR: unexpected: {e}", file=sys.stderr)
        return 3
    print(f"  ok → {manifest_out}")

    print(f"[2/3] merging into tagGroups…")
    # The shape we store in DB is a subset of the manifest (mirrors what
    # server.ts builds in /api/admin/resources/blend).  We rebuild it
    # here so a reparse is bit-identical to a fresh upload.
    scene = raw_manifest.get("scene", {}) or {}
    assets = raw_manifest.get("assets", []) or []
    actions = raw_manifest.get("actions", []) or []
    textures = raw_manifest.get("textures", []) or []
    new_tg = {
        "status": "ready",
        "schema": "blend-asset-v1",
        "resourceId": args.resource_id,
        "blenderVersion": (raw_manifest.get("blend") or {}).get("blender_version"),
        # Spec fields — these are the "every upload populates them" set
        "frameStart": scene.get("frame_start"),
        "frameEnd": scene.get("frame_end"),
        "fps": scene.get("fps"),
        "renderEngine": scene.get("render_engine"),
        "summary": {
            "assets": [
                {k: a.get(k) for k in ("id", "name", "type", "parent_collection",
                "instance_count", "vert_count", "tri_count",
                "material_count", "texture_count", "has_armature")}
                for a in assets
            ],
            "assetCount": len(assets),
            "actionCount": len(actions),
            "actions": [
                {"name": a.get("name"), "frames": [a.get("frame_start"), a.get("frame_end")],
                 "durationSeconds": a.get("duration_seconds")} for a in actions
            ],
            "textureCount": len(textures),
            "missingTextures": sum(1 for t in textures if t.get("source") == "missing"),
        },
    }
    cur = dbmod.connect()
    cur.execute(
        "UPDATE resources SET tagGroups = ?, updatedAt = datetime('now') WHERE id = ?",
        (json.dumps(new_tg, ensure_ascii=False), args.resource_id),
    )
    cur.commit()
    cur.close()
    print(f"[3/3] done.")
    print(f"  blender version:  {new_tg['blenderVersion']}")
    print(f"  frame range:      {new_tg['frameStart']} – {new_tg['frameEnd']}")
    print(f"  fps:              {new_tg['fps']}")
    print(f"  render engine:    {new_tg['renderEngine']}")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    """Sanity-check that baidu-pan share URLs still resolve.

    For each resource:
      * HEAD the share URL (no extraction code — the OWNER always
        gets through; we just want to confirm the URL is alive).
      * ls the expected baidu path (catches moved/deleted files even
        if the share URL still works).
    """
    import urllib.request
    if args.all:
        rows = dbmod.list_all()
    elif args.resource_id:
        r = dbmod.get_resource(args.resource_id)
        rows = [r] if r else []
    else:
        rows = dbmod.list_all()

    if not rows:
        print("no resources to verify.")
        return 0

    print(f"verifying {len(rows)} resources...\n")
    ok = 0
    bad = 0
    skipped = 0
    for r in rows:
        rid = r["id"]
        title = r["title"]
        url = r.get("fileUrl") or ""
        # No fileUrl = resource is intentionally disabled (no real file yet).
        # That's not a bug; skip it from the OK/BAD accounting.
        if not url:
            print(f"  [--]   id={rid:>3}  {title}  (no fileUrl — disabled)")
            skipped += 1
            continue
        expected_path = _derive_remote_path(r)
        issues: list[str] = []

        # 1. URL HEAD
        try:
            req = urllib.request.Request(url, method="HEAD")
            resp = urllib.request.urlopen(req, timeout=8)
            if resp.status >= 400:
                issues.append(f"HEAD {url} -> {resp.status}")
        except Exception as e:
            issues.append(f"HEAD {url} -> {e}")

        # 2. baidu path exists — expect at least one .zip entry.
        # (bdpan quirk: a folder with only files sometimes shows them
        # with type="目录"; we accept any entry whose name ends in .zip.)
        try:
            entries = baidumod.ls(expected_path)
            zip_entries = [e for e in entries if e["name"].endswith(".zip")]
            if not zip_entries:
                issues.append(f"baidu ls {expected_path} returned no .zip entries")
        except baidumod.BdpanError as e:
            issues.append(f"baidu ls {expected_path} -> {e}")

        if issues:
            print(f"  [BAD]  id={rid:>3}  {title}")
            for i in issues:
                print(f"         - {i}")
            bad += 1
        else:
            print(f"  [OK]   id={rid:>3}  {title}")
            ok += 1

    print(f"\n{ok} ok, {bad} bad, {skipped} disabled")
    return 0 if bad == 0 else 1


# --- arg parser -------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="manage.py",
        description="CGResourceHub baidu-pan resource manager (upload/delete/rename/recategorize/verify).",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    up = sub.add_parser("upload", help="upload local file -> baidu pan -> insert into DB")
    up.add_argument("local", help="path to the local file to upload")
    up.add_argument("--software", help='e.g. "Blender" / "Unreal Engine" / "Maya"')
    up.add_argument("--title", help="resource title (defaults to filename without extension)")
    up.add_argument("--description", default="")
    up.add_argument("--category", help="resources.category; defaults to --software")
    up.add_argument("--element", nargs="*", default=[], help="tagGroups.element[] entries")
    up.add_argument("--technique", nargs="*", default=[], help="tagGroups.technique[] entries")
    up.add_argument("--period", type=int, default=0,
                    help="share period in days (0=永久, 1, 7, 30). Default 0: "
                         "resource-hub links must not silently expire (2026-08-24)")
    up.add_argument("--dry-run", action="store_true", help="don't actually upload/share/insert")
    up.set_defaults(func=cmd_upload)

    de = sub.add_parser("delete", help="delete a resource (DB row + baidu file)")
    de.add_argument("resource_id", type=int)
    de.add_argument("--yes", action="store_true", help="skip confirmation")
    de.set_defaults(func=cmd_delete)

    rn = sub.add_parser("rename", help="rename a resource (DB title + baidu file path)")
    rn.add_argument("resource_id", type=int)
    rn.add_argument("--new-title", required=True)
    rn.add_argument("--yes", action="store_true")
    rn.set_defaults(func=cmd_rename)

    rc = sub.add_parser("recategorize", help="move resource to a different software folder")
    rc.add_argument("resource_id", type=int)
    rc.add_argument("--new-software", required=True, help='e.g. "Houdini" / "Maya"')
    rc.add_argument("--yes", action="store_true")
    rc.set_defaults(func=cmd_recategorize)

    ve = sub.add_parser("verify", help="HEAD each share URL + ls the expected baidu path")
    ve.add_argument("resource_id", type=int, nargs="?", default=None)
    ve.add_argument("--all", action="store_true")
    ve.set_defaults(func=cmd_verify)

    sc = sub.add_parser("share-collection",
                        help="build (if needed) + upload + share one collection's zip")
    sc.add_argument("resource_id", type=int)
    sc.add_argument("--collection", required=True, help='Blender collection name (e.g. "Terrains")')
    sc.add_argument("--period", type=int, default=0,
                    help="share period in days (0=permanent). Default 0: links "
                         "must not silently expire")
    sc.add_argument("--dry-run", action="store_true")
    sc.set_defaults(func=cmd_share_collection)

    uc = sub.add_parser("unshare-collection",
                        help="remove the DB row for a collection share (keeps baidu file)")
    uc.add_argument("resource_id", type=int)
    uc.add_argument("--collection", required=True)
    uc.add_argument("--yes", action="store_true")
    uc.set_defaults(func=cmd_unshare_collection)

    rp = sub.add_parser("reparse",
                        help="re-run blend_asset_parser.py on a resource's .blend and write the new tagGroups")
    rp.add_argument("resource_id", type=int, help="resource to reparse")
    rp.add_argument("--from-baidu", action="store_true",
                    help="download the .blend from baidu if it's not present locally")
    rp.set_defaults(func=cmd_reparse)

    rs = sub.add_parser("reshare",
                        help="re-create share links for a resource (fix expiring/invalid links)")
    rs.add_argument("resource_id", type=int)
    rs.add_argument("--period", type=int, default=0,
                    help="share period in days (0=permanent). Default 0")
    rs.add_argument("--collections", action="store_true",
                    help="also re-share every per-collection link of the resource")
    rs.set_defaults(func=cmd_reshare)

    th = sub.add_parser("thumbnail",
                        help="render a card thumbnail PNG via Blender CLI")
    th.add_argument("resource_id", type=int, nargs="?", default=None)
    th.add_argument("--all", action="store_true",
                    help="render every Blender resource without an imageUrl")
    th.add_argument("--force", action="store_true",
                    help="re-render even if thumbnail.png already exists")
    th.add_argument("--size", type=int, default=2048,
                    help="long-edge pixel size (default 2048)")
    th.set_defaults(func=cmd_thumbnail)

    sr = sub.add_parser("set-renderer",
                        help="manually set the render engine on a blend asset (overwritten by reparse)")
    sr.add_argument("resource_id", type=int)
    sr.add_argument("--engine", help='one of: cycles, eevee, eevee_next, workbench')
    sr.add_argument("--auto", action="store_true",
                    help="auto-detect from local data/blend_assets/<id>/fixed.blend (no Blender required)")
    sr.set_defaults(func=cmd_set_renderer)

    return p


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
