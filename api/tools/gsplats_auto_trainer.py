# -*- coding: utf-8 -*-
"""
gsplats_auto_trainer.py — One-click 3D Gaussian Splatting pipeline for Houdini 22.

Headless ``hython.exe`` automation. Drives the full COLMAP-to-Houdini-ML-3DGS
chain end-to-end and produces a ready-to-cook ``.hip`` (with optional
background training kick-off).

Usage
-----
::

    hython.exe gsplats_auto_trainer.py <image_dir> <project_name> [options]

Pipeline stages
---------------
1. Build the Houdini-22-mandated dataset tree at
   ``$HIP/ml/<project>/dataset.gsplats/`` and copy source images into ``images/``.
2. Run COLMAP CLI (camera model forced to ``OPENCV``):
   ``feature_extractor -> exhaustive_matcher -> mapper -> model_converter``.
   Sparse BIN files land in ``sparse/0/``.
3. Construct ``/tasks/ml_train_gsplats`` TOP network and pre-fill:
   ``base_directory``, ``cache_images_to_vram=True``, ``max_batch_size=6``,
   ``export_testing_images=False``.
4. Construct ``/obj/geo`` SOP preview chain:
   ``file -> bakegsplats -> transform -> group(bbox) -> blast -> null(OUT_SPLAT)``.
5. Save ``<output_dir>/<project_name>.hip``.
6. If ``--cook-training`` is passed, fire ``TOP.executeGraph()`` and let the
   training proceed in the background of the live Houdini session.

Output contract
---------------
* ``stdout`` — one line of JSON summary at the end of the run.
* ``stderr`` — timestamped log records (stage transitions, COLMAP stdout,
  per-node construction, errors).
* exit code — ``0`` ok, ``1`` pipeline failure, ``2`` hython missing.

Configuration decoupling
------------------------
Module-level ``DEFAULT_*`` constants are the single source of truth. Every
default is overridable through:

* Environment variable (``COLMAP_EXE``, ``GSPLATS_DOWNSCALE``, ``GSPLATS_BATCH``,
  ``GSPLATS_BBOX``, ``GSPLATS_COOK_WAIT``).
* CLI flag (``--colmap-exe``, ``--downscale``, ``--max-batch-size``,
  ``--bbox-half-size``).
* ``GSplatsAutoTrainer`` constructor argument (preferred for embedding).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

# hython provides ``hou``; if we're not running under hython the script aborts
# with a clear error rather than producing a misleading stack trace.
try:
    import hou  # type: ignore
except ImportError:  # pragma: no cover - hython-only path
    sys.stderr.write("FATAL: this script requires hython (hou module not found).\n")
    sys.exit(2)


# ============================================================================
# Configuration (single source of truth — override via env / CLI / ctor)
# ============================================================================

#: Path to ``colmap.exe`` (Windows) or ``colmap`` (POSIX). Override with
#: ``--colmap-exe`` or the ``COLMAP_EXE`` environment variable.
DEFAULT_COLMAP_EXE: str = os.environ.get(
    "COLMAP_EXE",
    r"C:\Program Files\Colmap\COLMAP.bat",
)

#: COLMAP image downscale factor. ``1`` = full res, ``2`` = half, ``4`` = quarter.
DEFAULT_DOWNSCALE: int = int(os.environ.get("GSPLATS_DOWNSCALE", "1"))

#: ``ml_train_gsplats`` max batch size. ``cache_images_to_vram=True`` benefits
#: from a moderate batch (6 is a balanced default for a single 24GB GPU).
DEFAULT_MAX_BATCH_SIZE: int = int(os.environ.get("GSPLATS_BATCH", "6"))

#: Half-extent (in Houdini units) of the SOP preview ``group`` bounding box.
#: Full box is ``2 * DEFAULT_BBOX_HALF_SIZE`` per axis, centred on the origin.
DEFAULT_BBOX_HALF_SIZE: float = float(os.environ.get("GSPLATS_BBOX", "5.0"))

#: After triggering TOP cook, optionally block for up to this many seconds
#: so the cook can advance before the hython process exits. ``0`` = return
#: immediately (the cook continues in the live Houdini session if any).
DEFAULT_COOK_WAIT_S: float = float(os.environ.get("GSPLATS_COOK_WAIT", "0"))

#: Iteration whose output PLY the SOP ``file`` node should bind to by default
#: (Houdini ML 3DGS writes per-iteration ``point_cloud/iteration_<N>/point_cloud.ply``).
DEFAULT_ITERATION: int = int(os.environ.get("GSPLATS_ITERATION", "30000"))

#: Path to the canonical 3DGS output PLY relative to the dataset root.
DEFAULT_PLY_REL: str = f"point_cloud/iteration_{DEFAULT_ITERATION}/point_cloud.ply"

#: Subnet placeholder names used when the Houdini ML 3DGS HDA is not installed.
FALLBACK_TOP_NAME: str = "ml_train_gsplats_net"
FALLBACK_SOP_NAME: str = "bake_passthrough"

LOG = logging.getLogger("gsplats_trainer")


# ============================================================================
# Logging + subprocess helpers
# ============================================================================


def _setup_logging(verbose: bool = False) -> None:
    """Configure root logger for a clean, timestamped per-line stream on stderr."""
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="[%(asctime)s] [%(levelname)-7s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def _run_subprocess(cmd: List[str], cwd: str, label: str, timeout_s: int = 600) -> int:
    """Run ``cmd`` synchronously, stream stdout to LOG, raise on non-zero exit.

    Returns the (always-0) exit code for symmetry; on failure raises
    ``RuntimeError`` with the label and the COLMAP-supplied exit code so the
    outer ``try/except`` can decide whether to fall back.

    ``timeout_s`` (default 10 min) bounds the subprocess. We don't use
    ``subprocess.run(timeout=...)`` because we need to drain stdout as
    it arrives; instead we kill the process from a watchdog thread once
    the deadline expires.
    """
    LOG.info("RUN [%s]: %s", label, " ".join(cmd))
    import threading
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        shell=False,
        universal_newlines=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    timed_out = threading.Event()

    def _kill_on_timeout() -> None:
        if timed_out.wait(timeout_s):
            return
        LOG.warning("[%s] exceeded %ds, killing", label, timeout_s)
        try:
            proc.kill()
        except OSError:
            pass

    killer = threading.Thread(target=_kill_on_timeout, daemon=True)
    killer.start()
    try:
        for line in proc.stdout:
            LOG.info("    | %s", line.rstrip())
    finally:
        timed_out.set()
    rc = proc.wait()
    if rc != 0:
        raise RuntimeError(f"{label} failed (exit code {rc})")
    LOG.info("DONE [%s] (rc=0)", label)
    return rc


def _safe_copy_tree(src: str, dst: str) -> int:
    """Recursively copy ``src`` to ``dst`` (creating ``dst`` if missing).

    Returns the number of files copied. Raises ``FileNotFoundError`` if
    ``src`` does not exist and ``PermissionError`` (from the underlying
    ``shutil``) if the destination is not writable.

    Symlinks are intentionally skipped: a user-uploaded zip could
    contain a symlink pointing outside the staging directory, which
    would let the trained .hip leak data the user never uploaded (or
    follow a recursive loop and crash the cook). Skip them silently —
    they're not part of the camera images we need.
    """
    if not os.path.isdir(src):
        raise FileNotFoundError(f"Source directory not found: {src}")
    os.makedirs(dst, exist_ok=True)
    count = 0
    for name in os.listdir(src):
        s = os.path.join(src, name)
        d = os.path.join(dst, name)
        # Skip symlinks — both regular files that are links and dirs
        # that are links — to avoid escaping the staging dir.
        if os.path.islink(s):
            LOG.warning("COPY: skipping symlink %s", s)
            continue
        if os.path.isfile(s):
            shutil.copy2(s, d)
            count += 1
        elif os.path.isdir(s):
            count += _safe_copy_tree(s, d)
    LOG.info("COPY: %s -> %s (%d file(s))", src, dst, count)
    return count


def _extract_zip(zip_path: str, dst: str) -> int:
    """Extract ``zip_path`` into ``dst`` (creating ``dst`` if missing).

    Uses Python's stdlib ``zipfile`` so STORE / DEFLATE / BZIP2 / LZMA all
    work. Path-traversal entries (e.g. ``../../etc/passwd``) are rejected.
    Returns the number of files extracted.
    """
    if not os.path.isfile(zip_path):
        raise FileNotFoundError(f"Zip file not found: {zip_path}")
    os.makedirs(dst, exist_ok=True)
    dst_real = os.path.realpath(dst)
    count = 0
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            # Reject path-traversal entries (zip slip)
            target = os.path.realpath(os.path.join(dst, info.filename))
            if not target.startswith(dst_real + os.sep) and target != dst_real:
                raise RuntimeError(
                    f"Refusing to extract unsafe path from zip: {info.filename!r}"
                )
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with zf.open(info, "r") as src_f, open(target, "wb") as dst_f:
                shutil.copyfileobj(src_f, dst_f)
            count += 1
    LOG.info("EXTRACT: %s -> %s (%d file(s))", zip_path, dst, count)
    return count


def _set_parm_try(node, parm_names: List[str], value, kind: str = "any") -> bool:
    """Try each parm name in order; set the first one that exists.

    Returns ``True`` if a parm was set, ``False`` if none of the candidates
    exist (we log this so the user can add the missing parm to their HDA).
    """
    for pname in parm_names:
        p = node.parm(pname)
        if p is None:
            continue
        try:
            if kind == "bool" and isinstance(value, bool):
                p.set(int(value))
            else:
                p.set(value)
            LOG.debug("set %s.%s = %r", node.path(), pname, value)
            return True
        except hou.OperationFailed as exc:  # noqa: F821 - defined in hython
            LOG.warning("parm set failed %s.%s: %s", node.path(), pname, exc)
    LOG.warning(
        "no candidate parm on %s matched %s (HDA version mismatch?)",
        node.path(),
        parm_names,
    )
    return False


# ============================================================================
# Main pipeline class
# ============================================================================


class GSplatsAutoTrainer:
    """End-to-end driver: COLMAP -> Houdini 22 .hip -> optional TOP cook.

    Parameters
    ----------
    image_dir
        Absolute path to the source image folder. Mutually exclusive with
        ``images_zip``.
    images_zip
        Absolute path to a ``.zip`` file whose contents will be extracted
        into the dataset's ``images/`` subdir. Mutually exclusive with
        ``image_dir``. Used by the web tool to ship a folder of images.
    project_name
        Project name used for subdirectory layout and node names. Must be
        alphanumeric (underscore allowed) — the name ends up in file paths
        and Houdini node names.
    output_dir
        Root directory the Houdini scene treats as ``$HIP``. Defaults to
        a sibling folder of ``image_dir`` named ``<project_name>``.
    colmap_exe
        Override for :data:`DEFAULT_COLMAP_EXE`.
    downscale
        Override for :data:`DEFAULT_DOWNSCALE`.
    max_batch_size
        Override for :data:`DEFAULT_MAX_BATCH_SIZE`.
    bbox_half_size
        Override for :data:`DEFAULT_BBOX_HALF_SIZE`.
    cook_training
        If ``True``, fire ``TOP.executeGraph()`` after saving the .hip.
    cook_wait_s
        Override for :data:`DEFAULT_COOK_WAIT_S`.
    dry_run
        If ``True``, skip the COLMAP pipeline (no SfM) and the TOP cook.
        The .hip is still built end-to-end so users can verify the node
        graph and Houdini connectivity. Useful for dev / web smoke-tests
        on machines that don't have COLMAP installed.
    """

    def __init__(
        self,
        project_name: str,
        image_dir: Optional[str] = None,
        images_zip: Optional[str] = None,
        output_dir: Optional[str] = None,
        colmap_exe: Optional[str] = None,
        downscale: Optional[int] = None,
        max_batch_size: Optional[int] = None,
        bbox_half_size: Optional[float] = None,
        cook_training: bool = False,
        cook_wait_s: Optional[float] = None,
        dry_run: bool = False,
    ) -> None:
        if not project_name or not all(c.isalnum() or c == "_" for c in project_name):
            raise ValueError(
                f"Invalid project_name {project_name!r}: must be alphanumeric "
                "or underscore (used in file paths + node names)."
            )
        # Source — exactly one of image_dir / images_zip must be supplied.
        if bool(image_dir) == bool(images_zip):
            raise ValueError(
                "Provide exactly one of image_dir (directory) or "
                "images_zip (.zip file), not both."
            )
        if image_dir and not os.path.isdir(image_dir):
            raise FileNotFoundError(f"image_dir not found: {image_dir!r}")
        if images_zip and not os.path.isfile(images_zip):
            raise FileNotFoundError(f"images_zip not found: {images_zip!r}")

        self.image_dir: Optional[str] = os.path.abspath(image_dir) if image_dir else None
        self.images_zip: Optional[str] = os.path.abspath(images_zip) if images_zip else None
        self.project_name: str = project_name
        # When given a zip we don't know an "image parent dir" so the
        # default output root falls back to the current working directory.
        anchor = self.image_dir or os.path.dirname(self.images_zip) or os.getcwd()
        self.output_dir: str = os.path.abspath(
            output_dir if output_dir else os.path.join(anchor, project_name)
        )
        self.colmap_exe: str = colmap_exe or DEFAULT_COLMAP_EXE
        self.downscale: int = int(downscale if downscale is not None else DEFAULT_DOWNSCALE)
        self.max_batch_size: int = int(
            max_batch_size if max_batch_size is not None else DEFAULT_MAX_BATCH_SIZE
        )
        self.bbox_half_size: float = float(
            bbox_half_size if bbox_half_size is not None else DEFAULT_BBOX_HALF_SIZE
        )
        self.cook_training: bool = bool(cook_training)
        self.cook_wait_s: float = float(
            cook_wait_s if cook_wait_s is not None else DEFAULT_COOK_WAIT_S
        )
        self.dry_run: bool = bool(dry_run)

        # Derived paths — Houdini 22 dataset.gsplats layout (mandated by the
        # ML 3DGS HDA — the loader looks for ``<base>/images`` and ``<base>/sparse/0``).
        self.dataset_dir: str = os.path.join(
            self.output_dir, "ml", project_name, "dataset.gsplats"
        )
        self.images_dst: str = os.path.join(self.dataset_dir, "images")
        self.sparse_dst: str = os.path.join(self.dataset_dir, "sparse", "0")
        self.colmap_db: str = os.path.join(self.dataset_dir, "colmap.db")
        self.colmap_tmp: str = os.path.join(self.dataset_dir, "sparse_tmp")
        self.hip_path: str = os.path.join(self.output_dir, f"{project_name}.hip")
        self.expected_ply: str = os.path.join(self.dataset_dir, DEFAULT_PLY_REL)

    # ------------------------------------------------------------------
    # Stage 1: directory tree
    # ------------------------------------------------------------------
    def build_directory_tree(self) -> None:
        LOG.info("STAGE 1/6: build directory tree under %s", self.dataset_dir)
        try:
            for d in (
                self.output_dir,
                self.dataset_dir,
                self.images_dst,
                self.sparse_dst,
                self.colmap_tmp,
            ):
                os.makedirs(d, exist_ok=True)
        except PermissionError as exc:
            raise PermissionError(
                f"Cannot create dataset directory: {exc}. "
                "Check that the user has write access to the output root."
            )

    # ------------------------------------------------------------------
    # Stage 2: image copy / zip extract
    # ------------------------------------------------------------------
    def copy_images(self) -> int:
        if self.image_dir:
            LOG.info("STAGE 2/6: copy images %s -> %s", self.image_dir, self.images_dst)
            return _safe_copy_tree(self.image_dir, self.images_dst)
        assert self.images_zip is not None  # enforced in __init__
        LOG.info("STAGE 2/6: extract zip %s -> %s", self.images_zip, self.images_dst)
        return _extract_zip(self.images_zip, self.images_dst)

    # ------------------------------------------------------------------
    # Stage 3: COLMAP
    # ------------------------------------------------------------------
    def run_colmap(self) -> None:
        """Drive the 4-step COLMAP pipeline. ``OPENCV`` is forced for the
        camera model because Houdini ML 3DGS expects the OPENCV pinhole
        parameter layout (fx, fy, cx, cy + 5 distortion coeffs).

        In dry-run mode, the COLMAP subprocesses are skipped and a stub
        ``sparse/0/`` directory is created with a README explaining how to
        fill it in. The .hip is still built so users can verify the node
        graph end-to-end without SfM."""
        if self.dry_run:
            LOG.warning(
                "STAGE 3/6: DRY-RUN — skipping COLMAP. Writing stub sparse/0/."
            )
            os.makedirs(self.sparse_dst, exist_ok=True)
            stub_path = os.path.join(self.sparse_dst, "DRY_RUN_README.txt")
            with open(stub_path, "w", encoding="utf-8") as f:
                f.write(
                    "This sparse/0/ directory is a dry-run stub.\n"
                    "COLMAP was not executed. Re-run without --dry-run to\n"
                    "populate cameras.bin / images.bin / points3D.bin.\n"
                )
            return

        LOG.info(
            "STAGE 3/6: COLMAP pipeline (camera_model=OPENCV, downscale=%d, gpu=on)",
            self.downscale,
        )
        if not os.path.isfile(self.colmap_exe):
            raise FileNotFoundError(
                f"COLMAP executable not found: {self.colmap_exe}. "
                "Pass --colmap-exe or set the COLMAP_EXE env var."
            )
        if not os.listdir(self.images_dst):
            raise RuntimeError(f"No images found in {self.images_dst}; nothing to reconstruct.")

        # 3a. feature_extractor — force OPENCV camera model
        _run_subprocess(
            [
                self.colmap_exe, "feature_extractor",
                "--database_path", self.colmap_db,
                "--image_path", self.images_dst,
                "--ImageReader.camera_model", "OPENCV",
                "--ImageReader.single_camera", "1",
                "--SiftExtraction.use_gpu", "1",
            ],
            cwd=self.dataset_dir,
            label="colmap feature_extractor",
        )

        # 3b. exhaustive_matcher — pairwise matching across all images
        _run_subprocess(
            [
                self.colmap_exe, "exhaustive_matcher",
                "--database_path", self.colmap_db,
                "--SiftMatching.use_gpu", "1",
            ],
            cwd=self.dataset_dir,
            label="colmap exhaustive_matcher",
        )

        # 3c. mapper — incremental SfM, writes to sparse_tmp/0/
        _run_subprocess(
            [
                self.colmap_exe, "mapper",
                "--database_path", self.colmap_db,
                "--image_path", self.images_dst,
                "--output_path", self.colmap_tmp,
            ],
            cwd=self.dataset_dir,
            label="colmap mapper",
        )

        # 3d. model_converter — emit BIN-format cameras.bin / images.bin / points3D.bin
        _run_subprocess(
            [
                self.colmap_exe, "model_converter",
                "--input_path", os.path.join(self.colmap_tmp, "0"),
                "--output_path", self.sparse_dst,
                "--output_type", "BIN",
            ],
            cwd=self.dataset_dir,
            label="colmap model_converter",
        )

        # Sanity: the 3DGS HDA's COLMAP loader looks for these specific names.
        required = ("cameras.bin", "images.bin", "points3D.bin")
        missing = [
            name for name in required
            if not os.path.isfile(os.path.join(self.sparse_dst, name))
        ]
        if missing:
            raise RuntimeError(
                f"COLMAP output incomplete — missing {missing} in {self.sparse_dst}. "
                "Likely cause: not enough image overlap, or all images were rejected "
                "during feature extraction."
            )

    # ------------------------------------------------------------------
    # Stage 4: Houdini scene
    # ------------------------------------------------------------------
    def build_houdini_scene(self) -> dict:
        LOG.info("STAGE 4/6: build Houdini scene (TOP + SOP)")

        # Start from a clean in-memory .hip (hython opens blank by default, but
        # explicit clear() is idempotent and safe if the script is embedded).
        hou.hipFile.clear(suppress_save_prompt=True)

        # Force $HIP so TOP base_directory / SOP file parm defaults resolve
        # consistently when the .hip is re-opened on a different machine.
        hou.hscript(f'setenv HIP = "{self.output_dir}"')

        # Make sure /tasks and /obj exist (they are auto-created on first
        # .hip load, but explicit is safer for hython).
        if hou.node("/tasks") is None:
            hou.node("/").createNode("tasks", "tasks")
        if hou.node("/obj") is None:
            hou.node("/").createNode("obj", "obj")

        top = self._build_top_network()
        geo = self._build_sop_preview()
        return {"top": top.path(), "geo": geo.path()}

    def _build_top_network(self):
        """Create ``/tasks/ml_train_gsplats`` and pre-fill the required parms.

        If the ML 3DGS HDA is not installed in this Houdini build, falls back
        to a generic ``topnet`` and logs a warning — the .hip is still usable
        once the user installs the SideFX ML toolset.
        """
        tasks = hou.node("/tasks")
        target_name = "ml_train_gsplats"

        if hou.nodeType(hou.topNodeTypeCategory(), target_name) is not None:
            top = tasks.createNode(target_name, target_name)
        elif hou.nodeType(hou.topNodeTypeCategory(), "topnet") is not None:
            top = tasks.createNode("topnet", FALLBACK_TOP_NAME)
            LOG.warning(
                "HDA '%s' not installed; created generic topnet. "
                "Install the SideFX ML 3DGS toolset for full functionality.",
                target_name,
            )
        else:
            top = tasks.createNode("subnet", FALLBACK_TOP_NAME + "_raw")
            LOG.warning("No TOP HDA found; created raw subnet placeholder.")

        # base_directory — accept several spelling variants across toolset revs
        _set_parm_try(
            top,
            ["base_directory", "basedir", "dataset_directory", "dataset", "inputdir"],
            self.dataset_dir,
        )

        # cache_images_to_vram — boolean toggle (several parm name candidates)
        _set_parm_try(
            top,
            [
                "cache_images_to_vram",
                "cache_to_vram",
                "cacheimages",
                "vramcache",
            ],
            True,
            kind="bool",
        )

        # max_batch_size
        _set_parm_try(
            top,
            ["max_batch_size", "maxbatchsize", "batchsize", "batch_size"],
            self.max_batch_size,
        )

        # export_testing_images — disable any "Testing" tab image-dump toggle
        _set_parm_try(
            top,
            [
                "export_testing_images",
                "exporttestingimages",
                "exporttestimages",
                "save_test_images",
            ],
            False,
            kind="bool",
        )
        # Sweep remaining parms for any "testing"/"export"-themed toggles
        # and force them off — toolset revs occasionally rename these.
        for p in top.parms():
            pname = p.name().lower()
            if "testing" in pname and "export" in pname:
                try:
                    p.set(0)
                except Exception:  # noqa: BLE001
                    pass

        top.layoutChildren()
        LOG.info("TOP: created %s", top.path())
        return top

    def _build_sop_preview(self):
        """Create ``/obj/geo`` SOP preview chain per spec.

        file -> bakegsplats -> transform -> group(bbox) -> blast -> null(OUT_SPLAT)
        """
        obj = hou.node("/obj")
        geo = obj.createNode("geo", "geo")

        # --- file SOP -> expected .ply path
        if hou.nodeType(hou.sopNodeTypeCategory(), "file") is None:
            raise RuntimeError("SOP 'file' node type not found in this Houdini build.")
        file_sop = geo.createNode("file", "file_splats")
        file_sop.parm("file").set(self.expected_ply)

        # --- bakegsplats SOP (or null passthrough fallback)
        if hou.nodeType(hou.sopNodeTypeCategory(), "bakegsplats") is not None:
            bake = geo.createNode("bakegsplats", "bake_gsplats")
        else:
            LOG.warning(
                "SOP 'bakegsplats' not installed; using null passthrough. "
                "Install the SideFX ML 3DGS toolset for the real converter."
            )
            bake = geo.createNode("null", FALLBACK_SOP_NAME)
        bake.setInput(0, file_sop)

        # --- transform (identity by default — the user can rotate/scale later)
        xform = geo.createNode("xform", "transform")
        xform.setInput(0, bake)

        # --- group (Bounding Box mode) -> "inside_bbox"
        group = geo.createNode("group", "group_bbox")
        group.setInput(0, xform)
        # Name the group so the downstream blast can target it
        _set_parm_try(group, ["groupname", "name"], "inside_bbox")

        half = self.bbox_half_size
        # Several Houdini builds expose the bbox either as min/max or as
        # centre + size. Try both naming conventions.
        for names, values in (
            (["sizex", "bbmaxx"], half * 2),
            (["sizey", "bbmaxy"], half * 2),
            (["sizez", "bbmaxz"], half * 2),
        ):
            _set_parm_try(group, [names[0]], values)
        for names, values in (
            (["c", "bbcenterx"], 0.0),
            (["cy", "bbcentery"], 0.0),
            (["cz", "bbcenterz"], 0.0),
        ):
            _set_parm_try(group, [names[0]], values)
        # Some builds need an explicit toggle to use a custom bbox
        for toggle in ("boundbox", "usebbox", "enablebbox", "bboxenable", "boundboxenable"):
            p = group.parm(toggle)
            if p is not None:
                try:
                    p.set(1)
                except Exception:  # noqa: BLE001
                    pass
                break

        # --- blast -> remove points NOT in inside_bbox
        blast = geo.createNode("blast", "blast_outside_bbox")
        blast.setInput(0, group)
        _set_parm_try(blast, ["group", "groupname"], "inside_bbox")
        # grouptype: 0 = points in group, 1 = prims, 2 = edges, 3 = vertices
        # We want "points not in group" — that lives on the "negate" toggle.
        _set_parm_try(blast, ["negate", "invert", "removeoutside"], True, kind="bool")
        # Belt-and-braces: also try removing the geometry-by-group
        _set_parm_try(blast, ["grouptype"], 0)  # 0 = points

        # --- OUT_SPLAT null
        out_null = geo.createNode("null", "OUT_SPLAT")
        out_null.setInput(0, blast)

        for n in (file_sop, bake, xform, group, blast, out_null):
            try:
                n.moveToGoodPosition()
            except Exception:  # noqa: BLE001
                pass
        geo.layoutChildren()
        LOG.info("SOP: preview chain built in %s", geo.path())
        return geo

    # ------------------------------------------------------------------
    # Stage 5: save .hip
    # ------------------------------------------------------------------
    def save_hip(self) -> None:
        LOG.info("STAGE 5/6: save .hip -> %s", self.hip_path)
        os.makedirs(os.path.dirname(self.hip_path), exist_ok=True)
        # Houdini 22.0.368 hou.hipFile.save signature: (file_name, save_to_recent_files)
        # — NOT save_backup (that was added in later builds). Pass nothing extra.
        hou.hipFile.save(self.hip_path)

    # ------------------------------------------------------------------
    # Stage 6: optional TOP cook
    # ------------------------------------------------------------------
    def trigger_training(self) -> Optional[str]:
        """Fire ``TOP.executeGraph()`` for background training.

        Returns the path of the cooked node, or ``None`` if skipped.
        """
        if not self.cook_training:
            LOG.info("STAGE 6/6: skip cook (use --cook-training to enable)")
            return None
        LOG.info("STAGE 6/6: trigger TOP cook (background)")

        # Locate the TOP node — may be the real HDA or one of our fallbacks
        top = hou.node("/tasks/ml_train_gsplats")
        if top is None:
            for cand in (FALLBACK_TOP_NAME, FALLBACK_TOP_NAME + "_raw"):
                top = hou.node(f"/tasks/{cand}")
                if top is not None:
                    break
        if top is None:
            raise RuntimeError(
                "Cannot find TOP node to cook — /tasks/ml_train_gsplats is missing."
            )

        try:
            top.executeGraph()
        except hou.OperationFailed as exc:  # noqa: F821
            raise RuntimeError(f"TOP executeGraph() failed: {exc}") from exc

        LOG.info("TOP cook triggered: %s", top.path())

        # Best-effort: wait briefly so the cook can advance before the
        # hython process exits. The cook continues asynchronously if
        # GSPLATS_COOK_WAIT > 0 but the live Houdini session is gone.
        if self.cook_wait_s > 0.0:
            deadline = time.time() + self.cook_wait_s
            while time.time() < deadline and top.isCooking():
                time.sleep(1.0)
        return top.path()

    # ------------------------------------------------------------------
    # Audit + result marker helpers
    # ------------------------------------------------------------------
    def _write_audit_md(self, n_images: int, node_paths: dict, cooked_path: Optional[str]) -> str:
        """Write a Markdown audit log next to the .hip and return its path.

        The web route picks this up via ``summary.audit_md`` and bundles it
        into the response zip. Mirrors the convention from
        ``hip_path_doctor.py`` so the front-end can render it uniformly.
        """
        try:
            hip_dir = os.path.dirname(os.path.abspath(self.hip_path))
            hip_stem = os.path.splitext(os.path.basename(self.hip_path))[0]
            md_path = os.path.join(hip_dir, hip_stem + "_NexArt_gsplatstrainer.md")
            colmap_status = "DRY-RUN (stub sparse/0/)" if self.dry_run else "executed"
            cook_status = cooked_path if cooked_path else "skipped (use --cook-training)"
            lines = [
                "# 3DGS Auto Trainer — audit log",
                "",
                f"- **Time:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                f"- **Project:** `{self.project_name}`",
                f"- **Output dir (=$HIP):** `{self.output_dir}`",
                f"- **Dataset dir:** `{self.dataset_dir}`",
                f"- **Houdini .hip:** `{self.hip_path}`",
                f"- **Images copied:** {n_images}",
                f"- **COLMAP:** {colmap_status}",
                f"- **TOP parms:** base_directory=`{self.dataset_dir}` · "
                f"max_batch_size={self.max_batch_size} · cache_images_to_vram=true · "
                f"export_testing_images=false",
                f"- **SOP bbox half-size:** {self.bbox_half_size}",
                f"- **TOP cook:** {cook_status}",
                "",
                "## Node graph",
                "",
                "```",
                f"TOP  : {node_paths.get('top', '?')}",
                f"SOP  : {node_paths.get('geo', '?')}",
                "        file  ->  bakegsplats  ->  transform  ->  group(bbox)  ->  blast  ->  null(OUT_SPLAT)",
                "```",
                "",
                "## Expected .ply (post-training)",
                "",
                f"`{self.expected_ply}`",
                "",
            ]
            with open(md_path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
            LOG.info("AUDIT: wrote %s", md_path)
            return md_path
        except Exception as exc:  # noqa: BLE001
            LOG.warning("failed to write audit md: %s", exc)
            return ""

    def _emit_result_markers(self, summary: dict) -> None:
        """Emit the `=== GSPLATS TRAINER RESULT ===` marker block on stderr.

        The server route regex-strips this from the noisy Houdini stderr
        (which contains opalias / oplib warnings) and surfaces it as
        ``X-Gsplats-Trainer-Result`` to the front-end.
        """
        lines = [
            "=== GSPLATS TRAINER RESULT ===",
            f"Project            : {summary['project']}",
            f"Output ($HIP)      : {summary['output_dir']}",
            f"Dataset            : {summary['dataset_dir']}",
            f"Houdini .hip       : {summary['hip_path']}",
            f"Images copied      : {summary['images_count']}",
            f"COLMAP             : {'dry-run' if self.dry_run else 'executed'}",
            f"TOP cook triggered : {summary.get('cooked_top') or 'no'}",
            f"Top node           : {summary.get('node_paths', {}).get('top', '?')}",
            f"SOP node           : {summary.get('node_paths', {}).get('geo', '?')}",
            f"Started            : {summary['started']}",
            f"Finished           : {summary['finished']}",
            "=== /GSPLATS TRAINER RESULT ===",
        ]
        sys.stderr.write("\n".join(lines) + "\n")

    # ------------------------------------------------------------------
    # Orchestrator
    # ------------------------------------------------------------------
    def run(self) -> dict:
        """Run the full pipeline. Returns a JSON-serializable summary."""
        started = datetime.now().isoformat(timespec="seconds")
        LOG.info("=== GSplatsAutoTrainer START (project=%s) ===", self.project_name)
        try:
            self.build_directory_tree()
            n_images = self.copy_images()
            self.run_colmap()
            node_paths = self.build_houdini_scene()
            self.save_hip()
            cooked_path = self.trigger_training()
        except Exception as exc:
            LOG.exception("PIPELINE FAILED: %s", exc)
            raise
        summary = {
            "ok": True,
            "project": self.project_name,
            "output_dir": self.output_dir,
            "hip_path": self.hip_path,
            "dataset_dir": self.dataset_dir,
            "images_dst": self.images_dst,
            "sparse_dst": self.sparse_dst,
            "colmap_db": self.colmap_db,
            "expected_ply": self.expected_ply,
            "images_count": n_images,
            "node_paths": node_paths,
            "cooked_top": cooked_path,
            "dry_run": self.dry_run,
            "audit_md": "",  # filled in below
            "started": started,
            "finished": datetime.now().isoformat(timespec="seconds"),
        }
        summary["audit_md"] = self._write_audit_md(n_images, node_paths, cooked_path)
        self._emit_result_markers(summary)
        LOG.info("=== GSplatsAutoTrainer DONE ===")
        return summary


# ============================================================================
# CLI entry point
# ============================================================================


def _build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="gsplats_auto_trainer",
        description=(
            "One-click 3DGS pipeline: COLMAP -> Houdini 22 .hip -> optional TOP cook. "
            "Runs under hython.exe."
        ),
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "image_dir",
        nargs="?",
        default=None,
        help="Source images folder (absolute path). Mutually exclusive with --images-zip.",
    )
    src.add_argument(
        "--images-zip",
        default=None,
        help="Path to a .zip of images (alternative to the positional image_dir).",
    )
    ap.add_argument(
        "project_name",
        help="Project name (alphanumeric / underscore; used for paths + node names).",
    )
    ap.add_argument(
        "--output-dir",
        default=None,
        help="Output root treated as $HIP (default: <image_dir>/../<project_name>).",
    )
    ap.add_argument(
        "--colmap-exe",
        default=None,
        help=f"Path to colmap executable (default: {DEFAULT_COLMAP_EXE!r}).",
    )
    ap.add_argument(
        "--downscale",
        type=int,
        default=DEFAULT_DOWNSCALE,
        help="COLMAP downscale factor (1=full, 2=half, 4=quarter).",
    )
    ap.add_argument(
        "--max-batch-size",
        type=int,
        default=DEFAULT_MAX_BATCH_SIZE,
        help="ml_train_gsplats max batch size.",
    )
    ap.add_argument(
        "--bbox-half-size",
        type=float,
        default=DEFAULT_BBOX_HALF_SIZE,
        help="SOP group bounding-box half-extent (Houdini units).",
    )
    ap.add_argument(
        "--cook-training",
        action="store_true",
        help="After saving, call TOP executeGraph() to kick off training.",
    )
    ap.add_argument(
        "--cook-wait",
        type=float,
        default=DEFAULT_COOK_WAIT_S,
        help="Seconds to wait after triggering TOP cook (0 = return immediately).",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip COLMAP and TOP cook. Build the .hip skeleton only — useful "
             "for dev / smoke tests on machines without COLMAP installed.",
    )
    ap.add_argument(
        "--input-name",
        default="",
        help="Display name of the input (shown in audit log; no effect on processing).",
    )
    ap.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Debug-level logging.",
    )
    return ap


def main(argv: Optional[List[str]] = None) -> int:
    args = _build_arg_parser().parse_args(argv)
    _setup_logging(args.verbose)

    trainer = GSplatsAutoTrainer(
        image_dir=args.image_dir,
        images_zip=args.images_zip,
        project_name=args.project_name,
        output_dir=args.output_dir,
        colmap_exe=args.colmap_exe,
        downscale=args.downscale,
        max_batch_size=args.max_batch_size,
        bbox_half_size=args.bbox_half_size,
        cook_training=args.cook_training,
        cook_wait_s=args.cook_wait,
        dry_run=args.dry_run,
    )
    try:
        summary = trainer.run()
    except Exception as exc:
        sys.stderr.write(f"FAIL: {exc}\n")
        sys.exit(1)
    # Final JSON to stdout — single line for easy parsing by the API route
    # (the server pops the last line of stdout and JSON-parses it).
    sys.stdout.write(json.dumps(summary, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
