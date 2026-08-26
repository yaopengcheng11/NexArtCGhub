"""
HIP Format Bridge — convert a non-Houdini 3D file into a fresh .hip.

Pipeline:
  1. FreeCADCmd.exe loads the source file (auto-detects: STEP, IGES, SAT, STL,
     OBJ, PLY, 3MF, DAE, 3DS, OFF, etc.) and exports an intermediate OBJ
     (the universal Houdini-readable format).
  2. hython loads the intermediate OBJ, embeds it as a /obj/imported_geometry
     geo node with a File SOP, then saves the .hip.

Usage:
  hython.exe hip_format_bridge.py <input.X> <output.hip> --source-ext <ext> \
      [--input-name <displayName>]

Wrapper:
  hip_format_bridge_run.py  (selects FreeCAD vs hython automatically)

We support:
  3DS, 3MF, DAE, PLY, STL, OFF  (mesh formats Houdini can't read)
  STEP, IGES, SAT, BREP         (CAD formats Houdini can't read)
  DXF                           (2D CAD — FreeCAD flattens to mesh)
  OBJ                           (re-import with verified topology)

The script writes a small audit MD next to the output .hip (same convention
as hip_path_doctor.py), and emits a JSON summary on stdout + a wrapped result
block on stderr for the API route to extract.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import tempfile

# ---------------------------------------------------------------------------
# Supported source formats
# ---------------------------------------------------------------------------

# Maps user-facing ext → (FreeCAD import kind, FreeCAD open supported)
# "mesh" = open via FreeCAD's Mesh module; "cad" = open via Part module
SUPPORTED_EXTS = {
    # mesh (Houdini can't read these)
    '3ds':   ('mesh', '3D Studio'),
    '3mf':   ('mesh', '3D Manufacturing Format'),
    'dae':   ('mesh', 'Collada'),
    'ply':   ('mesh', 'Stanford PLY'),
    'stl':   ('mesh', 'STL'),
    'off':   ('mesh', 'Object File Format'),
    # cad (Houdini can't read these)
    'step':  ('cad',  'STEP (AP214)'),
    'stp':   ('cad',  'STEP'),
    'iges':  ('cad',  'IGES'),
    'igs':   ('cad',  'IGES'),
    'sat':   ('cad',  'ACIS SAT'),
    'sab':   ('cad',  'ACIS SAB'),
    'brep':  ('cad',  'OpenCascade BREP'),
    # 2D (Houdini can't read these)
    'dxf':   ('cad',  'AutoCAD DXF'),
}

# ---------------------------------------------------------------------------
# Config (env-overridable)
# ---------------------------------------------------------------------------

FREECAD_CMD = os.environ.get(
    'FREECAD_CMD',
    r'C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe',
)
HYTHON_PATH = os.environ.get(
    'HYTHON_PATH',
    r'C:\Program Files\Side Effects Software\Houdini 22.0.368\bin\hython.exe',
)
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Step 1: FreeCAD → intermediate OBJ
# ---------------------------------------------------------------------------

def _make_freecad_script(input_path: str, output_obj: str, source_ext: str) -> str:
    """Build an inline FreeCAD Python script that opens the input and writes OBJ.

    We use the FreeCAD auto-detecting `open()` first (works for STEP/IGES/SAT/BREP/STL/OBJ),
    then fall back to Mesh.Mesh() for formats the document-opener doesn't recognize
    (3DS / 3MF / DAE / PLY / OFF).
    """
    # The script is generated as a self-contained .py file that FreeCADCmd.exe
    # runs with `-c`. We avoid touching sys.argv because FreeCADCmd strips it.
    src = r'''
import os, sys, traceback
try:
    import FreeCAD
except Exception as _e:
    sys.stderr.write("FATAL: cannot import FreeCAD: %s\n" % _e)
    sys.exit(11)

INPUT = r''' + repr(input_path) + r'''
OUTPUT_OBJ = r''' + repr(output_obj) + r'''
SOURCE_EXT = r''' + repr(source_ext) + r'''

mesh_exts = {"3ds", "3mf", "dae", "ply", "off", "stl", "obj"}
cad_exts  = {"step", "stp", "iges", "igs", "sat", "sab", "brep", "dxf"}

ok = False
err = ""
try:
    if SOURCE_EXT in mesh_exts:
        # Mesh path: read into a Mesh.Mesh, wrap in a Mesh::Feature object
        # in a new document, then export via Mesh.export() (which requires
        # Mesh::Feature objects, NOT raw Mesh.Mesh instances).
        import Mesh
        # Make sure OUTPUT_OBJ's directory exists
        os.makedirs(os.path.dirname(OUTPUT_OBJ), exist_ok=True)

        if SOURCE_EXT == "dae":
            # DAE (Collada) is best handled via ImportGui which creates
            # proper DocumentObjects.
            import ImportGui
            doc = FreeCAD.newDocument("bridge")
            ImportGui.open(INPUT)
            src_objs = list(FreeCAD.ActiveDocument.Objects)
            if not src_objs:
                raise RuntimeError("DAE import produced no objects")
            # Tessellate each shape and aggregate into one mesh
            import Part
            aggregated = Mesh.Mesh()
            for o in src_objs:
                if hasattr(o, "Shape") and o.Shape and not o.Shape.isNull():
                    for face in o.Shape.Faces:
                        try:
                            aggregated.addMesh(face.tessellate(0.5))
                        except Exception:
                            pass
                elif hasattr(o, "Mesh") and o.Mesh:
                    aggregated.addMesh(o.Mesh)
            if aggregated.CountPoints == 0:
                raise RuntimeError("DAE tessellation produced 0 points")
            feat = FreeCAD.ActiveDocument.addObject("Mesh::Feature", "Aggregated")
            feat.Mesh = aggregated
            FreeCAD.ActiveDocument.recompute()
            Mesh.export([feat], OUTPUT_OBJ)
        else:
            # STL / OBJ / PLY / OFF / 3MF / 3DS
            mesh = Mesh.Mesh(INPUT)
            if mesh.CountPoints == 0:
                raise RuntimeError("Mesh.Mesh read produced 0 points")
            doc = FreeCAD.newDocument("bridge")
            feat = doc.addObject("Mesh::Feature", "Imported")
            feat.Mesh = mesh
            doc.recompute()
            Mesh.export([feat], OUTPUT_OBJ)
        ok = True
    else:
        # CAD path: open as document, then export OBJ via ImportGui.
        # FreeCAD.open() auto-detects STEP/IGES/SAT/BREP/STL/OBJ/DXF.
        try:
            doc = FreeCAD.open(INPUT)
        except Exception as _open_e:
            # Fallback: read as Part.Shape directly (for files FreeCAD.open refuses)
            import Part
            shape = Part.Shape()
            shape.read(INPUT)
            if shape.isNull():
                raise RuntimeError("Part.Shape.read produced null shape")
            # Tessellate the shape with a reasonable tolerance
            import MeshPart
            mesh = MeshPart.meshFromShape(shape, LinearDeflection=0.1, AngularDeflection=0.5, Relative=False)
            if mesh.CountPoints == 0:
                # Try with bigger tolerance
                mesh = MeshPart.meshFromShape(shape, LinearDeflection=1.0, AngularDeflection=1.0, Relative=False)
            if mesh.CountPoints == 0:
                raise RuntimeError("Shape tessellation produced 0 points")
            Mesh.export([mesh], OUTPUT_OBJ)
            ok = True
        else:
            objs = list(doc.Objects)
            if not objs:
                raise RuntimeError("Document opened with 0 objects")
            import ImportGui
            # OBJ is a Houdini-friendly universal mesh format
            ImportGui.export(objs, OUTPUT_OBJ)
            ok = True
except Exception as _e:
    err = "%s\n%s" % (_e, traceback.format_exc())

if ok:
    if os.path.isfile(OUTPUT_OBJ) and os.path.getsize(OUTPUT_OBJ) > 100:
        sys.stderr.write("FREECAD_OK: %s (%d bytes)\n" % (OUTPUT_OBJ, os.path.getsize(OUTPUT_OBJ)))
    else:
        sys.stderr.write("FATAL: OBJ file not written or too small\n")
        sys.exit(12)
else:
    sys.stderr.write("FATAL: %s\n" % err)
    sys.exit(13)
'''
    return src


def _run_freecad(input_path: str, output_obj: str, source_ext: str, timeout: int = 600) -> None:
    """Invoke FreeCADCmd to convert the source file to OBJ. Raises on failure."""
    if not os.path.isfile(FREECAD_CMD):
        raise RuntimeError(
            'FreeCADCmd.exe not found at {}. Set FREECAD_CMD env var.'.format(FREECAD_CMD)
        )

    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.py', delete=False, encoding='utf-8'
    ) as tmpf:
        tmpf.write(_make_freecad_script(input_path, output_obj, source_ext))
        script_path = tmpf.name

    try:
        proc = subprocess.run(
            [FREECAD_CMD, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        if proc.returncode != 0:
            tail = (proc.stderr or b'').decode('utf-8', errors='replace')[-1500:]
            raise RuntimeError(
                'FreeCAD failed (exit {}): {}'.format(proc.returncode, tail)
            )
        if not os.path.isfile(output_obj):
            tail = (proc.stderr or b'').decode('utf-8', errors='replace')[-1500:]
            raise RuntimeError(
                'FreeCAD reported success but OBJ was not written. stderr tail: ' + tail
            )
        if os.path.getsize(output_obj) < 100:
            raise RuntimeError(
                'FreeCAD produced a suspiciously small OBJ ({} bytes).'.format(
                    os.path.getsize(output_obj)
                )
            )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Step 2: hython → embed OBJ in a fresh .hip
# ---------------------------------------------------------------------------

def _make_hython_script(input_obj: str, output_hip: str) -> str:
    """Build an inline hython Python script that wraps the OBJ inside a fresh .hip."""
    src = r'''
import os, sys, traceback
try:
    import hou
except Exception as _e:
    sys.stderr.write("FATAL: cannot import hou: %s\n" % _e)
    sys.exit(21)

INPUT_OBJ = r''' + repr(input_obj) + r'''
OUTPUT_HIP = r''' + repr(output_hip) + r'''

try:
    hou.hipFile.clear(suppress_save_prompt=True)
    obj = hou.node('/obj')
    if obj is None:
        sys.stderr.write("FATAL: /obj not found\n")
        sys.exit(22)

    # Create a clean container at /obj/imported_geometry
    geo = obj.createNode('geo', 'imported_geometry')
    if geo is None:
        sys.stderr.write("FATAL: cannot create /obj/imported_geometry\n")
        sys.exit(23)

    # Inside the geo, add a File SOP that loads the OBJ
    file_sop = geo.createNode('file', 'imported_obj')
    file_sop.parm('file').set(INPUT_OBJ)

    # Connect a Null SOP and mark it as the display/render node so the
    # imported geometry shows up in the viewport immediately on open.
    null_sop = geo.createNode('null', 'DISPLAY')
    null_sop.setInput(0, file_sop)
    null_sop.setDisplayFlag(True)
    null_sop.setRenderFlag(True)

    # Lay out children for a clean appearance
    geo.layoutChildren()

    # Save
    out_dir = os.path.dirname(os.path.abspath(OUTPUT_HIP))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir)
    hou.hipFile.save(OUTPUT_HIP)

    # Confirm
    if not os.path.isfile(OUTPUT_HIP) or os.path.getsize(OUTPUT_HIP) < 100:
        sys.stderr.write("FATAL: .hip was not written or too small\n")
        sys.exit(24)

    points = 0
    prims = 0
    try:
        sop_geo = file_sop.geometry()
        if sop_geo is not None:
            points = len(sop_geo.points())
            prims = len(sop_geo.prims())
    except Exception:
        pass

    sys.stderr.write("HYTHON_OK: points=%d prims=%d hip=%d bytes\n" % (
        points, prims, os.path.getsize(OUTPUT_HIP)
    ))
    sys.stdout.write("IMPORTED_POINTS=%d\n" % points)
    sys.stdout.write("IMPORTED_PRIMS=%d\n" % prims)
except Exception as _e:
    sys.stderr.write("FATAL: %s\n%s\n" % (_e, traceback.format_exc()))
    sys.exit(25)
'''
    return src


def _run_hython(input_obj: str, output_hip: str, timeout: int = 300) -> dict:
    """Invoke hython to package the OBJ inside a .hip. Returns parsed stats."""
    if not os.path.isfile(HYTHON_PATH):
        raise RuntimeError(
            'hython.exe not found at {}. Set HYTHON_PATH env var.'.format(HYTHON_PATH)
        )

    with tempfile.NamedTemporaryFile(
        mode='w', suffix='.py', delete=False, encoding='utf-8'
    ) as tmpf:
        tmpf.write(_make_hython_script(input_obj, output_hip))
        script_path = tmpf.name

    try:
        proc = subprocess.run(
            [HYTHON_PATH, script_path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
        )
        stdout = (proc.stdout or b'').decode('utf-8', errors='replace')
        stderr = (proc.stderr or b'').decode('utf-8', errors='replace')
        if proc.returncode != 0:
            raise RuntimeError(
                'hython failed (exit {}): {}'.format(proc.returncode, stderr[-1500:])
            )
        if not os.path.isfile(output_hip):
            raise RuntimeError(
                'hython reported success but .hip was not written. stderr: ' + stderr[-1500:]
            )
        # Parse stdout stats
        stats = {'points': 0, 'prims': 0}
        for line in stdout.splitlines():
            m = re.match(r'IMPORTED_POINTS=(\d+)', line.strip())
            if m:
                stats['points'] = int(m.group(1))
            m = re.match(r'IMPORTED_PRIMS=(\d+)', line.strip())
            if m:
                stats['prims'] = int(m.group(1))
        return {'stats': stats, 'stderr': stderr}
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Audit MD + summary JSON (mirror hip_path_doctor conventions)
# ---------------------------------------------------------------------------

def _write_audit_md(
    output_hip: str,
    input_name: str,
    source_ext: str,
    intermediate_obj: str,
    stats: dict,
    result_text: str,
) -> str:
    """Write the audit MD next to the .hip, return the path."""
    hip_abs = os.path.abspath(output_hip)
    hip_dir = os.path.dirname(hip_abs)
    hip_stem = os.path.splitext(os.path.basename(hip_abs))[0]
    md_path = os.path.join(hip_dir, hip_stem + '_NexArt_hipformatbridge.md')

    fmt_name = SUPPORTED_EXTS.get(source_ext, (None, source_ext.upper()))[1] or source_ext.upper()
    header_lines = [
        '# HIP Format Bridge — audit log',
        '',
        '- **Time:** {}'.format(datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')),
        '- **Input file:** `{}`'.format(input_name),
        '- **Source format:** {} (.{})'.format(fmt_name, source_ext),
        '- **Output hip:** `{}`'.format(os.path.basename(output_hip)),
        '- **Intermediate OBJ:** `{}`'.format(os.path.basename(intermediate_obj)),
        '- **Imported points:** {}'.format(stats.get('points', 0)),
        '- **Imported primitives:** {}'.format(stats.get('prims', 0)),
        '- **FreeCAD:** `{}`'.format(FREECAD_CMD),
        '- **Houdini:** `{}`'.format(HYTHON_PATH),
        '',
        '## Result',
        '',
        '```',
        result_text,
        '```',
        '',
    ]
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(header_lines))
    return md_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description='HIP Format Bridge — import any 3D file into a fresh .hip')
    ap.add_argument('input_path', help='Path to source 3D file (any supported format)')
    ap.add_argument('output_hip', help='Path to output .hip file')
    ap.add_argument('--source-ext', required=True, help='Source file extension (without dot)')
    ap.add_argument('--input-name', default='', help='Display name of input (else use on-disk basename)')
    args = ap.parse_args()

    source_ext = args.source_ext.lower().lstrip('.')
    if source_ext not in SUPPORTED_EXTS:
        sys.stderr.write(
            'ERROR: unsupported source format ".{}". Supported: {}\n'.format(
                source_ext, ', '.join(sorted(SUPPORTED_EXTS.keys()))
            )
        )
        return 2

    if not os.path.isfile(args.input_path):
        sys.stderr.write('ERROR: input file not found: {}\n'.format(args.input_path))
        return 3

    input_name = args.input_name or os.path.basename(args.input_path)
    input_dir = os.path.dirname(os.path.abspath(args.input_path))
    output_hip = os.path.abspath(args.output_hip)
    output_dir = os.path.dirname(output_hip)
    if output_dir and not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    # Stage the intermediate OBJ next to the output hip so the cleanup logic
    # in server.ts (rmDirSafe) is the only thing that has to delete it.
    intermediate_obj = os.path.join(
        output_dir,
        '__intermediate_' + os.path.splitext(os.path.basename(input_name))[0] + '.obj',
    )

    # ----- Step 1: FreeCAD → OBJ -----
    sys.stderr.write('STEP 1: FreeCAD converting {} to OBJ...\n'.format(input_name))
    try:
        _run_freecad(args.input_path, intermediate_obj, source_ext)
    except Exception as e:
        sys.stderr.write('ERROR: FreeCAD conversion failed: {}\n'.format(e))
        return 10
    sys.stderr.write('STEP 1 OK: {} bytes\n'.format(os.path.getsize(intermediate_obj)))

    # ----- Step 2: hython → embed OBJ in .hip -----
    sys.stderr.write('STEP 2: hython packaging OBJ into .hip...\n')
    try:
        hy_result = _run_hython(intermediate_obj, output_hip)
        stats = hy_result['stats']
    except Exception as e:
        sys.stderr.write('ERROR: hython failed: {}\n'.format(e))
        # Best-effort cleanup of intermediate OBJ
        try:
            os.unlink(intermediate_obj)
        except OSError:
            pass
        return 20
    sys.stderr.write('STEP 2 OK: {} bytes ({} pts / {} prims)\n'.format(
        os.path.getsize(output_hip), stats['points'], stats['prims']
    ))

    # ----- Build result text -----
    fmt_name = SUPPORTED_EXTS[source_ext][1]
    result_lines = [
        'HIP Format Bridge: {} → .hip'.format(fmt_name),
        'Imported: {} points, {} primitives'.format(stats['points'], stats['prims']),
        'Container: /obj/imported_geometry (File SOP → Null)',
        'Output: {} ({} bytes)'.format(os.path.basename(output_hip), os.path.getsize(output_hip)),
    ]
    result_text = '\n'.join(result_lines)

    # ----- Write audit MD -----
    try:
        md_path = _write_audit_md(output_hip, input_name, source_ext, intermediate_obj, stats, result_text)
        sys.stderr.write('WROTE_AUDIT: {}\n'.format(md_path))
    except Exception as e:
        sys.stderr.write('WARN: failed to write audit md: {}\n'.format(e))
        md_path = ''

    # ----- Cleanup intermediate OBJ (keep audit MD next to .hip) -----
    try:
        os.unlink(intermediate_obj)
    except OSError:
        pass

    # ----- Emit summary JSON on stdout + marker-wrapped result on stderr -----
    summary = {
        'ok': True,
        'source_ext': source_ext,
        'source_name': fmt_name,
        'points': stats['points'],
        'prims': stats['prims'],
        'output_hip': output_hip,
        'output_size': os.path.getsize(output_hip),
        'audit_md': md_path if md_path and os.path.isfile(md_path) else None,
    }
    sys.stdout.write(json.dumps(summary) + '\n')
    sys.stderr.write('=== HIP FORMAT BRIDGE RESULT ===\n')
    sys.stderr.write(result_text + '\n')
    sys.stderr.write('=== /HIP FORMAT BRIDGE RESULT ===\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
