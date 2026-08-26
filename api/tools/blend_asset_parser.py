# blend_asset_parser.py — CLI entry point for "Blender Asset Manifest" extraction
#
# Run by blender.exe in headless mode (-b -P). Reads an input .blend
# and emits a JSON manifest describing every "asset" the user can
# download separately.
#
# What counts as an asset:
#   1. A "body" mesh (top-level mesh with no children, or any mesh
#      that has actual geometry — vertex count > some threshold).
#      Controllers (tiny meshes parented to bones) and helpers
#      (empties/lights/cameras) are SKIPPED.
#   2. Each asset also gets its own materials + referenced textures.
#
# Why "auto by body-mesh" rather than "by collection":
#   CGTrader-style rig files typically pack everything into one
#   collection (rhino = 1 collection, 47 objects: body mesh +
#   armature + 30 controllers + helpers). Users don't want to
#   download controllers individually — they want to grab the
#   body, the eyes, the horn, etc. So we decompose the single
#   collection into its body meshes and surface each one.
#
# CLI / env contract:
#   BLEND_ASSET_PARSER_INPUT    input .blend path
#   BLEND_ASSET_PARSER_OUTPUT   output manifest.json path
#
# Output (manifest.json):
#   {
#     "blend": {"path", "size_bytes", "blender_version"},
#     "scene":  {"name", "object_count", ...},
#     "assets": [
#       {
#         "id": "AfricanRhinoceros_Body",
#         "name": "AfricanRhinoceros_Body",
#         "type": "MESH",
#         "parent_collection": "JF0L506A3_AfricanRhinoceros_Rig",
#         "vert_count": 16271,
#         "tri_count": 32486,
#         "materials": ["AfricanRhinoceros_Body", "AfricanRhinoceros_Hair", ...],
#         "textures": ["JF0L506A3_AfricanRhinoceros_Body_BaseColor.jpg", ...],
#         "has_armature": true,
#         "thumbnail_path": null,   // filled by async render job
#       },
#       ...
#     ],
#     "actions": [...],          // whole-scene actions
#     "textures": [...],         // every texture in the file
#     "warnings": [...]
#   }

import json
import os
import sys
from collections import OrderedDict

import bpy  # type: ignore


# Tunable threshold: a mesh with fewer than this many vertices is
# considered a controller/custom-shape and skipped from the asset
# list. CGTrader rigs put IK controllers, FK controllers, bone
# custom shapes, etc. all under 50 verts.
MIN_BODY_VERT_COUNT = 100


def _emit(s: str) -> None:
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def _ok_summary(d: dict) -> None:
    sys.stderr.write("=== PARSER SUMMARY ===\n")
    sys.stderr.write(json.dumps(d) + "\n")
    sys.stderr.write("=== /PARSER SUMMARY ===\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# Asset classification — every top-level MESH becomes one asset unless
# it's a "controller" (tiny mesh bound to a bone). We also include
# ARMATURE objects as standalone assets — some users want the rig
# without geometry (e.g. to attach their own mesh).
# ---------------------------------------------------------------------------
def _is_controller(obj) -> bool:
    """Controllers are tiny meshes parented to armature bones."""
    if obj.type != 'MESH':
        return False
    if obj.parent and obj.parent.type == 'ARMATURE':
        if obj.data and len(obj.data.vertices) < MIN_BODY_VERT_COUNT:
            return True
    # CGTrader naming convention: Ctr_*, IK_*, FK_* controllers
    name = obj.name
    if any(name.startswith(p) for p in ('Ctr_', 'IK_', 'FK_', 'Pole_', 'Helper_')):
        return True
    return False


def _is_helper(obj) -> bool:
    return obj.type in ('EMPTY', 'CAMERA', 'LIGHT')


# ---------------------------------------------------------------------------
# Asset extraction
# ---------------------------------------------------------------------------
def parse_blend(blend_path: str) -> dict:
    if not os.path.isfile(blend_path):
        raise FileNotFoundError(blend_path)

    bpy.ops.wm.open_mainfile(filepath=blend_path, load_ui=False)
    for img in list(bpy.data.images):
        if img.type == 'RENDER_RESULT':
            bpy.data.images.remove(img)

    warnings = []
    scene = bpy.context.scene
    blender_ver = ".".join(str(x) for x in bpy.app.version)
    blend_size = os.path.getsize(blend_path)

    # ---- Render settings (added 2026-08-24 for the "Spec" section) ----
    r = scene.render
    # Blender 5.1 removed RenderSettings.resolution; fall back to the
    # individual resolution_x / resolution_y fields if so.
    rd_x = getattr(r, 'resolution_x', None)
    rd_y = getattr(r, 'resolution_y', None)
    if rd_x is None:  # older wrapper
        try:
            rd = r.resolution
            rd_x, rd_y = int(rd.x), int(rd.y)
        except AttributeError:
            rd_x, rd_y = 1920, 1080
    rd_x, rd_y = int(rd_x or 1920), int(rd_y or 1080)
    try:
        pix = r.pixel_aspect_x / max(r.pixel_aspect_y, 1e-9)
    except AttributeError:
        pix = 1.0
    # Compute a friendly aspect ratio (16:9, 4:3, 1:1, 21:9, etc.)
    from math import gcd
    w = rd_x or 1
    h = rd_y or 1
    g = gcd(w, h)
    ar_w, ar_h = w // g, h // g
    aspect_ratio = f"{ar_w}:{ar_h}"

    # ---- Light setup snapshot (counts by type) ----
    light_types = {"SUN": 0, "POINT": 0, "SPOT": 0, "AREA": 0, "HEMI": 0}
    has_world_hdri = False
    try:
        for ob in bpy.data.objects:
            if ob.type == 'LIGHT':
                t = ob.data.type  # 'POINT' / 'SUN' / 'SPOT' / 'AREA' / 'HEMI'
                light_types[t] = light_types.get(t, 0) + 1
        # World background — heuristic: if it has any node-tree with a
        # TEX_ENVIRONMENT, the scene was set up with an HDRI.
        wn = scene.world.node_tree if scene.world and scene.world.use_nodes else None
        if wn:
            for n in wn.nodes:
                if n.type == 'TEX_ENVIRONMENT':
                    has_world_hdri = True
                    break
    except Exception as _e:
        pass  # never fail manifest extraction because of a light-probe error

    light_setup = {
        "sun": light_types.get("SUN", 0),
        "point": light_types.get("POINT", 0),
        "spot": light_types.get("SPOT", 0),
        "area": light_types.get("AREA", 0),
        "hemi": light_types.get("HEMI", 0),
        "hdri_world": has_world_hdri,
    }

    scene_meta = {
        "name": scene.name,
        "object_count": len(bpy.data.objects),
        "mesh_count": len([o for o in bpy.data.objects if o.type == 'MESH']),
        "armature_count": len([o for o in bpy.data.objects if o.type == 'ARMATURE']),
        "material_count": len(bpy.data.materials),
        "image_count": len(bpy.data.images),
        "action_count": len(bpy.data.actions),
        # Technical spec fields (used by the Resource Detail "Spec" section)
        "blender_version": blender_ver,
        "frame_start": int(getattr(r, 'frame_start', 1)),
        "frame_end": int(getattr(r, 'frame_end', 250)),
        "fps": int(getattr(r, 'fps', 24)),
        "fps_base": float(getattr(r, 'fps_base', 1.0)),
        "resolution_x": int(rd_x),
        "resolution_y": int(rd_y),
        "pixel_aspect": round(pix, 4),
        "aspect_ratio": aspect_ratio,
        "render_engine": str(r.engine),       # 'CYCLES' / 'BLENDER_EEVEE_NEXT' / etc.
        "color_mode": str(r.image_settings.color_mode),  # 'RGB' / 'BW'
        "light_setup": light_setup,
    }

    # ---- One asset per unique MESH DATA BLOCK ----
    # Scene packs often place hundreds of copies of the same bush /
    # cloud / tree. Two grouping levels:
    #   1. Objects sharing one mesh DATA BLOCK (linked duplicates) are
    #      always merged.
    #   2. Data blocks that were duplicated with full copy (Blender's
    #      `.NNN` suffix, unique data per object) are additionally
    #      grouped by their BASE name + vertex count, because artists
    #      rarely mean "bush_1.011 through bush_1.153" as 140 separate
    #      downloadable products.
    # Skip controllers (tiny meshes on bones) and helpers.
    import re
    SUFFIX_RE = re.compile(r'^(.*)\.(\d{3})$')

    def group_key(obj):
        dname = obj.data.name
        m = SUFFIX_RE.match(dname)
        if m:
            base, _num = m.group(1), m.group(2)
            # Group by base name + vert count (vert count guards against
            # merging genuinely different variants that happen to share
            # a stem).
            return (base, len(obj.data.vertices))
        return (dname, len(obj.data.vertices))

    assets = []
    groups = {}           # key -> asset dict (being built)
    group_order = []      # keep first-seen order
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        if _is_controller(obj):
            continue
        if obj.data is None:
            continue
        vcount = len(obj.data.vertices)
        if vcount < MIN_BODY_VERT_COUNT:
            continue

        gk = group_key(obj)
        if gk in groups:
            groups[gk]["instance_count"] += 1
            continue
        groups[gk] = {"obj": obj, "instance_count": 1}
        group_order.append(gk)

    for gk in group_order:
        entry = groups[gk]
        obj = entry["obj"]
        icount = entry["instance_count"]
        raw_name = obj.data.name  # first-seen data-block name as the id

        # Derive a human-friendly display name. Data-block names like
        # `Mesh.013` are meaningless to users; the material names
        # usually carry the semantic label (canopy / tree / Cloud /
        # backpack ...). Prefer: single material name > base stem of
        # the data name > raw name.
        mat_names = [s.material.name for s in obj.material_slots if s.material]
        stem = SUFFIX_RE.match(raw_name)
        base_stem = stem.group(1) if stem else raw_name

        def pretty(s):
            return s.replace('_', ' ').strip().title()

        if len(mat_names) == 1:
            display_name = pretty(mat_names[0])
        elif base_stem and not base_stem.lower().startswith('mesh') \
                and not base_stem.lower().startswith('plane') \
                and not base_stem.lower().startswith('cube') \
                and not base_stem.lower().startswith('cylinder'):
            display_name = pretty(base_stem)
        elif mat_names:
            display_name = pretty(mat_names[0])
        else:
            display_name = raw_name

        # Find the first parent collection (top-level-ish)
        parent_collections = [c.name for c in obj.users_collection
                              if c.name not in ('Scene Collection',)]
        parent_coll = parent_collections[0] if parent_collections else None

        # Materials on this object
        materials = []
        for slot in obj.material_slots:
            if slot.material is not None:
                materials.append(slot.material.name)

        # Textures referenced by these materials (we'll do a more
        # thorough texture list at the scene level below)
        textures_for_asset = []
        for matname in materials:
            mat = bpy.data.materials.get(matname)
            if not mat or not mat.node_tree:
                continue
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    textures_for_asset.append(node.image.name)

        tcount = sum(len(p.vertices) - 2 for p in obj.data.polygons)

        # Check if this mesh is rigged (has an armature modifier)
        has_armature = any(m.type == 'ARMATURE' for m in obj.modifiers)

        assets.append({
            "id": raw_name,
            "name": display_name,
            "type": obj.type,
            "parent_collection": parent_coll,
            "instance_count": icount,
            "vert_count": vcount,
            "tri_count": tcount,
            "material_count": len(materials),
            "materials": materials,
            "texture_count": len(set(textures_for_asset)),
            "textures": sorted(set(textures_for_asset)),
            "has_armature": has_armature,
            "thumbnail_path": None,
        })

    # ---- De-duplicate display names ----
    # Multiple groups can derive the same label (e.g. four tree
    # variants all mapped to "Canopy"). Append 2/3/4... so every card
    # is uniquely identifiable while keeping the readable stem.
    seen_display = {}
    for a in assets:
        n = a["name"]
        if n in seen_display:
            seen_display[n] += 1
            a["name"] = "{} {}".format(n, seen_display[n])
        else:
            seen_display[n] = 1

    # ---- Whole-scene actions (Run / Walk / etc.) — these are useful
    # but belong to the whole rig, not to any single asset. Surface
    # them at scene level for context. ----
    actions = []
    for act in bpy.data.actions:
        try:
            fr = act.frame_range
            start = int(fr[0]); end = int(fr[1])
            fps = bpy.context.scene.render.fps or 24
            dur = round((end - start + 1) / fps, 3)
        except Exception:
            start = end = 0; dur = 0.0
        rig = None
        if '|' in act.name:
            rig = act.name.split('|', 1)[0]
        actions.append({
            "name": act.name,
            "rig": rig,
            "frame_start": start,
            "frame_end": end,
            "duration_seconds": dur,
        })

    # ---- All textures in the scene ----
    textures = []
    seen = OrderedDict()
    blend_dir = bpy.path.abspath('//')
    for img in bpy.data.images:
        if img.filepath:
            abs_path = bpy.path.abspath(img.filepath)
        else:
            abs_path = ''
        # Try the input textures_dir resolution just like the fixer does.
        candidates = []
        if abs_path:
            candidates.append(abs_path)
            base = os.path.basename(img.filepath or '')
            if base:
                candidates.append(os.path.join(blend_dir, 'textures', base))
                candidates.append(os.path.join(blend_dir, base))
        if img.packed_file is not None:
            seen.setdefault('packed:' + img.name, {
                "name": img.name, "path": None,
                "size_bytes": len(img.packed_file.data),
                "source": "packed",
                "channels": img.channels,
                "resolution": list(img.size) if img.size else None,
            })
            continue
        resolved = next((p for p in candidates if p and os.path.isfile(p)), None)
        if resolved:
            seen.setdefault(resolved, {
                "name": img.name, "path": resolved,
                "size_bytes": os.path.getsize(resolved),
                "source": "external",
                "channels": img.channels,
                "resolution": list(img.size) if img.size else None,
            })
        else:
            seen.setdefault('missing:' + img.name, {
                "name": img.name, "path": img.filepath or None,
                "size_bytes": 0, "source": "missing",
                "channels": img.channels,
                "resolution": list(img.size) if img.size else None,
            })
    textures = list(seen.values())

    if any(t["source"] == "missing" for t in textures):
        miss = [t["name"] for t in textures if t["source"] == "missing"]
        warnings.append("Missing texture files ({}): {}".format(len(miss), miss[:5]))

    return {
        "blend": {
            "path": os.path.abspath(blend_path),
            "size_bytes": blend_size,
            "blender_version": blender_ver,
        },
        "scene": scene_meta,
        "assets": assets,
        "actions": actions,
        "textures": textures,
        "warnings": warnings,
    }


def main():
    blend_path = os.environ.get('BLEND_ASSET_PARSER_INPUT', '')
    output_path = os.environ.get('BLEND_ASSET_PARSER_OUTPUT', '')

    if not blend_path or not output_path:
        _emit("PARSE_ERROR: need BLEND_ASSET_PARSER_INPUT and "
              "BLEND_ASSET_PARSER_OUTPUT env vars")
        sys.exit(2)

    try:
        manifest = parse_blend(blend_path)
    except Exception as e:
        _emit("PARSE_ERROR: {}".format(e))
        sys.exit(1)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or '.', exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    _emit("OK: {} assets, {} actions, {} textures ({} packed, {} missing)".format(
        len(manifest["assets"]),
        len(manifest["actions"]),
        len(manifest["textures"]),
        sum(1 for t in manifest["textures"] if t["source"] == "packed"),
        sum(1 for t in manifest["textures"] if t["source"] == "missing"),
    ))
    for a in manifest["assets"][:10]:
        _emit("  asset: {} ({} vert, {} tri, {} mat, {} tex, rig={})".format(
            a["name"], a["vert_count"], a["tri_count"],
            a["material_count"], a["texture_count"], a["has_armature"]))
    if manifest["actions"]:
        for a in manifest["actions"][:5]:
            _emit("  action: {} ({}..{}, {}s)".format(
                a["name"], a["frame_start"], a["frame_end"], a["duration_seconds"]))
    for w in manifest["warnings"]:
        _emit("  warn: {}".format(w))

    _ok_summary({
        "ok": True,
        "output": os.path.abspath(output_path),
        "asset_count": len(manifest["assets"]),
        "action_count": len(manifest["actions"]),
        "texture_count": len(manifest["textures"]),
        "warning_count": len(manifest["warnings"]),
    })


if __name__ == '__main__':
    main()