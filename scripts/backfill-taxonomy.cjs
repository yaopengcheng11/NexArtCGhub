// One-off taxonomy backfill for pre-taxonomy resource rows.
// Usage:
//   local:  node scripts/backfill-taxonomy.cjs ./api/data/database.sqlite sqlite3
//   docker: docker exec -w /app cgrh node /tmp/backfill-taxonomy.cjs \
//             /app/api/data/database.sqlite /app/node_modules/sqlite3
//
// Rules (from the 2026-09 taxonomy rollout):
//   resType : tagGroups.schema === 'blend-asset-v1' → 'model', else 'project'
//   license : tags mention CC0 / MIT / GPL, else 'commercial'
//   isFree  : tags mention 'Paid' → 0, else 1
//   language: left NULL (unspecified) — these are project files, no language.
const DB_PATH = process.argv[2] || './api/data/database.sqlite';
// eslint-disable-next-line import/no-dynamic-require
const sqlite3 = require(process.argv[3] || 'sqlite3');

const db = new sqlite3.Database(DB_PATH);
db.configure('busyTimeout', 8000);

function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw ? String(raw).split(',').map((s) => s.trim()).filter(Boolean) : [];
  }
}

db.serialize(() => {
  // Ensure the taxonomy columns exist (idempotent — same additive
  // migration db.ts runs at boot; kept here so the script also works
  // on DB copies that never booted the new server).
  db.all(`PRAGMA table_info(resources)`, (e, cols) => {
    if (e) { console.error('pragma failed:', e.message); process.exit(1); }
    const names = cols.map((c) => c.name);
    const needed = [
      ['resType', 'TEXT'],
      ['license', 'TEXT'],
      ['language', 'TEXT'],
      ['isFree', 'INTEGER DEFAULT 1'],
    ];
    let missing = needed.filter(([c]) => !names.includes(c));
    let done = 0;
    if (missing.length === 0) { start(); return; }
    for (const [col, def] of missing) {
      db.exec(`ALTER TABLE resources ADD COLUMN ${col} ${def}`, (e2) => {
        if (e2 && !/duplicate column/i.test(e2.message)) {
          console.error(`add column ${col} failed:`, e2.message);
          process.exit(1);
        }
        console.log(`added column ${col}`);
        done += 1;
        if (done === missing.length) start();
      });
    }
  });

  function start() {
  db.all(
    `SELECT id, title, tags, tagGroups FROM resources
     WHERE resType IS NULL OR license IS NULL OR isFree IS NULL`,
    (err, rows) => {
      if (err) { console.error('select failed:', err.message); process.exit(1); }
      console.log(`rows to backfill: ${rows.length}`);
      let pending = rows.length;
      if (pending === 0) { verify(); return; }
      for (const row of rows) {
        const tags = parseTags(row.tags).map((t) => t.toLowerCase());
        // resType: the blend-asset-v1 schema marks the upload pipeline, not
        // the taxonomy — only packs exposing per-asset download are "model";
        // everything else is a .blend project file.
        const resType = tags.some((t) => t.includes('per-asset download')) ? 'model' : 'project';
        const license = tags.some((t) => t.includes('cc0')) ? 'cc0'
          : tags.some((t) => t.includes('mit')) ? 'mit'
          : tags.some((t) => t.includes('gpl')) ? 'gpl'
          : null; // unknown → leave NULL (renders as 未指定) for admin to fill
        const isFree = tags.some((t) => t.includes('paid')) ? 0 : 1;
        db.run(
          `UPDATE resources SET resType = ?, license = ?, isFree = COALESCE(isFree, ?)
           WHERE id = ?`,
          [resType, license, isFree, row.id],
          (e2) => {
            if (e2) console.error(`#${row.id} failed:`, e2.message);
            else console.log(`#${row.id} ${row.title.slice(0, 30)} → ${resType}/${license}/free=${isFree}`);
            pending -= 1;
            if (pending === 0) verify();
          }
        );
      }
    }
  );
  }

  function verify() {
    db.all(
      `SELECT resType, license, isFree, COUNT(*) as c FROM resources
       GROUP BY resType, license, isFree ORDER BY c DESC`,
      (e, rows) => {
        if (e) { console.error('verify failed:', e.message); process.exit(1); }
        console.log('--- distribution ---');
        rows.forEach((r) => console.log(`${r.resType} / ${r.license} / free=${r.isFree}: ${r.c}`));
        db.get('SELECT COUNT(*) as total FROM resources', (e2, row) => {
          console.log('total:', row ? row.total : '?');
          db.close();
        });
      }
    );
  }
});