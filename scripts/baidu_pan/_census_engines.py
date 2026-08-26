"""Census: which source blends actually store an engine string?"""
import re
import tempfile
import zipfile
from pathlib import Path

ENG = [b'BLENDER_EEVEE_NEXT', b'BLENDER_EEVEE', b'BLENDER_WORKBENCH',
       b'BLENDER_RENDER', b'BLENDER_GAME', b'CYCLES', b'WORKBENCH', b'EEVEE']
PAT = re.compile(rb'(?:' + b'|'.join(re.escape(e) for e in ENG) + rb')\x00{8,}')


def unwrap(p: Path):
    head = p.open('rb').read(8)
    if head.startswith(b'BLENDER'):
        return p.read_bytes(), 'raw'
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
        return b''.join(parts), 'zstd'
    if head[:2] == b'\x1f\x8b':
        import gzip
        return gzip.decompress(p.read_bytes()), 'gzip'
    return p.read_bytes(), '?'


def probe(p: Path):
    data, w = unwrap(p)
    if data.startswith(b'BLENDER'):
        inner = data[:11].decode('ascii', errors='replace')
    elif data[:4] == b'\x89HDF\r\n\x1a\n':
        inner = 'HDF5'
    else:
        inner = repr(data[:6])
    hits = sorted({m.group(0).rstrip(b'\x00').decode() for m in PAT.finditer(data)})
    return w, inner, hits


def main():
    src = Path(r'D:\Blender_Cover')
    rows = []
    for folder in sorted(src.iterdir()):
        if not folder.is_dir() or folder.name.startswith('Blender 2.91'):
            continue
        for f in sorted(folder.rglob('*.blend')):
            if f.name.endswith('.blend1'):
                continue
            try:
                w, inner, hits = probe(f)
                rows.append((folder.name[:34], w, inner, hits))
            except Exception as e:
                rows.append((folder.name[:34], 'ERR', str(e)[:40], []))
    for zp in sorted(src.rglob('*.zip')):
        with zipfile.ZipFile(zp) as zf:
            mems = [i for i in zf.infolist()
                    if i.filename.lower().endswith('.blend') and not i.filename.endswith('.blend1')]
            if not mems:
                continue
            m = max(mems, key=lambda i: i.file_size)
            with tempfile.NamedTemporaryFile(suffix='.blend', delete=False) as tf:
                tf.write(zf.open(m).read())
                tmp = Path(tf.name)
            try:
                w, inner, hits = probe(tmp)
                label = zp.parent.name[:24] + '/' + Path(m.filename).name
                rows.append((label, w, inner, hits))
            except Exception as e:
                rows.append((zp.parent.name[:24], 'ERR', str(e)[:40], []))
            finally:
                tmp.unlink()

    for name, w, inner, hits in rows:
        print(f'{name:<38} {w:<5} {inner:<13} {hits}')
    print()
    n_hit = sum(1 for r in rows if r[3])
    print(f'total={len(rows)}  with-engine-hit={n_hit}  empty={len(rows)-n_hit}')


if __name__ == '__main__':
    main()
