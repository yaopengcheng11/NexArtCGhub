# blend_texture_fixer.py — rewrite image paths inside a .blend to use a
# canonical local textures/ folder.
#
# Run by blender.exe in headless mode (-b -P). The motivation:
#   CGTrader-style asset packs ship with a .blend referencing textures
#   via long relative paths like `//..\\Asset_textures\\foo.png`. After
#   upload to cg-resource-hub, the user's local copy of those files is
#   in `data/blend_assets/<id>/textures/` instead. We rewrite every
#   image's filepath so that:
#     1. External references point to the textures/ folder we ship with
#        the downloaded zip (relative `textures/<basename>`), so the
#        user's Blender opens the file with textures intact.
#     2. Missing files (path doesn't resolve on server either) are
#        recorded as warnings instead of silently dropped.
#
# CLI / env contract (matches parser.py):
#   BLEND_TEXTURE_FIXER_INPUT    input .blend to fix in place
#   BLEND_TEXTURE_FIXER_OUTPUT   where to save the fixed .blend
#   BLEND_TEXTURE_FIXER_TEXDIR   absolute path to textures/ folder whose
#                                contents will be the canonical reference
#
# Output (stdout, one line JSON between markers):
#   {
#     "ok": true,
#     "images_fixed": N,
#     "images_packed": N,
#     "images_missing": [{"name", "old_path"}],
#     "output": "..."
#   }

import json
import os
import sys
import shutil

import bpy  # type: ignore


def _emit(s: str) -> None:
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def fix_blend(blend_in: str, blend_out: str, textures_dir: str) -> dict:
    if not os.path.isfile(blend_in):
        raise FileNotFoundError(blend_in)
    if blend_in == blend_out:
        # blender can't load+save the same path atomically; copy first.
        tmp = blend_out + '.in'
        shutil.copy2(blend_in, tmp)
        blend_in = tmp

    bpy.ops.wm.open_mainfile(filepath=blend_in, load_ui=False)

    fixed = 0
    packed = 0
    missing = []
    # Map basename → texture file on disk (case-insensitive, since
    # CGTrader zips often mix Case.jpg vs case.jpg).
    tex_lookup = {}
    if textures_dir and os.path.isdir(textures_dir):
        for fn in os.listdir(textures_dir):
            tex_lookup[fn.lower()] = fn

    for img in bpy.data.images:
        if img.packed_file is not None:
            packed += 1
            # If packed, leave it — already embedded in .blend.
            continue

        old_path = img.filepath or ''
        base = os.path.basename(old_path)
        if not base:
            # Empty path (unassigned image slot) — skip.
            continue

        # Build the canonical relative path: `//textures/<basename>`.
        # The leading `//` is Blender's blend-file-relative marker.
        # Without it, Windows Blender treats the path as a single
        # filename instead of a subfolder (so the texture silently
        # goes missing on the user's machine).
        target_basename = tex_lookup.get(base.lower(), base)
        new_path = '//textures/' + target_basename
        if img.filepath != new_path:
            img.filepath = new_path
            fixed += 1
        else:
            img.filepath = new_path

        # After setting, ask Blender to reload. If the texture really
        # exists, the image becomes non-empty; otherwise it's marked
        # missing (we still keep the path so the user's local copy can
        # find it once they download textures.zip too).
        # IMPORTANT: bpy.path.abspath('textures/foo.jpg') resolves
        # against cwd (often wrong in headless). Use the explicit
        # '//' prefix to anchor at the .blend's own directory, then
        # construct the absolute path manually.
        try:
            # The texture will end up next to the saved .blend at
            # <out_dir>/textures/<basename>. Check both that path AND
            # the input textures_dir (the user-uploaded zip's
            # flattened contents), since on the first upload the input
            # dir is the source of truth and the output dir won't
            # exist yet.
            blend_dir = os.path.dirname(os.path.abspath(blend_out))
            expected_out = os.path.join(blend_dir, target_basename)
            expected_in = os.path.join(textures_dir, target_basename) \
                if textures_dir else ''
            if not (os.path.isfile(expected_out) or
                    (expected_in and os.path.isfile(expected_in))):
                missing.append({"name": img.name, "old_path": old_path,
                                 "expected": target_basename})
        except Exception:
            pass

    # Save (only if there were changes; safe to always save anyway).
    os.makedirs(os.path.dirname(os.path.abspath(blend_out)) or '.',
                exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_out)

    return {
        "ok": True,
        "images_fixed": fixed,
        "images_packed": packed,
        "images_missing": missing,
        "output": os.path.abspath(blend_out),
    }


def main():
    blend_in = os.environ.get('BLEND_TEXTURE_FIXER_INPUT', '')
    blend_out = os.environ.get('BLEND_TEXTURE_FIXER_OUTPUT', '')
    tex_dir = os.environ.get('BLEND_TEXTURE_FIXER_TEXDIR', '')

    if not blend_in or not blend_out:
        _emit("FIX_ERROR: need BLEND_TEXTURE_FIXER_INPUT and "
              "BLEND_TEXTURE_FIXER_OUTPUT env vars")
        sys.exit(2)

    try:
        result = fix_blend(blend_in, blend_out, tex_dir)
    except Exception as e:
        _emit("FIX_ERROR: {}".format(e))
        sys.exit(1)

    _emit("OK: fixed {} images, {} packed, {} missing".format(
        result["images_fixed"], result["images_packed"],
        len(result["images_missing"])))
    for m in result["images_missing"]:
        _emit("  miss: {} (was {})".format(m["name"], m["old_path"]))

    sys.stdout.write("=== FIXER SUMMARY ===\n")
    sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.write("=== /FIXER SUMMARY ===\n")
    sys.stdout.flush()


if __name__ == '__main__':
    main()
