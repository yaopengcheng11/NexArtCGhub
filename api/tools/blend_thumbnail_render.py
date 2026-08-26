# blend_thumbnail_render.py — render thumbnail PNGs of a .blend
#
# Style contract (2026-08-24, per user reference photo): golden-hour
# African savanna wildlife photography. For scenes WITHOUT a camera we
# stage a full environment:
#   - matte sand ground plane with noise-tonal variation, catching a
#     real sun shadow
#   - warm amber sun key + cool sky fill + warm sand bounce
#   - defocused olive-green world above the horizon (blurred bush)
#   - long-lens shallow depth of field (f/2.8 @ 85mm look)
# Scenes WITH their own camera(s) render faithfully from those cameras.
#
# One PNG per camera:  <out_dir>/camera_<CameraName>.png
# No camera at all:    <out_dir>/default.png  (auto-staged shot)
#
# CLI / env contract:
#   BLEND_THUMBNAIL_INPUT     source .blend
#   BLEND_THUMBNAIL_OUTPUT    primary output PNG path
#   BLEND_THUMBNAIL_SIZE      long-edge pixel size (default 512)

import json
import math
import os
import sys

import bpy  # type: ignore
import bmesh  # type: ignore
import mathutils  # type: ignore


def _emit(s: str) -> None:
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def _aim(obj, target):
    """Rotate a light/camera object to look at a world-space point."""
    direction = target - obj.location
    if direction.length > 1e-6:
        obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def _stage_environment(scene, bb_min, bb_max, center, diag):
    """Golden-hour savanna staging: sand floor, sun, sky fill, bounce,
    green world. Only called for scenes with no camera of their own."""
    # ---- Sand ground plane ----
    if not any(o.name == 'ThumbGround' for o in bpy.data.objects):
        ground_mesh = bpy.data.meshes.new('ThumbGround')
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
        bm.to_mesh(ground_mesh)
        bm.free()
        ground_obj = bpy.data.objects.new('ThumbGround', ground_mesh)
        scene.collection.objects.link(ground_obj)
        ground_obj.location = (center.x, center.y, bb_min.z - diag * 0.002)
        # ~3 diag wide: contact shadow lands on it; the far edge exits
        # the frame so the green world shows above the horizon.
        ground_obj.scale = (diag * 1.5, diag * 1.5, 1.0)
        ground_mat = bpy.data.materials.new('ThumbGroundMat')
        ground_mat.use_nodes = True
        g_nt = ground_mat.node_tree
        g_bsdf = None
        for n in g_nt.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                g_bsdf = n
                break
        if g_bsdf is not None:
            # Kalahari sand base + large-scale noise → tonal variation,
            # so the plane doesn't read as a flat CG stage floor.
            noise = g_nt.nodes.new('ShaderNodeTexNoise')
            noise.inputs['Scale'].default_value = 0.8
            noise.inputs['Detail'].default_value = 6.0
            ramp = g_nt.nodes.new('ShaderNodeValToRGB')
            ramp.color_ramp.elements[0].color = (0.55, 0.42, 0.27, 1.0)
            ramp.color_ramp.elements[1].color = (0.82, 0.70, 0.52, 1.0)
            g_nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
            g_nt.links.new(ramp.outputs['Color'], g_bsdf.inputs['Base Color'])
            g_bsdf.inputs['Roughness'].default_value = 1.0
        ground_obj.data.materials.append(ground_mat)

    # ---- Lights ----
    has_light = any(o.type == 'LIGHT' for o in scene.objects)
    if not has_light:
        sun_data = bpy.data.lights.new('ThumbSun', 'SUN')
        sun_data.energy = 5.0
        sun_data.angle = math.radians(2.0)
        sun_data.color = (1.0, 0.78, 0.52)       # golden hour amber
        sun_obj = bpy.data.objects.new('ThumbSun', sun_data)
        scene.collection.objects.link(sun_obj)
        sun_travel = mathutils.Vector((0.55, -0.35, -0.76)).normalized()
        sun_obj.rotation_euler = sun_travel.to_track_quat('-Z', 'Y').to_euler()

        fill_data = bpy.data.lights.new('ThumbSkyFill', 'AREA')
        fill_data.energy = diag * diag * 30.0
        fill_data.size = diag * 3.0
        fill_data.color = (0.80, 0.88, 1.0)
        fill_obj = bpy.data.objects.new('ThumbSkyFill', fill_data)
        scene.collection.objects.link(fill_obj)
        fill_obj.location = center + mathutils.Vector((
            diag * 0.3, -diag * 0.4, diag * 2.4))
        _aim(fill_obj, center)

        bounce_data = bpy.data.lights.new('ThumbBounce', 'AREA')
        bounce_data.energy = diag * diag * 18.0
        bounce_data.size = diag * 2.5
        bounce_data.color = (1.0, 0.85, 0.65)
        bounce_obj = bpy.data.objects.new('ThumbBounce', bounce_data)
        scene.collection.objects.link(bounce_obj)
        bounce_obj.location = center + mathutils.Vector((
            0.0, diag * 0.8, bb_min.z + diag * 0.05))
        _aim(bounce_obj, center)

    # ---- World: saturated olive-green (defocused bush). A brand-new
    # World has use_nodes=False and EEVEE ignores plain .color, so force
    # a node tree with an explicit Background node. Grey/black/white
    # artist worlds are replaced; genuinely colorful ones are kept. ----
    world = scene.world
    auto_staged_world = False
    if world is None:
        world = bpy.data.worlds.new('ThumbWorld')
        scene.world = world
        auto_staged_world = True
    try:
        if not world.use_nodes:
            world.use_nodes = True
            auto_staged_world = True
        nt = world.node_tree
        bg = None
        for n in nt.nodes:
            if n.type == 'BACKGROUND':
                bg = n
                break
        if bg is None:
            bg = nt.nodes.new('ShaderNodeBackground')
            out = None
            for n in nt.nodes:
                if n.type == 'OUTPUT_WORLD':
                    out = n
                    break
            if out is None:
                out = nt.nodes.new('ShaderNodeOutputWorld')
            nt.links.new(bg.outputs[0], out.inputs[0])
        cur_c = list(bg.inputs[0].default_value)[:3]
        lum = 0.2126 * cur_c[0] + 0.7152 * cur_c[1] + 0.0722 * cur_c[2]
        mx, mn = max(cur_c), min(cur_c)
        is_colorful = (mx - mn) > 0.15 and lum > 0.05
        if auto_staged_world or not is_colorful:
            # Saturated olive-green: reads as defocused sunlit bush.
            # (A gradient sky was tried via Geometry.Incoming but EEVEE
            # evaluates world incoming differently than expected; flat
            # olive is the reliable look.)
            bg.inputs[0].default_value = (0.11, 0.16, 0.05, 1.0)
        bg.inputs[1].default_value = 1.0
    except Exception:
        pass


def render_thumbnails(source_blend: str, output_png: str,
                      size: int = 512) -> dict:
    if not os.path.isfile(source_blend):
        raise FileNotFoundError(source_blend)

    bpy.ops.wm.open_mainfile(filepath=source_blend, load_ui=False)
    scene = bpy.context.scene

    # ---- Resolution / format ----
    # Keep the file's own resolution & aspect ratio — the artist chose
    # them (16:9 renders must not come out square). `size` is only a
    # LONG-EDGE cap: scale down proportionally if the file renders
    # larger than requested. The staged (no-camera) shot sets its own
    # square resolution later.
    orig_x = int(scene.render.resolution_x) or size
    orig_y = int(scene.render.resolution_y) or size
    long_edge = max(orig_x, orig_y)
    if long_edge > size:
        ratio = size / float(long_edge)
        scene.render.resolution_x = max(4, int(orig_x * ratio))
        scene.render.resolution_y = max(4, int(orig_y * ratio))
    scene.render.resolution_percentage = 100
    try:
        if getattr(scene.render.image_settings, 'media_type', None) == 'VIDEO':
            scene.render.image_settings.media_type = 'IMAGE'
    except Exception:
        pass
    try:
        scene.render.image_settings.file_format = 'PNG'
    except Exception:
        pass

    # ---- Engine: keep the file's engine; only fall back if invalid ----
    # The upstream caller may have already read the engine from the binary
    # header and pinned it via BLEND_THUMBNAIL_ENGINE — that wins over the
    # file's own setting to avoid the (occasional) case where the file's
    # persisted engine is "BLENDER_RENDER" (a 2.7x placeholder) even though
    # the scene was authored for Cycles or EEVEE.  Caller has the truth.
    available = set(bpy.types.RenderSettings.bl_rna.properties[
        'engine'].enum_items.keys())
    forced = os.environ.get('BLEND_THUMBNAIL_ENGINE', '').strip().upper()
    if forced and forced in available:
        scene.render.engine = forced
    else:
        try:
            cur = scene.render.engine
        except Exception:
            cur = None
        if not cur or cur not in available:
            for fallback in ('BLENDER_EEVEE', 'BLENDER_WORKBENCH'):
                if fallback in available:
                    scene.render.engine = fallback
                    break

    # EEVEE quality: only RAISE settings the author left low (sample
    # count for a clean still). Never disable effects they turned on —
    # raytracing/GTAO/bloom are part of their look.
    try:
        e = scene.eevee
        if getattr(e, 'taa_render_samples', 0) < 32:
            e.taa_render_samples = 32
    except Exception:
        pass

    # View transform / look / exposure: KEEP AS AUTHORED. Standard vs
    # AgX is a huge visual difference and it's the artist's call. Only
    # set a sane default when the file somehow has none.
    try:
        vt_valid = scene.view_settings.view_transform in \
            scene.view_settings.bl_rna.properties['view_transform'].enum_items.keys()
        if not vt_valid:
            scene.view_settings.view_transform = 'Standard'
    except Exception:
        pass

    # ---- Cameras ----
    cam_objs = [o for o in scene.objects if o.type == 'CAMERA']
    staged = False
    bb_min = mathutils.Vector((1e9, 1e9, 1e9))
    bb_max = mathutils.Vector((-1e9, -1e9, -1e9))
    any_mesh = False
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        any_mesh = True
        for corner in o.bound_box:
            wc = o.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                bb_min[i] = min(bb_min[i], wc[i])
                bb_max[i] = max(bb_max[i], wc[i])
    if not any_mesh:
        raise ValueError('No mesh objects found in source')
    center = (bb_min + bb_max) / 2
    diag = max((bb_max - bb_min).length, 1e-6)

    if not cam_objs:
        # Auto-stage: wildlife-photo camera + environment.
        staged = True
        # Staged shot is square (card-friendly); artist cameras keep
        # the file's own aspect ratio set above.
        scene.render.resolution_x = size
        scene.render.resolution_y = size
        cam_data = bpy.data.cameras.new('ThumbCam')
        cam_data.lens = 85
        cam_data.sensor_width = 36
        cam_data.clip_start = max(0.01, diag * 0.001)
        cam_data.clip_end = diag * 100
        cam_obj = bpy.data.objects.new('ThumbCam', cam_data)
        scene.collection.objects.link(cam_obj)

        distance = diag * 2.2
        azimuth = math.radians(215)
        elevation = math.radians(16)
        aim_point = center - mathutils.Vector((0, 0, diag * 0.06))
        offset = mathutils.Vector((
            distance * math.cos(elevation) * math.sin(azimuth),
            distance * math.cos(elevation) * math.cos(azimuth),
            distance * math.sin(elevation) + diag * 0.22,
        ))
        cam_obj.location = center + offset
        direction = aim_point - cam_obj.location
        if direction.length > 1e-6:
            cam_obj.rotation_euler = direction.to_track_quat(
                '-Z', 'Y').to_euler()
        try:
            cam_data.dof.use_dof = True
            cam_data.dof.focus_distance = distance
            cam_data.dof.aperture_fstop = 2.8
        except Exception:
            pass

        _stage_environment(scene, bb_min, bb_max, center, diag)
        shots = [('default', cam_obj)]
    else:
        # Artist's cameras: render each one faithfully. Only widen clip
        # planes that would clip the subject.
        shots = []
        for c in cam_objs:
            try:
                if c.data.clip_end < diag * 5:
                    c.data.clip_end = diag * 20
            except Exception:
                pass
            safe_name = ''.join(
                ch if ch.isalnum() or ch in '-_' else '_'
                for ch in c.name).strip('_') or 'cam'
            shots.append((safe_name, c))

    # ---- Frame choice ----
    try:
        fs = int(scene.frame_start)
        fe = int(scene.frame_end)
        has_anim = any(o.animation_data and o.animation_data.action
                       for o in scene.objects)
        frame = fs + (fe - fs) // 2 if (fe > fs and has_anim) else fs
        scene.frame_set(frame)
    except Exception:
        frame = None

    # ---- Render every shot ----
    out_dir = os.path.dirname(os.path.abspath(output_png)) or '.'
    os.makedirs(out_dir, exist_ok=True)
    rendered = []
    for name, cam in shots:
        scene.camera = cam
        scene.render.filepath = output_png if name == 'default' \
            else os.path.join(out_dir, 'camera_{}.png'.format(name))
        bpy.ops.render.render(write_still=True)
        p = scene.render.filepath
        if os.path.isfile(p):
            rendered.append(p)

    primary = rendered[0] if rendered else None
    # Guarantee the requested output path exists (server serves it).
    if primary and os.path.abspath(primary) != os.path.abspath(output_png):
        try:
            import shutil
            shutil.copyfile(primary, output_png)
        except Exception:
            pass

    return {
        'ok': bool(rendered),
        'output': os.path.abspath(output_png),
        'size_bytes': os.path.getsize(output_png)
        if os.path.isfile(output_png) else 0,
        'engine': scene.render.engine,
        'frame': frame,
        'staged': staged,
        'shots': rendered,
    }


def main():
    src = os.environ.get('BLEND_THUMBNAIL_INPUT', '')
    out = os.environ.get('BLEND_THUMBNAIL_OUTPUT', '')
    size = int(os.environ.get('BLEND_THUMBNAIL_SIZE', '512'))

    if not src or not out:
        _emit('THUMB_ERROR: need BLEND_THUMBNAIL_INPUT and '
              'BLEND_THUMBNAIL_OUTPUT env vars')
        sys.exit(2)

    try:
        result = render_thumbnails(src, out, size)
    except Exception as e:
        import traceback
        sys.stderr.write(traceback.format_exc())
        _emit('THUMB_ERROR: {}'.format(e))
        sys.exit(1)

    _emit('OK: rendered {} ({} bytes, staged={})'.format(
        result['output'], result['size_bytes'], result['staged']))
    sys.stderr.write('=== THUMB SUMMARY ===\n')
    sys.stderr.write(json.dumps(result) + '\n')
    sys.stderr.write('=== /THUMB SUMMARY ===\n')
    sys.stderr.flush()


if __name__ == '__main__':
    main()
