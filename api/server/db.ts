import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';

// Use a data folder to persist DB file
const dbPath = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dbPath)) {
  fs.mkdirSync(dbPath, { recursive: true });
}

export async function initDb() {
  const db = await open({
    filename: path.join(dbPath, 'database.sqlite'),
    driver: sqlite3.Database,
  });

  // ----- SQLite session-level PRAGMAs -----
  // journal_mode=WAL: concurrent readers don't block writers (or each other)
  // synchronous=NORMAL: durable enough for WAL; faster than FULL
  // busy_timeout=5000: 5s wait before giving up on a locked DB (instead of immediate SQLITE_BUSY)
  // foreign_keys=ON: enforce FK constraints declared in CREATE TABLE
  await db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);

  // ===== Create tables (if not exist) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      description TEXT,
      category TEXT,
      tags TEXT,
      imageUrl TEXT,
      fileUrl TEXT,
      panCode TEXT,
      downloadCount INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      createdBy INTEGER,
      usedBy INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      usedAt DATETIME
    );

    -- ===== Payments: one row per Stripe checkout session, including the
    -- kind (online credits or HDA license) and the resulting entitlement. =====
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('credits', 'hda')),
      tier TEXT,
      amountCents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'usd',
      creditsAdded INTEGER DEFAULT 0,
      hdaLicenseKey TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
      provider TEXT DEFAULT 'stripe',
      providerSessionId TEXT UNIQUE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      completedAt DATETIME
    );

    -- ===== Licenses: offline license files for the HDA. =====
    -- The HDA reads ~/.yaopc/license on open and enforces max_runs +
    -- expires_at locally (no network call needed).
    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      paymentId INTEGER,
      key TEXT UNIQUE NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('indie', 'studio', 'sub')),
      maxRuns INTEGER NOT NULL CHECK (maxRuns > 0),
      runsUsed INTEGER NOT NULL DEFAULT 0 CHECK (runsUsed >= 0),
      issuedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiresAt DATETIME NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (paymentId) REFERENCES payments(id) ON DELETE SET NULL
    );

    -- ===== One-time signed download tokens for the HDA binary. =====
    -- After payment, the user gets a download link containing a token; we
    -- verify HMAC + expiry + not-used, then stream the .hda file.
    CREATE TABLE IF NOT EXISTS hdaDownloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      licenseId INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expiresAt DATETIME NOT NULL,
      usedAt DATETIME,
      FOREIGN KEY (licenseId) REFERENCES licenses(id) ON DELETE CASCADE
    );

    -- ===== Stripe webhook idempotency (added 2026-08) =====
    -- Stripe will retry failed webhooks. We INSERT OR IGNORE on the event id
    -- so the fulfilment block runs at most once per event.
    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      type TEXT,
      receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ===== Per-collection baidu-pan share links (added 2026-08-24) =====
    CREATE TABLE IF NOT EXISTS collectionShareLinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resourceId INTEGER NOT NULL,
      collectionName TEXT NOT NULL,
      fileUrl TEXT NOT NULL,
      panCode TEXT,
      baiduPath TEXT,
      sizeBytes INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (resourceId) REFERENCES resources(id) ON DELETE CASCADE,
      UNIQUE(resourceId, collectionName)
    );

    -- ===== Migration ledger (added 2026-08) =====
    -- Records which additive migrations have been applied so we can
    -- answer "is this DB at schema N?" without parsing PRAGMA output.
    -- Each migration below INSERT OR IGNOREs its name after it runs.
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ----- Indexes -----
  // Hot-path lookups: resource listing (createdAt DESC + category filter),
  // payments by user (webhook reconciliation / admin UI), webhook dedup is
  // keyed so PK index covers it.
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_resources_createdAt ON resources(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category);
    CREATE INDEX IF NOT EXISTS idx_payments_userId ON payments(userId);
    CREATE INDEX IF NOT EXISTS idx_licenses_userId ON licenses(userId);
    CREATE INDEX IF NOT EXISTS idx_invites_createdBy ON invites(createdBy);
  `);

  // ===== Migration: add new columns to legacy tables =====
  // Use PRAGMA table_info to detect missing columns. SQLite's ALTER TABLE
  // can't drop columns in older versions, so additive migrations only.
  const userCols = await db.all(`PRAGMA table_info(users)`);
  const userColNames = userCols.map((c: any) => c.name);
  if (!userColNames.includes('email')) {
    await db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
  }
  if (!userColNames.includes('role')) {
    await db.exec(`ALTER TABLE users ADD COLUMN role TEXT`);
    await db.run(`UPDATE users SET role = 'user' WHERE role IS NULL`);
  }
  if (!userColNames.includes('createdAt')) {
    await db.exec(`ALTER TABLE users ADD COLUMN createdAt DATETIME`);
  }
  await db.run(
    `UPDATE users
       SET createdAt = COALESCE(createdAt, datetime('now'))
     WHERE createdAt IS NULL`
  );
  if (!userColNames.includes('creditsRemaining')) {
    await db.exec(`ALTER TABLE users ADD COLUMN creditsRemaining INTEGER`);
  }
  // Backfill runs every boot (cheap once data is non-NULL) so a
  // crashed mid-migration recovers on the next start.
  await db.run(
    `UPDATE users
       SET creditsRemaining = COALESCE(creditsRemaining, 3)
     WHERE creditsRemaining IS NULL`
  );
  if (!userColNames.includes('creditsResetAt')) {
    await db.exec(`ALTER TABLE users ADD COLUMN creditsResetAt DATETIME`);
  }
  await db.run(
    `UPDATE users
       SET creditsResetAt = COALESCE(creditsResetAt, datetime('now'))
     WHERE creditsResetAt IS NULL`
  );
  if (!userColNames.includes('isSubscribed')) {
    await db.exec(`ALTER TABLE users ADD COLUMN isSubscribed INTEGER DEFAULT 0`);
  }

  const resourceCols = await db.all(`PRAGMA table_info(resources)`);
  const resourceColNames = resourceCols.map((c: any) => c.name);

  const paymentCols = await db.all(`PRAGMA table_info(payments)`);
  const paymentColNames = paymentCols.map((c: any) => c.name);
  if (!paymentColNames.includes('currency')) {
    await db.exec(`ALTER TABLE payments ADD COLUMN currency TEXT DEFAULT 'usd'`);
    await db.run(`UPDATE payments SET currency = 'usd' WHERE currency IS NULL`);
  }
  // payments.userId originally had no FK (a user could be deleted and
  // leave orphan payments). SQLite can't ALTER-add a FK — rebuild the
  // table preserving data + the UNIQUE(providerSessionId) constraint.
  // (Checked by presence of the _migrations ledger so this only runs
  // once on old DBs.)
  const paymentsFkMigrated = await db.get(
    `SELECT name FROM _migrations WHERE name = 'add_payments_userId_fk'`
  );
  if (!paymentsFkMigrated) {
    await db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN IMMEDIATE;
      CREATE TABLE payments_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('credits', 'hda')),
        tier TEXT,
        amountCents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'usd',
        creditsAdded INTEGER DEFAULT 0,
        hdaLicenseKey TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
        provider TEXT DEFAULT 'stripe',
        providerSessionId TEXT UNIQUE,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        completedAt DATETIME,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
      );
      INSERT INTO payments_new (id, userId, kind, tier, amountCents, currency, creditsAdded, hdaLicenseKey, status, provider, providerSessionId, createdAt, completedAt)
        SELECT id, userId, kind, tier, amountCents, currency, creditsAdded, hdaLicenseKey, status, provider, providerSessionId, createdAt, completedAt FROM payments;
      DROP TABLE payments;
      ALTER TABLE payments_new RENAME TO payments;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
    await db.run(
      `INSERT OR IGNORE INTO _migrations (name) VALUES ('add_payments_userId_fk')`
    );
  }
  if (!resourceColNames.includes('tagGroups')) {
    await db.exec(`ALTER TABLE resources ADD COLUMN tagGroups TEXT`);
    // Backfill from legacy category + tags columns.
    const rows: any[] = await db.all(
      `SELECT id, category, tags FROM resources WHERE tagGroups IS NULL`
    );
    for (const r of rows) {
      let parsed: string[] = [];
      try {
        parsed = JSON.parse(r.tags);
      } catch {
        parsed = r.tags ? r.tags.split(',') : [];
      }
      const TECH = ['procedural', 'fx', 'simulation', 'shader', 'geometry',
        'vfx', 'modeling', 'rigging', 'animation', 'lighting', 'particles',
        'destruction', 'nanite', 'photogrammetry', 'hard-surface', 'addon',
        'hda', 'generator', 'environment'];
      const ELEMENT = ['sand', 'water', 'fire', 'smoke', 'foliage', 'rocks',
        'glass', 'metal', 'fabric', 'wood', 'ice', 'cloud', 'fog', 'city'];
      const technique: string[] = [];
      const element: string[] = [];
      for (const t of parsed) {
        const lower = t.trim().toLowerCase();
        if (TECH.includes(lower)) technique.push(t.trim());
        else if (ELEMENT.includes(lower)) element.push(t.trim());
      }
      const software: string[] = r.category ? [r.category] : [];
      const tg = JSON.stringify({ software, element, technique });
      await db.run(`UPDATE resources SET tagGroups = ? WHERE id = ?`, [tg, r.id]);
    }
  }

  if (!resourceColNames.includes('panCode')) {
    await db.exec(`ALTER TABLE resources ADD COLUMN panCode TEXT`);
  }

  // ===== Seed the super admin =====
  // Credentials are read from env so they never ship in source/git history.
  // We ONLY insert on first run; never overwrite an existing admin's
  // password (that would let a restarted process downgrade a real admin).
  const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;
  const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
  if (SUPER_ADMIN_EMAIL && SUPER_ADMIN_PASSWORD) {
    // Only skip the seed if a real ADMIN with this identity already
    // exists. (A plain 'user' row sharing the username/email must NOT
    // suppress admin creation — otherwise an operator rotating the
    // SUPER_ADMIN_EMAIL would silently end up with zero admins.)
    const existingSuper = await db.get(
      `SELECT id FROM users
        WHERE (username = ? OR email = ?) AND role = 'admin'
        LIMIT 1`,
      [SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAIL]
    );
    if (!existingSuper) {
      // Brand new install — seed the super admin.
      const hash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
      await db.run(
        `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'admin')`,
        [SUPER_ADMIN_EMAIL, SUPER_ADMIN_EMAIL, hash]
      );
    }
    // else: admin already exists; never overwrite their password.
  } else {
    console.warn(
      '[db] SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping super admin seed. ' +
        'Set them in api/.env to enable admin sign-in.'
    );
  }

  // Mark the migration ledger entries for the additive migrations
  // above (all run before this point).
  await db.run(
    `INSERT OR IGNORE INTO _migrations (name) VALUES (?), (?), (?), (?), (?), (?), (?), (?)`,
    [
      'add_users_credits_columns',
      'add_resources_tagGroups_panCode',
      'add_payments_currency',
      'add_webhook_events',
      'add_indexes',
      'add_pragmas',
      'add_admin_env_seed',
      'add_collection_share_links',
    ]
  );

  // ===== Seed some initial data for visual testing if DB is empty =====
  const resourceCount = await db.get('SELECT COUNT(*) as count FROM resources');
  if (resourceCount.count === 0) {
    const seeds = [
      {
        title: 'Houdini Procedural City Generator',
        description:
          'A powerful Node setup for creating procedural cities instantly. Completely parameterized and ready for Redshift rendering.',
        category: 'Houdini',
        tags: '["procedural", "city", "hda", "generator"]',
        tagGroups: JSON.stringify({
          software: ['Houdini'],
          element: ['rocks'],
          technique: ['procedural', 'fx'],
        }),
        imageUrl:
          'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop',
        fileUrl: '#',
      },
      {
        title: 'UE5 Realistic Environment Pack',
        description:
          'A collection of 50+ nanite-enabled realistic foliage and rock photogrammetry assets for Unreal Engine 5.',
        category: 'UE',
        tags: '["nanite", "environment", "photogrammetry"]',
        tagGroups: JSON.stringify({
          software: ['Unreal Engine'],
          element: ['foliage', 'rocks', 'water'],
          technique: ['shader', 'vfx'],
        }),
        imageUrl:
          'https://images.unsplash.com/photo-1542831371-29b0f74f9713?q=80&w=2700&auto=format&fit=crop',
        fileUrl: '#',
      },
      {
        title: 'Blender Hard Surface Addon',
        description:
          'An ultimate workflow enhancer for hard surface modeling in Blender 4.0+. Cut, bevel, and detail with a single click.',
        category: 'Blender',
        tags: '["addon", "hard-surface", "modeling"]',
        tagGroups: JSON.stringify({
          software: ['Blender'],
          element: ['metal'],
          technique: ['modeling', 'geometry'],
        }),
        imageUrl:
          'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2000&auto=format&fit=crop',
        fileUrl: '#',
      },
    ];

    const stmt = await db.prepare(
      'INSERT INTO resources (title, description, category, tags, imageUrl, fileUrl, tagGroups) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    try {
      for (const seed of seeds) {
        await stmt.run(
          seed.title,
          seed.description,
          seed.category,
          seed.tags,
          seed.imageUrl,
          seed.fileUrl,
          seed.tagGroups
        );
      }
    } finally {
      await stmt.finalize();
    }
  }

  return db;
}
