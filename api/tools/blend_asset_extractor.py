# blend_asset_extractor.py — build a per-asset zip from a .blend
#
# Run by blender.exe in headless mode (-b -P). Given a source .blend
# and an asset_id (object name from the manifest), produces a clean
# zip containing just that asset:
#
#   <asset_name>.zip
#     ├── <asset_name>.blend      # only this mesh + armature
#     ├── textures/                # only referenced textures
#     └── _NexArt_blendasset.md    # audit log
#
# Strategy:
#   1. Read manifest.json (written by parser) to know the asset's
#      geometry + material references.
#   2. Open source .blend.
#   3. Build the keep set: the target mesh + the armature object(s)
#      referenced via its modifier, plus all materials on the kept
#      meshes.
#   4. Strip everything else using the same low-level API strategy
#      as before (snapshot names, remove with do_unlink, then drop
#      orphan data blocks).
#   5. Rewrite image paths to `//textures/<basename>` so the user's
#      unpacked zip's directory structure matches.
#   6. Pack into zip.
#
# CLI / env contract:
#   BLEND_EXTRACTOR_INPUT     source .blend (the fixed copy)
#   BLEND_EXTRACTOR_OUTPUT    path of the .zip to create
#   BLEND_EXTRACTOR_TEXDIR    textures/ folder copied verbatim
#   BLEND_EXTRACTOR_ASSET     object name (e.g. "AfricanRhinoceros_Body")
#   BLEND_EXTRACTOR_MANIFEST  path to manifest.json (for materials/textures refs)

import json
import os
import sys
import zipfile

import bpy  # type: ignore


def _emit(s: str) -> None:
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def extract_asset(source_blend: str, output_zip: str, textures_dir: str,
                  asset_id: str, manifest_path: str,
                  collection: str = '') -> dict:
    """Extract one download unit.

    Two modes:
      - asset_id given → keep that asset group (existing behaviour).
      - collection given (asset_id == '__collection__') → keep EVERY
        object in that Blender collection. This is the user-facing
        grouping: "give me all Trees&Bushes", not 132 individual
        canopy meshes (user request 2026-08-24).
    """
    if not os.path.isfile(source_blend):
        raise FileNotFoundError(source_blend)
    if not os.path.isfile(manifest_path):
        raise FileNotFoundError('manifest: {}'.format(manifest_path))

    with open(manifest_path, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    bpy.ops.wm.open_mainfile(filepath=source_blend, load_ui=False)

    by_collection = (asset_id == '__collection__')

    # ---- Decide keep set ----
    if by_collection:
        # Resolve the named collection plus all its child collections.
        # Blender 5.x removed Collection.parent — walk children instead.
        target_coll = bpy.data.collections.get(collection)
        if target_coll is None:
            raise ValueError('Collection {!r} not in file'.format(collection))
        coll_set = {collection}
        def _collect_children(c):
            for ch in c.children:
                coll_set.add(ch.name)
                _collect_children(ch)
        _collect_children(target_coll)

        keep_obj_names = set()
        for o in bpy.data.objects:
            if any(c.name in coll_set for c in o.users_collection):
                keep_obj_names.add(o.name)
        if not keep_obj_names:
            raise ValueError('Collection {!r} has no objects'.format(collection))
    else:
        # The manifest groups instances by (base stem, vertex count) — e.g.
        # bush_1.011 through bush_1.153 collapse into one asset. Mirror that
        # grouping here: keep every mesh object whose data name matches the
        # same group as the asset id.
        import re
        SUFFIX_RE = re.compile(r'^(.*)\.(\d{3})$')

        def group_key_of(dname, vcount):
            m = SUFFIX_RE.match(dname)
            if m:
                return (m.group(1), vcount)
            return (dname, vcount)

        target_obj = bpy.data.objects.get(asset_id)
        if target_obj is None or target_obj.type != 'MESH':
            raise ValueError('Asset {!r}: no such mesh object'.format(asset_id))
        target_key = group_key_of(target_obj.data.name,
                                  len(target_obj.data.vertices))

        keep_obj_names = set()
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.data and \
                    group_key_of(o.data.name, len(o.data.vertices)) == target_key:
                keep_obj_names.add(o.name)

    # Find armatures referenced via any kept mesh's modifiers — these
    # are part of the asset too.
    keep_armature_names = set()
    for name in keep_obj_names:
        o = bpy.data.objects[name]
        for m in o.modifiers:
            if m.type == 'ARMATURE' and m.object:
                keep_armature_names.add(m.object.name)

    keep_names = keep_obj_names | keep_armature_names
    instance_count = len(keep_obj_names)

    # Snapshot names before we strip — same StructRNA-safety pattern
    # as before. We also strip empty/collection clutter.
    all_objs = list(bpy.data.objects)
    strip_names = []
    for o in all_objs:
        if o.name in keep_names:
            continue
        # Drop empties, lights, cameras, controllers (helpers)
        if o.type in ('EMPTY', 'CAMERA', 'LIGHT'):
            strip_names.append(o.name)
            continue
        # Drop controllers (tiny meshes parented to bones, named Ctr_* etc.)
        if o.type == 'MESH':
            if o.data and len(o.data.vertices) < 100:
                strip_names.append(o.name)
                continue
            if any(o.name.startswith(p) for p in ('Ctr_', 'IK_', 'FK_', 'Pole_', 'Helper_')):
                strip_names.append(o.name)
                continue
        # Drop other armature objects that aren't the ones we keep
        if o.type == 'ARMATURE' and o.name not in keep_armature_names:
            strip_names.append(o.name)
            continue
        # Drop other meshes we don't need
        if o.type == 'MESH':
            strip_names.append(o.name)
            continue
        # Otherwise keep (defensive)
    n_keep = len(keep_names)
    n_strip = len(strip_names)
    n_removed = 0

    # ---- Remove strip set ----
    for name in strip_names:
        obj = bpy.data.objects.get(name)
        if obj is None:
            continue
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
            n_removed += 1
        except Exception as e:
            sys.stderr.write('WARN: remove {} failed: {}\n'.format(name, e))

    # ---- Drop orphan meshes / armatures ----
    keep_mesh_data_names = set()
    keep_arm_data_names = set()
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.data:
            keep_mesh_data_names.add(o.data.name)
        if o.type == 'ARMATURE' and o.data:
            keep_arm_data_names.add(o.data.name)

    for m in list(bpy.data.meshes):
        if m.name not in keep_mesh_data_names:
            try:
                bpy.data.meshes.remove(m)
            except Exception:
                pass
    for a in list(bpy.data.armatures):
        if a.name not in keep_arm_data_names:
            try:
                bpy.data.armatures.remove(a)
            except Exception:
                pass

    # ---- Drop unused materials + images ----
    # Materials on kept meshes must be kept. Everything else goes.
    used_mats = set()
    for o in list(bpy.data.objects):
        if o.type == 'MESH':
            for slot in o.material_slots:
                if slot.material:
                    used_mats.add(slot.material.name)
    for mat in list(bpy.data.materials):
        if mat.name not in used_mats:
            try:
                bpy.data.materials.remove(mat)
            except Exception:
                pass

    # Compute used textures from kept materials' node trees.
    used_images = set()
    for matname in used_mats:
        mat = bpy.data.materials.get(matname)
        if not mat or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                used_images.add(node.image.name)

    # If any image is referenced by a kept object via something else
    # (e.g. a world texture), be conservative and keep it.
    for img in list(bpy.data.images):
        if img.type == 'RENDER_RESULT':
            continue
        if img.users == 0 or img.name not in used_images:
            # only remove if truly unreferenced
            if img.users == 0:
                try:
                    bpy.data.images.remove(img)
                except Exception:
                    pass

    # ---- Rewrite image paths to //textures/<basename> ----
    # Critical for Windows Blender: see notes in earlier extractor.
    # We save to asset_dir (sibling of textures/) so the relative
    # path stored on disk is exactly `textures\foo.jpg`.
    save_dir = os.path.dirname(os.path.abspath(source_blend))
    if save_dir.endswith(('cache', 'tmp')):
        save_dir = os.path.dirname(save_dir)

    for img in bpy.data.images:
        fp = img.filepath
        if not fp:
            continue
        try:
            abs_now = bpy.path.abspath(fp)
        except Exception:
            abs_now = ''
        base = os.path.basename(abs_now.replace('\\', '/')) if abs_now \
            else os.path.basename(fp.replace('\\', '/'))
        if not base:
            continue
        rel = os.path.relpath(
            os.path.join(save_dir, 'textures', base),
            save_dir)
        rel = rel.replace('\\', '/')
        new_fp = '//' + rel
        if img.filepath != new_fp:
            img.filepath = new_fp

    # ---- Save ----
    cleaned_blend = os.path.join(save_dir, '_asset_cleaned.blend')
    bpy.ops.wm.save_as_mainfile(filepath=cleaned_blend)

    # ---- Build zip ----
    if os.path.isfile(output_zip):
        os.remove(output_zip)

    archive_blend_name = (collection or asset_id) + '.blend'
    audit_label = ('Collection: {}'.format(collection)
                   if collection else 'Asset: {}'.format(asset_id))

    audit_lines = [
        "# CG Resource Hub — blend asset extract",
        "",
        "- **Source blend**: `{}`".format(source_blend),
        "- **{}**".format(audit_label),
        "- **Instances shipped**: {}".format(instance_count),
        "- **Objects kept**: {}".format(n_keep),
        "- **Objects stripped**: {}".format(n_strip),
        "- **Removed OK**: {}".format(n_removed),
        "- **Materials on kept meshes**: {}".format(len(used_mats)),
        "- **Textures on kept materials**: {}".format(len(used_images)),
        "",
        "## Kept",
        "",
    ]
    for nm in sorted(keep_names):
        audit_lines.append("- `{}`".format(nm))
    audit_lines += ["", "## Stripped (first 30)", ""]
    for nm in strip_names[:30]:
        audit_lines.append("- `{}`".format(nm))
    if len(strip_names) > 30:
        audit_lines.append("- ... +{} more".format(len(strip_names) - 30))
    audit_md = "\n".join(audit_lines).encode('utf-8')

    IMAGE_EXTS = ('.jpg', '.jpeg', '.png', '.tif', '.tiff',
                  '.tga', '.bmp', '.exr', '.hdr', '.webp')

    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_STORED) as z:
        z.write(cleaned_blend, archive_blend_name)
        # Textures: ship everything in textures_dir that matches an
        # image the asset references. Match by image.name (the
        # in-blender name), not by .filepath basename — because
        # fixer-rewritten paths look like `//textures/foo.jpg` and
        # `os.path.basename` of those is empty.
        used_image_names = set()
        for img in bpy.data.images:
            if img.users > 0 and img.name in used_images:
                used_image_names.add(img.name)
        # Build a basename→on-disk-path lookup for the textures dir.
        tex_lookup = {}
        if textures_dir and os.path.isdir(textures_dir):
            for root, _dirs, files in os.walk(textures_dir):
                for fn in files:
                    if os.path.splitext(fn)[1].lower() not in IMAGE_EXTS:
                        continue
                    base_no_ext = os.path.splitext(fn)[0]
                    # The image name in the blend equals the file
                    # basename (no extension). We map both forms so
                    # either lookup path finds the file.
                    tex_lookup.setdefault(base_no_ext, os.path.join(root, fn))
                    tex_lookup.setdefault(fn, os.path.join(root, fn))
        used_basenames = set()
        for imgname in used_image_names:
            # The image name might match by stem or by full filename.
            for key, full in tex_lookup.items():
                if key == imgname or os.path.splitext(key)[0] == imgname:
                    used_basenames.add(os.path.basename(full))
        if textures_dir and used_basenames:
            for root, _dirs, files in os.walk(textures_dir):
                for fn in files:
                    if fn not in used_basenames:
                        continue
                    full = os.path.join(root, fn)
                    arc = 'textures/' + os.path.basename(full)
                    z.write(full, arc)
        z.writestr('_NexArt_blendasset.md', audit_md)

    try:
        os.remove(cleaned_blend)
    except Exception:
        pass

    return {
        "ok": True,
        "asset_id": asset_id,
        "collection": collection or None,
        "instance_count": instance_count,
        "objects_kept": n_keep,
        "objects_stripped": n_strip,
        "removed_count": n_removed,
        "materials_kept": len(used_mats),
        "textures_kept": len(used_basenames),
        "output": os.path.abspath(output_zip),
        "size_bytes": os.path.getsize(output_zip),
    }


def main():
    src = os.environ.get('BLEND_EXTRACTOR_INPUT', '')
    out = os.environ.get('BLEND_EXTRACTOR_OUTPUT', '')
    tex = os.environ.get('BLEND_EXTRACTOR_TEXDIR', '')
    asset = os.environ.get('BLEND_EXTRACTOR_ASSET', '')
    manifest = os.environ.get('BLEND_EXTRACTOR_MANIFEST', '')
    collection = os.environ.get('BLEND_EXTRACTOR_COLLECTION', '')

    if not src or not out or not manifest:
        _emit("EXTRACT_ERROR: need BLEND_EXTRACTOR_INPUT, OUTPUT, "
              "MANIFEST env vars")
        sys.exit(2)
    if not asset and not collection:
        _emit("EXTRACT_ERROR: need ASSET or COLLECTION")
        sys.exit(2)

    try:
        result = extract_asset(src, out, tex,
                               asset or '__collection__', manifest,
                               collection=collection)
    except Exception as e:
        import traceback
        sys.stderr.write(traceback.format_exc())
        _emit("EXTRACT_ERROR: {}".format(e))
        sys.exit(1)

    _emit("OK: asset={} kept={} stripped={} ({} bytes)".format(
        result["asset_id"], result["objects_kept"], result["objects_stripped"],
        result["size_bytes"]))
    sys.stderr.write("=== EXTRACTOR SUMMARY ===\n")
    sys.stderr.write(json.dumps(result) + "\n")
    sys.stderr.write("=== /EXTRACTOR SUMMARY ===\n")
    sys.stderr.flush()


if __name__ == '__main__':
    main()