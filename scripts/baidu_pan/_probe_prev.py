"""Probe PREV blocks in sample blends to learn the byte layout."""
import io
import re
import struct
import tempfile
import zipfile
import zlib
from pathlib import Path


def unwrap(p: Path) -> bytes:
    head = p.open('rb').read(8)
    if head.startswith(b'BLENDER'):
        return p.read_bytes()
    if head[:4] == b'\x28\xb5\x2f\xfd':
        import zstandard
        d = zstandard.ZstdDecompressor()
        parts = []
        with p.open('rb') as f, d.stream_reader(f) as r:
            while True:
                c = r.read(64 << 20)
                if not c:
                    break
                parts.append(c)
        return b''.join(parts)
    if head[:2] == b'\x1f\x8b':
        import gzip
        return gzip.decompress(p.read_bytes())
    return p.read_bytes()


def hexdump(data: bytes, base: int = 0, n: int = 96):
    seg = data[base:base + n]
    for i in range(0, len(seg), 16):
        row = seg[i:i + 16]
        hx = ' '.join(f'{b:02x}' for b in row)
        asc = ''.join(chr(c) if 32 <= c < 127 else '.' for c in row)
        print(f'{base + i:9d}  {hx:<48}  {asc}')


def find_prev_blocks(data: bytes):
    """Scan for block-code PREV\\0 and return (offset_of_code, header_dict)."""
    out = []
    ptrsize = 8 if data[7:8] == b'_' else 4
    hdr = 4 + 4 + ptrsize + 4 + 4
    for m in re.finditer(rb'PREV\x00', data):
        off = m.start()
        # candidate only if it looks like a block boundary (prev bytes null-ish
        # or start); we just report everything and eyeball.
        try:
            size = struct.unpack_from('<I', data, off + 4)[0]
            sdna = struct.unpack_from('<I', data, off + 8 + ptrsize)[0]
            count = struct.unpack_from('<I', data, off + 12 + ptrsize)[0]
            out.append((off, size, sdna, count))
        except Exception:
            pass
    return out, ptrsize, hdr


def analyze(path: Path, label: str):
    data = unwrap(path)
    ver = data[7:11].decode('ascii', errors='replace')
    blocks, ptrsize, hdr = find_prev_blocks(data)
    print(f'== {label}  version={ver} ptr={ptrsize}  PREV-candidates={len(blocks)}')
    for off, size, sdna, cnt in blocks[:3]:
        print(f'   block@{off} size={size} sdna={sdna} count={cnt}')
        hexdump(data, off + hdr, 64)


if __name__ == '__main__':
    samples = [
        Path(r'D:\Blender_Cover\Blender 2.80_Spring\blender-2-87fa4cd2c41b4fac82ea2780d98c105d.blend'),
        Path(r'D:\Blender_Cover\Blender 2.82_Tram Station\blender-282-2a768f064ee64cfaaf2a8c682c3ff709.blend'),
        Path(r'D:\Blender_Cover\Blender 5.1_Singularity\blender-5.1-splash.blend'),
    ]
    for p in samples:
        analyze(p, p.parent.name)
    # one zip member (Fishy Cat, gzip-wrapped inside zip)
    zp = Path(r'D:\Blender_Cover\Blender 2.74_Fishy Cat\blender-2.74-splash.zip')
    with zipfile.ZipFile(zp) as zf:
        mems = [i for i in zf.infolist() if i.filename.lower().endswith('.blend')]
        m = max(mems, key=lambda i: i.file_size)
        with tempfile.NamedTemporaryFile(suffix='.blend', delete=False) as tf:
            tf.write(zf.open(m).read())
            tmp = Path(tf.name)
    analyze(tmp, 'zip:' + m.filename)
    tmp.unlink()
