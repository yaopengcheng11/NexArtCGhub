"""
blend_reader — extract metadata from a .blend file WITHOUT Blender.

We use this in `manage.py set-renderer --auto` (and as a building
block for future offline tools) so that resource tagging doesn't
require a Blender install.

Two file layouts are supported:
  1. Modern (Blender 2.0+): zstd-compressed HDF5
  2. Old (pre-2.0): native BLENDER1 binary, possibly zstd-wrapped

For the old format, we scan for the render engine name stored as a
32-byte null-padded ASCII string. The DNA block contains the names
without null padding, so we require >= 8 trailing nulls to filter
those out. The engine name in the data section is always uppercase.
"""
from __future__ import annotations

import io
import re
import sys
import zstandard
from pathlib import Path

# Canonical engine identifiers used by Blender 2.0+ (uppercase).
KNOWN_ENGINES = [
    "CYCLES", "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE",
    "BLENDER_WORKBENCH", "BLENDER_RENDER", "BLENDER_GAME",
    "EEVEE", "WORKBENCH",
]

# Match the engine name as a 32-byte null-padded string in the data
# section. DNA section has un-padded null-terminated names, so
# requiring >= 8 trailing nulls filters those out. The longer
# engines are tried FIRST so we don't match a prefix.
PATTERN = re.compile(
    rb"(?:"
    + rb"|".join(re.escape(e.encode("ascii")) for e in sorted(KNOWN_ENGINES, key=len, reverse=True))
    + rb")\x00{8,32}",
    # CASE-SENSITIVE: lowercase "cycles" matches are common in
    # idprops / paths and would give false positives. The engine
    # name in the .blend data section is always uppercase.
)


def _decompress_zstd_stream(path: Path) -> bytes:
    """Streaming zstd decompress; safer than one-shot for 60+ MB outputs."""
    with open(path, "rb") as f:
        dctx = zstandard.ZstdDecompressor()
        chunks: list[bytes] = []
        with dctx.stream_reader(f) as reader:
            while True:
                chunk = reader.read(8 * 1024 * 1024)
                if not chunk:
                    break
                chunks.append(chunk)
                if sum(len(c) for c in chunks) > 1 << 30:
                    break
    return b"".join(chunks)


def _read_hdf5_engine(raw: bytes) -> str | None:
    """Open raw HDF5 bytes, read engine from RenderData."""
    try:
        import h5py
        with h5py.File(io.BytesIO(raw), "r") as h:
            for grp_path in ("/RenderData", "/Scene"):
                if grp_path in h and "engine" in h[grp_path].attrs:
                    v = h[grp_path].attrs["engine"]
                    if isinstance(v, bytes):
                        v = v.decode("ascii", errors="replace").rstrip("\x00").strip()
                    if v and v.upper() in {e for e in KNOWN_ENGINES}:
                        return v
            for k in h.keys():
                obj = h[k]
                if hasattr(obj, "attrs") and "engine" in obj.attrs:
                    v = obj.attrs["engine"]
                    if isinstance(v, bytes):
                        v = v.decode("ascii", errors="replace").rstrip("\x00").strip()
                    if v and v.upper() in {e for e in KNOWN_ENGINES}:
                        return v
    except Exception as e:
        print(f"  h5py: {e}", file=sys.stderr)
    return None


def _read_old_engine(data: bytes) -> str | None:
    """Scan BLENDER1 file for 32-byte null-padded engine name."""
    m = PATTERN.search(data)
    if m:
        s = m.group(0).rstrip(b"\x00").decode("ascii", errors="replace").strip()
        if s.upper() in {e for e in KNOWN_ENGINES}:
            return s
    return None


def read_engine(path: Path) -> str | None:
    """Returns the engine id (e.g. 'BLENDER_EEVEE') or None on failure."""
    with open(path, "rb") as f:
        sig = f.read(8)

    # Old format (pre-2.0): BLENDER1, may be raw or zstd-wrapped
    if sig.startswith(b"BLENDER1"):
        return _read_old_engine(path.read_bytes())

    # Modern format: zstd-compressed HDF5
    if sig[:4] == b"\x28\xb5\x2f\xfd":
        try:
            raw = _decompress_zstd_stream(path)
        except Exception as e:
            print(f"  zstd: {e}", file=sys.stderr)
            return None
        # After zstd decompress, content may be raw HDF5 OR the old
        # BLENDER1 format (Blender 4+ can save zstd-wrapped BLENDER1).
        if raw.startswith(b"BLENDER1"):
            return _read_old_engine(raw)
        return _read_hdf5_engine(raw)

    # Gzip-compressed HDF5
    if sig[:2] == b"\x1f\x8b":
        import gzip
        try:
            return _read_hdf5_engine(gzip.decompress(path.read_bytes()))
        except Exception:
            return None

    # Raw HDF5
    if sig == b"\x89HDF\r\n\x1a\n":
        return _read_hdf5_engine(path.read_bytes())

    return None


# Normalize legacy short names to the canonical form the parser uses.
CANONICAL_FROM_LEGACY = {
    "EEVEE": "BLENDER_EEVEE",
    "WORKBENCH": "BLENDER_WORKBENCH",
}


def read_engine_canonical(path: Path) -> str | None:
    """Like read_engine, but normalizes "EEVEE" → "BLENDER_EEVEE" etc."""
    e = read_engine(path)
    if e is None:
        return None
    return CANONICAL_FROM_LEGACY.get(e, e)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        e = read_engine_canonical(Path(p))
        print(f"{p}\n  engine = {e!r}")
