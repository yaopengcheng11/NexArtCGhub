/**
 * Minimal ZIP writer (STORE / no-compression) — the single source of
 * truth for the archive format used across the API.
 *
 * Why not `archiver`: npm registry is sometimes unreachable in this
 * environment, and our payload is already-compressed .hip + tiny .md
 * so deflate wouldn't help much.
 *
 * Format: PKWARE APPNOTE 6.3.x — Local file header + Central dir +
 * EOCD. All multi-byte values are little-endian.
 *
 * IMPORTANT: the Central Directory *and* Local File Header both set the
 * UTF-8 name flag (0x0800). Previously there were two copies of this
 * writer and the toolEndpoint copy wrote 0 to the CD flag — strictly
 * speaking a contradiction that made some extractors (Windows Explorer
 * is lenient, others aren't) render non-ASCII entry names wrong.
 * Chinese filenames are the norm for user uploads here, so this
 * consistency actually matters.
 */

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
}

function crc32(buf: Buffer): number {
  // Standard IEEE 802.3 CRC-32 (polynomial 0xEDB88320), one-pass
  // table-less implementation. Fast enough for typical .hip + .md sizes.
  let c = 0xffffffff >>> 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = c ^ byte;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosTimeDate(d = new Date()): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getSeconds() >> 1) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Build a single-blob ZIP archive (STORE method, no compression) from
 * a list of {name, data} entries. Returns the archive as a Buffer.
 */
export function buildZip(parts: { name: string; data: Buffer }[]): Buffer {
  const { time, date } = dosTimeDate();
  const entries: ZipEntry[] = [];
  const localChunks: Buffer[] = [];
  let cursor = 0;
  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, 'utf-8');
    const data = part.data;
    const crc = crc32(data);
    const size = data.length;
    // Local file header (30 bytes + name)
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);     // signature
    lfh.writeUInt16LE(20, 4);              // version needed
    lfh.writeUInt16LE(0x0800, 6);          // general purpose: utf-8 name
    lfh.writeUInt16LE(0, 8);               // method: 0 = STORE
    lfh.writeUInt16LE(time, 10);           // last mod time
    lfh.writeUInt16LE(date, 12);           // last mod date
    lfh.writeUInt32LE(crc, 14);            // crc32
    lfh.writeUInt32LE(size, 18);           // compressed size (= uncompressed)
    lfh.writeUInt32LE(size, 22);           // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26); // file name length
    lfh.writeUInt16LE(0, 28);              // extra field length
    const lfhBuf = Buffer.concat([lfh, nameBuf, data]);
    entries.push({
      name: part.name,
      data,
      crc,
      size,
      offset: cursor,
      dosTime: time,
      dosDate: date,
    });
    localChunks.push(lfhBuf);
    cursor += lfhBuf.length;
  }

  // Central directory entries (one per file, 46 bytes + name + extra)
  const cdChunks: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);     // signature
    cdh.writeUInt16LE(20, 4);              // version made by
    cdh.writeUInt16LE(20, 6);              // version needed
    cdh.writeUInt16LE(0x0800, 8);          // general purpose: utf-8 name
    cdh.writeUInt16LE(0, 10);              // method
    cdh.writeUInt16LE(e.dosTime, 12);      // time
    cdh.writeUInt16LE(e.dosDate, 14);      // date
    cdh.writeUInt32LE(e.crc, 16);          // crc32
    cdh.writeUInt32LE(e.size, 20);         // compressed size
    cdh.writeUInt32LE(e.size, 24);         // uncompressed size
    cdh.writeUInt16LE(nameBuf.length, 28); // file name length
    cdh.writeUInt16LE(0, 30);              // extra field length
    cdh.writeUInt16LE(0, 32);              // file comment length
    cdh.writeUInt16LE(0, 34);              // disk number start
    cdh.writeUInt16LE(0, 36);              // internal attrs
    cdh.writeUInt32LE(0, 38);              // external attrs
    cdh.writeUInt32LE(e.offset, 42);       // local header offset
    const cdhBuf = Buffer.concat([cdh, nameBuf]);
    cdChunks.push(cdhBuf);
    cdSize += cdhBuf.length;
  }

  // End of central directory record (22 bytes)
  const cdOffset = cursor;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);      // signature
  eocd.writeUInt16LE(0, 4);                // disk number
  eocd.writeUInt16LE(0, 6);                // cd start disk
  eocd.writeUInt16LE(entries.length, 8);   // entries this disk
  eocd.writeUInt16LE(entries.length, 10);  // total entries
  eocd.writeUInt32LE(cdSize, 12);          // cd size
  eocd.writeUInt32LE(cdOffset, 16);        // cd offset
  eocd.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([...localChunks, ...cdChunks, eocd]);
}
