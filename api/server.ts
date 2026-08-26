import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { initDb } from './server/db.js';
import { stripeCreate, verifyStripeSignature } from './server/stripe.js';
import {
  createToolEndpoint,
  makeToolUpload,
  type ToolEndpointSpec,
} from './server/lib/toolEndpoint.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import dotenv from 'dotenv';

// Load .env BEFORE reading process.env anywhere below. dotenv won't
// override existing env vars so production deploys can still set them
// via systemd/Docker.
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8789', 10);
// JWT_SECRET is required — refuse to boot if it's missing or still the
// placeholder value. This prevents accidental deploys where anyone with
// the repo could forge admin tokens.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32 || JWT_SECRET.includes('change_me') || JWT_SECRET.includes('fallback')) {
  console.error(
    '[FATAL] JWT_SECRET is missing or looks like a placeholder. ' +
      'Set a strong random value (>= 32 chars) in api/.env before starting the API.'
  );
  process.exit(1);
}
// After the process.exit guard, TS still narrows this to `string | undefined`.
// Force the narrow with a non-null assertion since the early-exit guarantees
// we never get here with an invalid value.
const JWT_SIGNING_KEY: string = JWT_SECRET;
const INVITE_CODE = process.env.INVITE_CODE || 'ethereal-2026';
const CORS_ORIGIN = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const HYTHON_PATH = process.env.HYTHON_PATH ||
  'C:\\Program Files\\Side Effects Software\\Houdini 22.0.368\\bin\\hython.exe';
const HIP_PATH_DOCTOR_SCRIPT = path.resolve(
  __dirname, 'tools', 'hip_path_doctor.py'
);
const HIP_PATH_DOCTOR_TMP = path.resolve(
  __dirname, '..', 'data', 'tools_uploads'
);
const HIP_PATH_DOCTOR_MAX_BYTES = parseInt(
  process.env.HIP_PATH_DOCTOR_MAX_BYTES || String(100 * 1024 * 1024), 10
);

// =====================================================================
// HIP Format Bridge (2026-08-22) — import any 3D file into a fresh .hip
// Mirrors HIP Path Doctor's upload -> hython -> zip pattern.
//   1. user uploads a non-Houdini 3D file (.3ds / .step / .iges / etc.)
//   2. server spawns hip_format_bridge.py which:
//      a. FreeCADCmd converts the file to an intermediate .obj
//      b. hython embeds the .obj in /obj/imported_geometry inside a fresh .hip
//   3. server streams back a zip containing the .hip + audit .md log
// =====================================================================
const HIP_FORMAT_BRIDGE_SCRIPT = path.resolve(
  __dirname, 'tools', 'hip_format_bridge.py'
);
const HIP_FORMAT_BRIDGE_TMP = path.resolve(
  __dirname, '..', 'data', 'tools_uploads'
);
const HIP_FORMAT_BRIDGE_MAX_BYTES = parseInt(
  process.env.HIP_FORMAT_BRIDGE_MAX_BYTES || String(200 * 1024 * 1024), 10
);
const HIP_FORMAT_BRIDGE_ALLOWED_EXTS = new Set([
  // mesh (Houdini can't read these natively)
  '3ds', '3mf', 'dae', 'ply', 'stl', 'off',
  // cad (Houdini can't read these natively)
  'step', 'stp', 'iges', 'igs', 'sat', 'sab', 'brep',
  // 2d cad
  'dxf',
]);

// =====================================================================
// 3DGS Auto Trainer (2026-08-22) — COLMAP → Houdini ML 3DGS one-click
// Mirrors HIP Path Doctor / HIP Format Bridge upload → hython → zip
// pattern. User uploads a .zip of source images; the server spawns
// gsplats_auto_trainer.py which (a) extracts the zip, (b) runs COLMAP,
// (c) builds a Houdini 22 scene with /tasks ml_train_gsplats TOP + a
// SOP preview chain, (d) saves the .hip. The user can then open the
// .hip in Houdini and run the TOP cook locally. Training is intentionally
// NOT triggered server-side because the cook takes 30+ minutes and
// would exceed any sensible HTTP timeout.
// =====================================================================
const GSPLATS_TRAINER_SCRIPT = path.resolve(
  __dirname, 'tools', 'gsplats_auto_trainer.py'
);
const GSPLATS_TRAINER_TMP = path.resolve(
  __dirname, '..', 'data', 'tools_uploads'
);
// 500 MB cap by default — zipped image sets can be sizeable (e.g. 200
// full-res JPGs at 4 MB each before zipping). Env-overridable.
const GSPLATS_TRAINER_MAX_BYTES = parseInt(
  process.env.GSPLATS_TRAINER_MAX_BYTES || String(500 * 1024 * 1024), 10
);

// =====================================================================
// Stripe + pricing config
// =====================================================================
// We hit Stripe's REST API directly via fetch — no npm SDK. This avoids the
// npm registry outage we've hit in this environment and keeps the
// dependency surface small. The wire format is `application/x-www-form-
// urlencoded` for create calls and JSON for responses (matches Stripe
// docs: https://stripe.com/docs/api).
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';
const STRIPE_API = 'https://api.stripe.com/v1';

// Pricing table — single source of truth for both the /pricing page and
// the Stripe checkout session. amounts in minor units (cents for USD,
// fen for CNY). HDA always has a usage cap (per user preference,
// 2026-08-22: "我这个HDA始终都是有次数限制的").
//
// Regional pricing strategy (Option A, 2026-08-22): fixed tiers, NOT
// real-time FX. USD for international, CNY for mainland-China users.
// CNY prices are ~1:7 of USD but rounded to nice numbers and slightly
// discounted per-unit to reflect purchasing power parity — so a Chinese
// Pro user pays ¥99/100credits (~$13.7) vs international $30/100credits.
// Don't add a real-time FX endpoint later; the moment you do, Chinese
// users will see the price go up every time the dollar strengthens.
type Currency = 'usd' | 'cny';
type PaymentMethod = 'card' | 'wechat_pay' | 'alipay';
interface CreditTier {
  id: 'starter' | 'pro' | 'studio';
  name: string;
  credits: number;
  amount: number;          // minor units (cents/fen)
  perFix: number;          // helper: average minor units per fix
  highlight?: boolean;
}
interface HdaTier {
  id: 'indie' | 'studio' | 'sub';
  name: string;
  amount: number;
  maxRuns: number;         // 0 = unlimited (for sub tier)
  durationDays: number;    // 365 for everything
  highlight?: boolean;
}
const PRICING: Record<Currency, { credits: CreditTier[]; hda: HdaTier[] }> = {
  usd: {
    credits: [
      { id: 'starter', name: 'Starter',  credits: 30,  amount: 1000,  perFix: 33 },
      { id: 'pro',     name: 'Pro',      credits: 100, amount: 3000,  perFix: 30, highlight: true },
      { id: 'studio',  name: 'Studio',   credits: 400, amount: 10000, perFix: 25 },
    ],
    hda: [
      { id: 'indie',  name: 'Indie',              amount: 4900,  maxRuns: 200,  durationDays: 365 },
      { id: 'studio', name: 'Studio',             amount: 19900, maxRuns: 1000, durationDays: 365, highlight: true },
      { id: 'sub',    name: 'Annual Subscription', amount: 9900, maxRuns: 0,    durationDays: 365 },
    ],
  },
  cny: {
    // ~1:7.2 of USD but rounded to nice numbers + slight per-unit discount
    // so Chinese users feel they're getting fair value without us racing FX.
    //   ¥35/30credits ≈ $0.48/fix  (USD: $0.33/fix)   ~50% off per-fix
    //   ¥99/100credits ≈ $0.14/fix (USD: $0.30/fix)   ~53% off per-fix
    //   ¥299/400credits ≈ $0.10/fix (USD: $0.25/fix)  ~60% off per-fix
    credits: [
      { id: 'starter', name: '入门版 Starter',  credits: 30,  amount: 3500,  perFix: 117, highlight: false },
      { id: 'pro',     name: '专业版 Pro',      credits: 100, amount: 9900,  perFix: 99,  highlight: true },
      { id: 'studio',  name: '工作室 Studio',   credits: 400, amount: 29900, perFix: 75,  highlight: false },
    ],
    hda: [
      { id: 'indie',  name: '个人版 Indie',         amount: 16900, maxRuns: 200,  durationDays: 365, highlight: false },
      { id: 'studio', name: '工作室 Studio',         amount: 69900, maxRuns: 1000, durationDays: 365, highlight: true },
      { id: 'sub',    name: '年度订阅 Annual Sub',   amount: 34900, maxRuns: 0,    durationDays: 365, highlight: false },
    ],
  },
};
// Which payment methods each currency supports. Stripe Checkout will only
// show methods the merchant has activated in their Dashboard AND that the
// currency supports. WeChat Pay + Alipay need to be enabled on the
// Stripe Dashboard side (Settings → Payment methods) before they show up.
const PAYMENT_METHODS_BY_CURRENCY: Record<Currency, PaymentMethod[]> = {
  usd: ['card'],
  cny: ['wechat_pay', 'alipay'],
};
const DEFAULT_CURRENCY: Currency = 'usd';

/**
 * Resolve a currency value from request body or query. Falls back to USD.
 * The frontend is the source of truth (it knows the user's chosen region
 * via the i18n locale); we just defend against bad input.
 */
function resolveCurrency(input: any): Currency {
  const c = String(input || '').toLowerCase();
  if (c === 'cny' || c === 'rmb' || c === 'cn' || c === '¥') return 'cny';
  return 'usd';
}

/**
 * Build the Stripe `payment_method_types[i]` array params. We always
 * include all currency-appropriate methods; Stripe itself filters to
 * whatever the merchant has activated in Dashboard. CNY + wechat_pay /
 * alipay must be activated on the Dashboard side, otherwise the session
 * creation will fail with "this payment method is not available".
 */
function paymentMethodTypesParams(methods: PaymentMethod[]): Record<string, string> {
  const out: Record<string, string> = {};
  methods.forEach((m, i) => { out[`payment_method_types[${i}]`] = m; });
  return out;
}

/**
 * Build the Stripe `line_items[0][...]` params for a one-off product
 * priced in the given currency. Includes the standard metadata so the
 * webhook can fulfil the order.
 */
function buildLineItemParams(
  productName: string,
  amountMinor: number,
  currency: Currency,
  metadata: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {
    'line_items[0][price_data][currency]': currency,
    'line_items[0][price_data][unit_amount]': String(amountMinor),
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][quantity]': '1',
  };
  for (const [k, v] of Object.entries(metadata)) {
    out[`metadata[${k}]`] = v;
  }
  return out;
}

// Where the HDA binary lives on disk. In production we'd bundle this in
// the repo or behind a signed S3 bucket; for now point at a local file the
// dev can drop in. If missing, the HDA checkout returns 503 with a clear
// hint instead of failing halfway through the payment flow.
const HDA_FILE_PATH = process.env.HDA_FILE_PATH ||
  path.resolve(__dirname, '..', '..', '..', 'Animal_Lib', 'animal_Cvt',
               'blender', 'yaopclab', 'object_yaopc.FolderPathFixed.2.0.hda');
// Secret used to sign single-use HDA download URLs. Reuse JWT_SECRET so we
// don't multiply the env surface; the same secret signs license + download
// tokens, which is fine (different namespaces).
const DOWNLOAD_SIGN_SECRET = process.env.DOWNLOAD_SIGN_SECRET || JWT_SIGNING_KEY;

const IS_PROD = process.env.NODE_ENV === 'production';

// =====================================================================
// Minimal ZIP writer (STORE / no-compression).
// We use this instead of the `archiver` package because npm registry
// is sometimes unreachable in this environment, and our payload is
// already-compressed .hip + tiny .md so deflate wouldn't help much.
// Format spec: PKWARE APPNOTE 6.3.x — Local file header + Central dir +
// EOCD. All multi-byte values are little-endian.
// =====================================================================
function crc32(buf: Buffer): number {
  // Standard IEEE 802.3 CRC-32 (polynomial 0xEDB88320), one-pass table-less
  // implementation. Fast enough for typical .hip + .md sizes (< 100 MB).
  let c = 0xFFFFFFFF >>> 0;
  for (let i = 0; i < buf.length; i++) {
    c = c ^ buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry {
  name: string;          // utf-8 filename inside the zip
  data: Buffer;          // file contents
  crc: number;           // crc32 of data
  size: number;          // uncompressed size
  offset: number;        // offset of the local header in the final blob
  dosTime: number;       // MS-DOS time stamp
  dosDate: number;       // MS-DOS date stamp
}

function dosTimeDate(d = new Date()): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) |
               ((d.getMinutes() & 0x3f) << 5) |
               ((d.getSeconds() >> 1) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) |
               (((d.getMonth() + 1) & 0x0f) << 5) |
               (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Build a single-blob ZIP archive (STORE method, no compression) from a
 * list of {name, data} entries. Returns the archive as a Buffer.
 */
function buildZip(parts: { name: string; data: Buffer }[]): Buffer {
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
    lfh.writeUInt32LE(0x04034b50, 0);    // signature
    lfh.writeUInt16LE(20, 4);             // version needed
    lfh.writeUInt16LE(0x0800, 6);         // general purpose: utf-8 name
    lfh.writeUInt16LE(0, 8);              // method: 0 = STORE
    lfh.writeUInt16LE(time, 10);          // last mod time
    lfh.writeUInt16LE(date, 12);          // last mod date
    lfh.writeUInt32LE(crc, 14);           // crc32
    lfh.writeUInt32LE(size, 18);          // compressed size (= uncompressed for STORE)
    lfh.writeUInt32LE(size, 22);          // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);// file name length
    lfh.writeUInt16LE(0, 28);             // extra field length
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
    cdh.writeUInt16LE(20, 4);             // version made by
    cdh.writeUInt16LE(20, 6);             // version needed
    cdh.writeUInt16LE(0x0800, 8);         // general purpose: utf-8 name
    cdh.writeUInt16LE(0, 10);            // method
    cdh.writeUInt16LE(e.dosTime, 12);    // time
    cdh.writeUInt16LE(e.dosDate, 14);    // date
    cdh.writeUInt32LE(e.crc, 16);        // crc32
    cdh.writeUInt32LE(e.size, 20);        // compressed
    cdh.writeUInt32LE(e.size, 24);        // uncompressed
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);            // extra field length
    cdh.writeUInt16LE(0, 32);            // comment length
    cdh.writeUInt16LE(0, 34);            // disk number
    cdh.writeUInt16LE(0, 36);            // internal attrs
    cdh.writeUInt32LE(0, 38);            // external attrs
    cdh.writeUInt32LE(e.offset, 42);     // local header offset
    const cdhBuf = Buffer.concat([cdh, nameBuf]);
    cdChunks.push(cdhBuf);
    cdSize += cdhBuf.length;
  }

  // EOCD (End of central directory record, 22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);               // disk number
  eocd.writeUInt16LE(0, 6);               // start disk
  eocd.writeUInt16LE(entries.length, 8);  // # entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // # total entries
  eocd.writeUInt32LE(cdSize, 12);         // central dir size
  eocd.writeUInt32LE(cursor, 16);         // central dir offset
  eocd.writeUInt16LE(0, 20);              // comment length

  return Buffer.concat([...localChunks, ...cdChunks, eocd]);
}

// JSON parse helper that returns null on failure instead of throwing
function safeJson(s: string | null | undefined): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();

  // Rate-limit the tool endpoints: each spawns hython.exe which is
  // CPU-heavy and can pin a worker for minutes if it hangs. 5 req/min
  // per user (or IP if anonymous, but tools require auth) is plenty for
  // legitimate use and prevents one bad client from DoS'ing the box.
  // Declared early so the /api/admin/blend-assets route below can use it.
  const toolLimiter = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: any) => String(req.user?.id ?? req.ip ?? 'anon'),
    message: { error: 'too_many_requests', message: 'Tool rate limit exceeded (5/min).' },
  });

  app.use(compression());
  app.use(
    cors({
      origin: IS_PROD ? false : CORS_ORIGIN,
      credentials: true,
    })
  );
  // Init DB up-front so the Stripe webhook (which must register before
  // express.json() so it can see the raw body) can use it.
  const db = await initDb();

  // ----- Stripe webhook (raw body, signature verified) -----
  // MUST be registered before express.json() — that middleware would
  // otherwise consume the raw body and break Stripe's HMAC verification.
  app.post(
    '/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    async (req: any, res: any) => {
      let event: any;
      try {
        event = verifyStripeSignature(
          STRIPE_WEBHOOK_SECRET,
          req.body as Buffer,
          req.headers['stripe-signature'] as string | undefined
        );
      } catch (e: any) {
        console.warn('[stripe webhook] signature failed:', e?.message);
        return res.status(400).json({ error: 'invalid_signature' });
      }
      // Idempotency: insert-or-ignore on event.id so retries don't
      // double-fulfil. We respond 200 even on dedup — Stripe considers
      // 4xx retriable.
      try {
        const r: any = await db.run(
          `INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)`,
          [event.id, event.type]
        );
        if (r.changes === 0) {
          return res.json({ received: true, dedup: true });
        }
      } catch (e: any) {
        console.error('[stripe webhook] dedup insert failed:', e);
        return res.status(500).json({ error: 'dedup_failed' });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata || {};
        const kind = meta.kind;
        const userId = Number(meta.userId);
        const paymentId = Number(meta.paymentId);
        if (
          (kind !== 'credits' && kind !== 'hda') ||
          !Number.isFinite(userId) ||
          !Number.isFinite(paymentId)
        ) {
          console.warn('[stripe webhook] missing/invalid metadata on session', session.id);
          return res.json({ received: true, warning: 'metadata_missing' });
        }
        try {
          if (kind === 'credits') {
            const credits = Number(meta.credits || 0);
            await db.run(
              `UPDATE payments SET status = 'completed', completedAt = datetime('now') WHERE id = ?`,
              [paymentId]
            );
            const user: any = await db.get(
              `SELECT isSubscribed FROM users WHERE id = ?`,
              [userId]
            );
            if (!user?.isSubscribed) {
              await db.run(
                `UPDATE users
                   SET creditsRemaining = creditsRemaining + ?
                 WHERE id = ?`,
                [credits, userId]
              );
            }
            console.log(`[stripe] +${credits} credits to user ${userId}`);
          } else if (kind === 'hda') {
            const tier = String(meta.tier);
            const maxRuns = Number(meta.maxRuns || 0);
            const durationDays = Number(meta.durationDays || 365);
            const expiresAt = new Date(
              Date.now() + durationDays * 86400 * 1000
            ).toISOString();
            const licenseKey = crypto.randomUUID();
            await db.run(
              `INSERT INTO licenses (userId, paymentId, key, tier, maxRuns, expiresAt)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [userId, paymentId, licenseKey, tier, maxRuns, expiresAt]
            );
            await db.run(
              `UPDATE payments
                 SET status = 'completed', hdaLicenseKey = ?, completedAt = datetime('now')
               WHERE id = ?`,
              [licenseKey, paymentId]
            );
            console.log(`[stripe] HDA license ${licenseKey} issued to user ${userId}`);
          }
        } catch (e: any) {
          console.error('[stripe webhook] fulfilment failed:', e);
          return res.status(500).json({ error: 'fulfilment_failed' });
        }
      }
      res.json({ received: true });
    }
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // ===================================================================
  // Auth middleware + auth routes
  // ===================================================================

  // Free-tier credits per calendar month. The 3/month tier is the default;
  // once a user subscribes, isSubscribed is set to 1 and the credit balance
  // is treated as "unlimited" (no decrement, no monthly reset).
  const FREE_TIER_CREDITS = 3;

  // requireAuth — verifies the JWT, fetches fresh user row, lazily resets
  // monthly credits. The reset is "lazy" (not cron) so it works on any
  // deploy without infra. A user who logs in for the first time this month
  // gets a fresh 3.
  const requireAuth = async (req: any, res: any, next: any) => {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SIGNING_KEY);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.user = decoded;
    try {
      const row: any = await db.get(
        `SELECT id, username, email, role, creditsRemaining, creditsResetAt, isSubscribed
         FROM users WHERE id = ?`,
        [decoded.id]
      );
      if (!row) return res.status(401).json({ error: 'User no longer exists.' });
      if (!row.isSubscribed) {
        const now = new Date();
        const reset = new Date(row.creditsResetAt || now);
        const needsReset =
          now.getUTCFullYear() !== reset.getUTCFullYear() ||
          now.getUTCMonth() !== reset.getUTCMonth();
        if (needsReset) {
          await db.run(
            `UPDATE users SET creditsRemaining = ?, creditsResetAt = datetime('now') WHERE id = ?`,
            [FREE_TIER_CREDITS, row.id]
          );
          row.creditsRemaining = FREE_TIER_CREDITS;
          row.creditsResetAt = new Date().toISOString();
        }
      }
      req.user.creditsRemaining = row.creditsRemaining ?? 0;
      req.user.creditsResetAt = row.creditsResetAt;
      req.user.isSubscribed = !!row.isSubscribed;
      req.user.role = row.role;
      next();
    } catch (e) {
      next(e);
    }
  };

  // requireAdmin — only allows role='admin'. Used by the /admin dashboard.
  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  };

  // --- Auth routes ---
  app.post('/api/auth/login', async (req: any, res: any) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    try {
      const user: any = await db.get(
        `SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1`,
        [username, username]
      );
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, user.password || '');
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SIGNING_KEY,
        { expiresIn: '30d' }
      );
      res.cookie('admin_token', token, {
        httpOnly: true,
        sameSite: IS_PROD ? 'strict' : 'lax',
        secure: IS_PROD,
        maxAge: 30 * 24 * 3600 * 1000,
      });
      res.json({
        message: 'Logged in',
        user: { id: user.id, username: user.username, role: user.role, email: user.email },
      });
    } catch (e: any) {
      console.error('[auth/login]', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.post('/api/auth/register', async (req: any, res: any) => {
    const { username, email, password, code } = req.body || {};
    if (!username || !password || !code) {
      return res.status(400).json({ error: 'username, password, and invite code required' });
    }
    if (code !== INVITE_CODE) {
      return res.status(403).json({ error: 'Invalid invitation code' });
    }
    try {
      const existing = await db.get(
        `SELECT id FROM users WHERE username = ? OR email = ?`,
        [username, email || null]
      );
      if (existing) return res.status(409).json({ error: 'User already exists' });
      const hash = await bcrypt.hash(password, 12);
      const r: any = await db.run(
        `INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, 'user')`,
        [username, email || null, hash]
      );
      const token = jwt.sign(
        { id: r.lastID, username, role: 'user' },
        JWT_SIGNING_KEY,
        { expiresIn: '30d' }
      );
      res.cookie('admin_token', token, {
        httpOnly: true,
        sameSite: IS_PROD ? 'strict' : 'lax',
        secure: IS_PROD,
        maxAge: 30 * 24 * 3600 * 1000,
      });
      res.json({ message: 'Account created', user: { id: r.lastID, username, role: 'user' } });
    } catch (e: any) {
      console.error('[auth/register]', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.post('/api/auth/logout', (req: any, res: any) => {
    res.clearCookie('admin_token');
    res.json({ message: 'Logged out' });
  });

  app.get('/api/auth/me', requireAuth, (req: any, res: any) => {
    res.json({ user: req.user });
  });

  // ===================================================================
  // Credits + pricing
  // ===================================================================
  app.get('/api/credits/balance', requireAuth, (req: any, res: any) => {
    res.json({
      credits: req.user.isSubscribed ? null : (req.user.creditsRemaining ?? 0),
      isSubscribed: !!req.user.isSubscribed,
      resetAt: req.user.creditsResetAt,
    });
  });

  app.get('/api/pricing', (req: any, res: any) => {
    // Detect the user's region from query param, then Accept-Language,
    // then a CF-IPCountry header (set by Cloudflare at the edge). The
    // frontend always sends `?region=cn|intl` based on the i18n locale
    // (so we don't surprise a user who manually switched to English).
    const region = (String(req.query.region || '').toLowerCase() === 'cn') ? 'cn' : 'intl';
    const currency: Currency = region === 'cn' ? 'cny' : 'usd';
    const paymentMethods = PAYMENT_METHODS_BY_CURRENCY[currency];
    res.json({
      credits: PRICING[currency].credits,
      hda: PRICING[currency].hda,
      currency,
      paymentMethods,
      // Surface both currencies so the UI can show a small toggle and
      // visitors can self-select. Frontend does NOT auto-flip.
      both: {
        usd: { credits: PRICING.usd.credits, hda: PRICING.usd.hda },
        cny: { credits: PRICING.cny.credits, hda: PRICING.cny.hda },
      },
      stripePublishableKey: STRIPE_PUBLISHABLE_KEY,
      freeTierCredits: FREE_TIER_CREDITS,
    });
  });

  // ----- Checkout: buy online credits -----
  app.post('/api/checkout/credits', requireAuth, async (req: any, res: any) => {
    const tierId = String(req.body?.tier || '');
    const currency = resolveCurrency(req.body?.currency);
    const tier = PRICING[currency].credits.find((t) => t.id === tierId);
    if (!tier) return res.status(400).json({ error: 'invalid_tier' });
    if (!STRIPE_SECRET_KEY) {
      return res.status(503).json({
        error: 'stripe_not_configured',
        message: 'Payments are not yet wired up. Set STRIPE_SECRET_KEY in api/.env to test.',
      });
    }
    const payment: any = await db.run(
      `INSERT INTO payments (userId, kind, tier, amountCents, creditsAdded, status, currency)
       VALUES (?, 'credits', ?, ?, ?, 'pending', ?)`,
      [req.user.id, tier.id, tier.amount, tier.credits, currency]
    );
    const paymentId = payment.lastID;
    const origin = `${req.protocol}://${req.get('host')}`;
    const methods = PAYMENT_METHODS_BY_CURRENCY[currency];
    const lineItemParams = buildLineItemParams(
      `HIP Path Doctor — ${tier.name} (${tier.credits} credits)`,
      tier.amount,
      currency,
      {
        kind: 'credits',
        userId: String(req.user.id),
        paymentId: String(paymentId),
        credits: String(tier.credits),
        tier: tier.id,
        currency,
      }
    );
    let session: any;
    try {
      session = await stripeCreate(STRIPE_SECRET_KEY, 'checkout/sessions', {
        mode: 'payment',
        success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing?canceled=1`,
        ...lineItemParams,
        ...paymentMethodTypesParams(methods),
      });
    } catch (e: any) {
      console.error('[checkout/credits] stripe error:', e);
      await db.run(`UPDATE payments SET status = 'failed' WHERE id = ?`, [paymentId]);
      return res.status(502).json({ error: 'stripe_error' });
    }
    await db.run(
      `UPDATE payments SET providerSessionId = ? WHERE id = ?`,
      [session.id, paymentId]
    );
    res.json({ url: session.url, sessionId: session.id });
  });

  // ----- Checkout: buy HDA license -----
  app.post('/api/checkout/hda', requireAuth, async (req: any, res: any) => {
    const tierId = String(req.body?.tier || '');
    const currency = resolveCurrency(req.body?.currency);
    const tier = PRICING[currency].hda.find((t) => t.id === tierId);
    if (!tier) return res.status(400).json({ error: 'invalid_tier' });
    if (!STRIPE_SECRET_KEY) {
      return res.status(503).json({
        error: 'stripe_not_configured',
        message: 'Payments are not yet wired up. Set STRIPE_SECRET_KEY in api/.env to test.',
      });
    }
    if (!fs.existsSync(HDA_FILE_PATH)) {
      return res.status(503).json({
        error: 'hda_not_deployed',
        message: `HDA binary not found at ${HDA_FILE_PATH}. Set HDA_FILE_PATH or drop the file there.`,
      });
    }
    const payment: any = await db.run(
      `INSERT INTO payments (userId, kind, tier, amountCents, status, currency)
       VALUES (?, 'hda', ?, ?, 'pending', ?)`,
      [req.user.id, tier.id, tier.amount, currency]
    );
    const paymentId = payment.lastID;
    const origin = `${req.protocol}://${req.get('host')}`;
    const methods = PAYMENT_METHODS_BY_CURRENCY[currency];
    const lineItemParams = buildLineItemParams(
      `yaopc::FolderPathFixed HDA — ${tier.name}`,
      tier.amount,
      currency,
      {
        kind: 'hda',
        userId: String(req.user.id),
        paymentId: String(paymentId),
        tier: tier.id,
        maxRuns: String(tier.maxRuns),
        durationDays: String(tier.durationDays),
        currency,
      }
    );
    let session: any;
    try {
      session = await stripeCreate(STRIPE_SECRET_KEY, 'checkout/sessions', {
        mode: 'payment',
        success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}&hda=1`,
        cancel_url: `${origin}/pricing?canceled=1`,
        ...lineItemParams,
        ...paymentMethodTypesParams(methods),
      });
    } catch (e: any) {
      console.error('[checkout/hda] stripe error:', e);
      await db.run(`UPDATE payments SET status = 'failed' WHERE id = ?`, [paymentId]);
      return res.status(502).json({ error: 'stripe_error' });
    }
    await db.run(
      `UPDATE payments SET providerSessionId = ? WHERE id = ?`,
      [session.id, paymentId]
    );
    res.json({ url: session.url, sessionId: session.id });
  });

  // ----- Success page metadata (used by /pricing/success to render the
  // right confirmation: "credits added" vs "HDA license ready to download") -----
  app.get('/api/payments/lookup', requireAuth, async (req: any, res: any) => {
    const sessionId = String(req.query.session_id || '');
    if (!sessionId) return res.status(400).json({ error: 'missing_session_id' });
    const row: any = await db.get(
      `SELECT id, kind, tier, creditsAdded, hdaLicenseKey, status, amountCents
       FROM payments WHERE providerSessionId = ? AND userId = ?`,
      [sessionId, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    // If it's an HDA purchase, also build a one-time signed download URL.
    let downloadUrl: string | null = null;
    if (row.kind === 'hda' && row.hdaLicenseKey) {
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const licRow: any = await db.get(
        `SELECT id FROM licenses WHERE key = ?`, [row.hdaLicenseKey]
      );
      await db.run(
        `INSERT INTO hdaDownloads (licenseId, token, expiresAt) VALUES (?, ?, ?)`,
        [licRow.id, token, expiresAt]
      );
      const sig = crypto
        .createHmac('sha256', DOWNLOAD_SIGN_SECRET)
        .update(`${token}:${licRow.id}:${expiresAt}`)
        .digest('hex')
        .slice(0, 32);
      downloadUrl = `/api/hda/download?token=${token}&license=${licRow.id}&exp=${encodeURIComponent(expiresAt)}&sig=${sig}`;
    }
    res.json({
      kind: row.kind,
      tier: row.tier,
      creditsAdded: row.creditsAdded,
      hdaLicenseKey: row.hdaLicenseKey,
      status: row.status,
      amountCents: row.amountCents,
      downloadUrl,
    });
  });

  // ----- HDA download (signed URL) -----
  app.get('/api/hda/download', async (req: any, res: any) => {
    const { token, license, exp, sig } = req.query;
    if (!token || !license || !exp || !sig) {
      return res.status(400).json({ error: 'missing_params' });
    }
    const expected = crypto
      .createHmac('sha256', DOWNLOAD_SIGN_SECRET)
      .update(`${token}:${license}:${exp}`)
      .digest('hex')
      .slice(0, 32);
    if (expected !== String(sig)) {
      return res.status(403).json({ error: 'bad_signature' });
    }
    if (new Date(String(exp)).getTime() < Date.now()) {
      return res.status(410).json({ error: 'expired' });
    }
    // Check DB for the token: must exist, not used, and not expired.
    const dlRow: any = await db.get(
      `SELECT * FROM hdaDownloads WHERE token = ? AND licenseId = ?`,
      [String(token), Number(license)]
    );
    if (!dlRow) return res.status(404).json({ error: 'token_not_found' });
    if (dlRow.usedAt) return res.status(410).json({ error: 'already_used' });
    if (new Date(dlRow.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'expired' });
    }
    if (!fs.existsSync(HDA_FILE_PATH)) {
      return res.status(503).json({ error: 'hda_not_deployed' });
    }
    // Mark as used (single-use token).
    await db.run(
      `UPDATE hdaDownloads SET usedAt = datetime('now') WHERE id = ?`,
      [dlRow.id]
    );
    const licRow: any = await db.get(
      `SELECT key, tier FROM licenses WHERE id = ?`, [Number(license)]
    );
    res.setHeader('Content-Type', 'application/x-houdini-asset');
    const fname = licRow
      ? `yaopc_FolderPathFixed_${licRow.tier}_${licRow.key.slice(0, 8)}.hda`
      : 'yaopc_FolderPathFixed.hda';
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    fs.createReadStream(HDA_FILE_PATH).pipe(res);
  });

  // ----- Admin: grant credits to a user (for testing / manual comps) -----
  app.post('/api/admin/credits/grant', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'admin_only' });
    }
    const userId = Number(req.body?.userId);
    const delta = Number(req.body?.delta || 0);
    if (!userId || !delta) {
      return res.status(400).json({ error: 'userId_and_delta_required' });
    }
    const row: any = await db.get(
      `SELECT creditsRemaining FROM users WHERE id = ?`, [userId]
    );
    if (!row) return res.status(404).json({ error: 'user_not_found' });
    const newRemaining = Math.max(0, (row.creditsRemaining ?? 0) + delta);
    await db.run(
      `UPDATE users SET creditsRemaining = ? WHERE id = ?`,
      [newRemaining, userId]
    );
    res.json({ ok: true, userId, creditsRemaining: newRemaining });
  });

  // ----- Admin: list users with credit balance (lightweight, for the
  // admin dashboard so we can grant/test without a DB client) -----
  app.get('/api/admin/credits/users', requireAuth, async (req: any, res: any) => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'admin_only' });
    }
    const rows: any[] = await db.all(
      `SELECT id, username, email, role, creditsRemaining, creditsResetAt, isSubscribed
       FROM users ORDER BY id`
    );
    res.json({ users: rows });
  });

  // ===================================================================
  // Resources (public read + admin write)
  // ===================================================================
  app.get('/api/resources', async (_req: any, res: any) => {
    const rows: any[] = await db.all(
      `SELECT id, title, description, category, tags, imageUrl, fileUrl, panCode, downloadCount, createdAt, updatedAt, tagGroups
       FROM resources ORDER BY createdAt DESC`
    );
    res.json(rows);
  });

  app.get('/api/resources/:id', async (req: any, res: any) => {
    const row: any = await db.get(
      `SELECT id, title, description, category, tags, imageUrl, fileUrl, panCode, downloadCount, createdAt, updatedAt, tagGroups
       FROM resources WHERE id = ?`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(row);
  });

  app.post('/api/resources/:id/download', async (req: any, res: any) => {
    const id = Number(req.params.id);
    await db.run(`UPDATE resources SET downloadCount = downloadCount + 1 WHERE id = ?`, [id]);
    const row: any = await db.get(`SELECT downloadCount FROM resources WHERE id = ?`, [id]);
    res.json({ ok: true, downloadCount: row?.downloadCount ?? 0 });
  });

  // ===================================================================
  // Admin resource management
  // ===================================================================
  const adminUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.resolve(__dirname, '..', 'data', 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const stem = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${stem}_${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  app.post(
    '/api/admin/resources',
    requireAuth,
    requireAdmin,
    adminUpload.single('file'),
    async (req: any, res: any) => {
      const { title, description, category, tags, imageUrl, tagGroups } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title required' });
      const fileUrl = req.file ? `/api/files/${req.file.filename}` : (req.body?.fileUrl || '#');
      const r: any = await db.run(
        `INSERT INTO resources (title, description, category, tags, imageUrl, fileUrl, tagGroups)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [title, description || '', category || '', tags || '[]', imageUrl || '', fileUrl, tagGroups || null]
      );
      res.json({ ok: true, id: r.lastID });
    }
  );

  app.put('/api/admin/resources/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const { title, description, category, tags, imageUrl, tagGroups,
            fileUrl, panCode, renderEngine } = req.body || {};

    // If the admin submitted a `renderEngine` (used as a manual
    // override when the parser couldn't read it — see manage.py
    // set-renderer), splice it into tagGroups before persisting.
    let tagGroupsStr: string | null = tagGroups ?? null;
    if (renderEngine !== undefined) {
      let tg: any = {};
      try {
        tg = tagGroupsStr ? JSON.parse(tagGroupsStr) : {};
      } catch { /* leave as {} */ }
      if (renderEngine === null || renderEngine === '') {
        delete tg.renderEngine;
      } else {
        tg.renderEngine = renderEngine;
      }
      tagGroupsStr = JSON.stringify(tg);
    }

    await db.run(
      `UPDATE resources SET title = ?, description = ?, category = ?, tags = ?,
       imageUrl = ?, tagGroups = ?, fileUrl = ?, panCode = ?,
       updatedAt = datetime('now') WHERE id = ?`,
      [title, description, category, tags, imageUrl, tagGroupsStr,
       fileUrl ?? null, panCode ?? null, id]
    );
    res.json({ ok: true });
  });

  app.delete('/api/admin/resources/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    await db.run(`DELETE FROM resources WHERE id = ?`, [id]);
    // Blend assets keep files under data/blend_assets/<id>/ — clean up
    // so deleted resources don't leave hundreds of MB behind.
    const assetDir = path.join(BLEND_ASSETS_DIR, String(id));
    if (fs.existsSync(assetDir)) {
      try { fs.rmSync(assetDir, { recursive: true, force: true }); } catch {}
    }
    res.json({ ok: true });
  });

  // ===================================================================
  // Blend asset upload (2026-08-23)
  //
  // Admin posts a .blend + (optional) sibling textures.zip. The server:
  //   1. copies the .blend into data/blend_assets/<id>/source.blend
  //   2. unzips textures.zip into data/blend_assets/<id>/textures/ if any
  //   3. calls blend_texture_fixer.py to rewrite image paths to
  //      `textures/<basename>` and saves a "fixed" .blend
  //   4. calls blend_asset_parser.py to emit a manifest.json
  //   5. INSERTs a new resources row with the manifest in tagGroups
  //
  // Rationale for the dedicated endpoint vs. extending the existing
  // /api/admin/resources: the existing handler assumes one file and a
  // single title/category/tag set. A blend asset also needs:
  //   - parallel textures.zip upload
  //   - long-running blender subprocess (parsers run 3–10s, can hit
  //     vite proxy timeout if fired inline)
  //   - per-resource file layout under data/blend_assets/<id>/
  // Cleaner to keep the original handler untouched and add a sibling
  // route. The frontend's admin page can dispatch to the right one
  // based on file extension.
  // ===================================================================
  const BLEND_PARSER_SCRIPT = path.resolve(
      __dirname, 'tools', 'blend_asset_parser.py');
    const BLEND_FIXER_SCRIPT = path.resolve(
      __dirname, 'tools', 'blend_texture_fixer.py');
    const BLEND_EXTRACTOR_SCRIPT = path.resolve(
      __dirname, 'tools', 'blend_asset_extractor.py');
    const BLEND_THUMBNAIL_SCRIPT = path.resolve(
      __dirname, 'tools', 'blend_thumbnail_render.py');
    const BLEND_ASSETS_DIR = path.resolve(__dirname, '..', 'data', 'blend_assets');
    const BLENDER_EXE = process.env.BLENDER_EXE || 'D:/Blender/blender.exe';
    const BLEND_MAX_BYTES = parseInt(
      process.env.BLEND_MAX_BYTES || String(1024 * 1024 * 1024), 10);  // 1 GB

  const blendAssetUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        if (!fs.existsSync(BLEND_ASSETS_DIR)) {
          fs.mkdirSync(BLEND_ASSETS_DIR, { recursive: true });
        }
        cb(null, BLEND_ASSETS_DIR);
      },
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      },
    }),
    limits: { fileSize: BLEND_MAX_BYTES },
  });

  function spawnBlender(env: Record<string, string>, script: string): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      // Blender on Windows accepts only Win-style backslash absolute paths
      // via its file API. Forward-slash absolute paths get treated as
      // relative (joined with the subprocess cwd). Normalise here.
      const normEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(env)) {
        normEnv[k] = path.win32.normalize(v);
      }
      // blender.exe -b -P <script.py> — -P requires an explicit path
      // even in headless mode. We pass the absolute script path here
      // because the parser / fixer / extractor scripts live next to
      // server.ts in /api/tools/.
      const proc = spawn(BLENDER_EXE, ['-b', '-P', path.win32.normalize(script)], {
        env: { ...process.env, ...normEnv },
        windowsHide: true,
      });
      let stdout = '', stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
  }

  // Walk stdout (or stderr) for our === XXX SUMMARY === marker block.
  // The subprocess prints JSON between two markers so the API can parse
  // it without fighting opalias/oplib noise on stderr.
  function extractSummary(text: string, marker: string): any | null {
    if (!text) return null;
    const m = text.match(
      new RegExp('===\\s+' + marker + '\\s+===\\s*\\n([\\s\\S]*?)\\n===\\s+/' +
                 marker + '\\s+==='));
    if (!m) {
      console.warn('[extractSummary] no match for marker', marker,
        'in text length', text.length, 'first 200 chars:', text.slice(0, 200));
      return null;
    }
    try { return JSON.parse(m[1]); }
    catch (e: any) {
      console.warn('[extractSummary] JSON parse failed for marker', marker,
        ':', e?.message, 'first 200 chars of match:', m[1].slice(0, 200));
      return null;
    }
  }

  app.post(
    '/api/admin/blend-assets',
    requireAuth,
    requireAdmin,
    toolLimiter,
    blendAssetUpload.fields([
      { name: 'blend', maxCount: 1 },
      { name: 'textures', maxCount: 1 },
    ]),
    async (req: any, res: any) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const blendFile = files?.blend?.[0];
      const texFile = files?.textures?.[0];
      if (!blendFile) {
        return res.status(400).json({ error: 'blend file required' });
      }
      const ext = path.extname(blendFile.originalname).toLowerCase();
      if (ext !== '.blend') {
        return res.status(400).json({ error: 'only .blend accepted on the blend field' });
      }

      const { title, description, category, tags } = req.body || {};
      if (!title) return res.status(400).json({ error: 'title required' });

      // Reserve a stable id BEFORE the long blender calls so the file
      // layout is final. We insert with a temporary tagGroups value
      // and patch it once parsing finishes.
      const initial = await db.run(
        `INSERT INTO resources (title, description, category, tags, imageUrl, fileUrl, tagGroups)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [title, description || '', category || 'blend', tags || '[]',
         '', `/api/blend-assets/pending`, JSON.stringify({ status: 'processing' })]
      );
      const resourceId = Number(initial.lastID);
      const assetDir = path.join(BLEND_ASSETS_DIR, String(resourceId));
      fs.mkdirSync(assetDir, { recursive: true });
      const sourceBlend = path.join(assetDir, 'source.blend');
      fs.copyFileSync(blendFile.path, sourceBlend);
      // Clean up the multer staging copy (it lives in BLEND_ASSETS_DIR/<ts>_name).
      try { fs.unlinkSync(blendFile.path); } catch {}

      // Unpack textures.zip next to source.blend so fixer can see them.
      // CGTrader zips often have a top-level folder like
      // `JF0L506A3_textures/`. We flatten that — every nested file
      // ends up directly under texDir so the fixer's
      // `textures/<basename>` rewrite actually finds them.
      const texDir = path.join(assetDir, 'textures');
      let texturesUnpacked = 0;
      let texturesZipMissing = false;
      if (texFile) {
        fs.mkdirSync(texDir, { recursive: true });
        const zipPath = texFile.path;
        try {
          // First pass: unzip into a staging dir preserving structure.
          const stageDir = path.join(assetDir, '_textures_stage');
          if (fs.existsSync(stageDir)) {
            fs.rmSync(stageDir, { recursive: true, force: true });
          }
          fs.mkdirSync(stageDir, { recursive: true });
          execSync(
            `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${stageDir}' -Force"`,
            { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }
          );
          // Flatten: walk stage, copy every regular file to texDir using
          // its basename. If two files share a basename, last-wins with
          // a warning — but for textures that's basically never.
          const seen = new Map<string, string>();
          const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, e.name);
              if (e.isDirectory()) walk(full);
              else if (e.isFile()) {
                const base = path.basename(full);
                if (seen.has(base) && seen.get(base) !== full) {
                  console.warn('[blend-asset] duplicate texture basename',
                    base, '<-', seen.get(base), 'overwritten by', full);
                }
                fs.copyFileSync(full, path.join(texDir, base));
                seen.set(base, full);
              }
            }
          };
          walk(stageDir);
          texturesUnpacked = fs.readdirSync(texDir).length;
          fs.rmSync(stageDir, { recursive: true, force: true });
        } catch (e: any) {
          console.warn('[blend-asset] Expand-Archive failed, trying python zipfile:', e?.message);
          try {
            execSync(
              `python -c "import zipfile,os; zipfile.ZipFile(r'${zipPath}').extractall(r'${texDir}')"`,
              { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 }
            );
            // Flatten similarly
            const seen = new Map<string, string>();
            const walk = (dir: string) => {
              for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walk(full);
                else if (e.isFile()) {
                  const base = path.basename(full);
                  fs.copyFileSync(full, path.join(texDir, base));
                  seen.set(base, full);
                }
              }
            };
            walk(texDir);
            texturesUnpacked = fs.readdirSync(texDir).length;
          } catch (e2: any) {
            console.error('[blend-asset] both extract methods failed:', e2?.message);
            return res.status(500).json({
              error: 'texture_zip_extract_failed',
              detail: e2?.message,
              resourceId,
            });
          }
        }
        try { fs.unlinkSync(texFile.path); } catch {}
      } else {
        // Heuristic — no zip uploaded. Scan the blend's recorded
        // filepath's parent (e.g. //..\\Animal_textures\\) and the blend
        // dir itself for sibling textures. Most CGTrader packs ship
        // with a single sibling <name>_textures folder or zip.
        texturesZipMissing = true;
      }

      // 1) Run texture fixer: rewrite all image paths to `textures/<basename>`.
      const fixedBlend = path.join(assetDir, 'fixed.blend');
      try {
        const fixerEnv: Record<string, string> = {
          BLEND_TEXTURE_FIXER_INPUT: sourceBlend,
          BLEND_TEXTURE_FIXER_OUTPUT: fixedBlend,
          BLEND_TEXTURE_FIXER_TEXDIR: texDir,
        };
        const { stdout, stderr } = await spawnBlender(fixerEnv, BLEND_FIXER_SCRIPT);
        const summary = extractSummary(stdout, 'FIXER SUMMARY')
          || extractSummary(stderr, 'FIXER SUMMARY');
        if (!summary || !summary.ok) {
          console.error('[blend-asset] fixer failed', { stdout, stderr });
          return res.status(500).json({
            error: 'fixer_failed',
            stdout: stdout.slice(-2000),
            stderr: stderr.slice(-2000),
            resourceId,
          });
        }
      } catch (e: any) {
        return res.status(500).json({ error: 'fixer_spawn_failed', detail: e?.message, resourceId });
      }

      // 2) Run parser on the fixed blend so the manifest matches the
      //    texture paths we just rewrote.
      const manifestPath = path.join(assetDir, 'manifest.json');
      try {
        const parserEnv: Record<string, string> = {
          BLEND_ASSET_PARSER_INPUT: fixedBlend,
          BLEND_ASSET_PARSER_OUTPUT: manifestPath,
        };
        const { stdout, stderr } = await spawnBlender(parserEnv, BLEND_PARSER_SCRIPT);
        const summary = extractSummary(stdout, 'PARSER SUMMARY')
          || extractSummary(stderr, 'PARSER SUMMARY');
        if (!summary || !summary.ok) {
          return res.status(500).json({
            error: 'parser_failed',
            stdout: stdout.slice(-2000),
            stderr: stderr.slice(-2000),
            resourceId,
          });
        }
      } catch (e: any) {
        return res.status(500).json({ error: 'parser_spawn_failed', detail: e?.message, resourceId });
      }

      // 3) Build the manifest summary the frontend will render, and
      //    patch the resources row. The full raw manifest lives on disk
      //    so we don't bloat the DB; the tagGroups column carries a
      //    compact summary.
      let rawManifest: any = {};
      try {
        rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (e) {
        console.warn('[blend-asset] failed to read manifest.json:', e);
      }

      const sceneMeta = rawManifest.scene || {};
      const tagGroups = {
              status: 'ready',
              schema: 'blend-asset-v1',
              resourceId,
              sourceBlend: 'source.blend',
              fixedBlend: 'fixed.blend',
              manifestPath: 'manifest.json',
              texturesDir: 'textures/',
              texturesUnpacked,
              texturesZipMissing,
              blenderVersion: rawManifest.blend?.blender_version || null,
              // Scene render / timing spec (added 2026-08-24 for the
              // Resource Detail "Spec" section). Newer manifests have
              // these populated by blend_asset_parser.py; older ones
              // will be missing fields and the UI falls back to N/A.
              frameStart: sceneMeta.frame_start ?? null,
              frameEnd: sceneMeta.frame_end ?? null,
              fps: sceneMeta.fps ?? null,
              resolutionX: sceneMeta.resolution_x ?? null,
              resolutionY: sceneMeta.resolution_y ?? null,
              aspectRatio: sceneMeta.aspect_ratio ?? null,
              renderEngine: sceneMeta.render_engine ?? null,
              lightSetup: sceneMeta.light_setup ?? null,
              summary: {
                assets: (rawManifest.assets || []).map((a: any) => ({
                  id: a.id,
                  name: a.name,
                  type: a.type,
                  parentCollection: a.parent_collection,
                  instanceCount: a.instance_count || 1,
                  vertCount: a.vert_count,
                  triCount: a.tri_count,
                  materialCount: a.material_count,
                  textureCount: a.texture_count,
                  hasArmature: a.has_armature,
                })),
                assetCount: rawManifest.assets?.length || 0,
                actionCount: rawManifest.actions?.length || 0,
                actions: (rawManifest.actions || []).map((a: any) => ({
                  name: a.name, frames: [a.frame_start, a.frame_end],
                  durationSeconds: a.duration_seconds,
                })),
                textureCount: rawManifest.textures?.length || 0,
                missingTextures: (rawManifest.textures || [])
                  .filter((t: any) => t.source === 'missing').length,
                warnings: rawManifest.warnings || [],
              },
            };

            // imageUrl points to the thumbnail endpoint. The PNG is rendered
            // asynchronously below so the user's browser starts polling
            // shortly after upload completes.
            const imageUrl = `/api/blend-assets/${resourceId}/thumbnail`;
            const fileUrl = `/api/blend-assets/${resourceId}`;

            await db.run(
              `UPDATE resources SET imageUrl = ?, fileUrl = ?, tagGroups = ?, updatedAt = datetime('now')
               WHERE id = ?`,
              [imageUrl, fileUrl, JSON.stringify(tagGroups), resourceId]
            );

            // ---- Fire-and-forget: render thumbnail asynchronously ----
            // The user already has enough info to render the detail page
            // (asset list, stats), so we don't block the upload response on
            // the thumbnail. The card imageUrl will 404 until the render
            // finishes — that's acceptable; the user sees a gradient fallback.
            const thumbnailPath = path.join(assetDir, 'thumbnail.png');
            (async () => {
              try {
                const env: Record<string, string> = {
                  BLEND_THUMBNAIL_INPUT: fixedBlend,
                  BLEND_THUMBNAIL_OUTPUT: thumbnailPath,
                  BLEND_THUMBNAIL_SIZE: '2048',
                };
                const { stdout, stderr } = await spawnBlender(env, BLEND_THUMBNAIL_SCRIPT);
                const summary = extractSummary(stdout, 'THUMB SUMMARY')
                  || extractSummary(stderr, 'THUMB SUMMARY');
                if (summary && summary.ok && fs.existsSync(thumbnailPath)) {
                  // Patch the row with thumbnail_ready flag so the frontend
                  // knows the card image is live (or could refetch).
                  try {
                    const cur = await db.get(
                      `SELECT tagGroups FROM resources WHERE id = ?`, [resourceId]);
                    if (cur && cur.tagGroups) {
                      const tg = safeJson(cur.tagGroups) || {};
                      tg.thumbnailReady = true;
                      await db.run(
                        `UPDATE resources SET tagGroups = ? WHERE id = ?`,
                        [JSON.stringify(tg), resourceId]);
                    }
                  } catch (e) {
                    console.warn('[blend-asset] thumbnail_ready patch failed:', e);
                  }
                } else {
                  console.error('[blend-asset] thumbnail render failed:',
                    { stdout: stdout.slice(-500), stderr: stderr.slice(-500) });
                }
              } catch (e: any) {
                console.error('[blend-asset] thumbnail spawn failed:', e?.message);
              }
            })();

            res.json({
              ok: true,
              id: resourceId,
              title,
              manifest: tagGroups,
            });
          }
        );

  // ===================================================================
    // Blend asset download (2026-08-23, refactored 2026-08-23 evening)
    //
    // Each asset in a blend is downloadable separately. Output is
    // cached on disk keyed by asset_id.
    // ===================================================================

    // Helper used by both the list and the download: read manifest,
    // snapshot into compact form, return 409 if asset not ready.
    async function loadAssetManifest(id: number): Promise<any | null> {
      const row: any = await db.get(
        `SELECT tagGroups FROM resources WHERE id = ?`, [id]);
      if (!row) return null;
      const tg = safeJson(row.tagGroups);
      if (!tg || tg.schema !== 'blend-asset-v1' || tg.status !== 'ready') {
        return null;
      }
      return tg;
    }

    // GET /api/blend-assets/:id/assets — list every asset in this blend
    app.get('/api/blend-assets/:id/assets', async (req: any, res: any) => {
      const id = Number(req.params.id);
      const tg = await loadAssetManifest(id);
      if (!tg) return res.status(404).json({ error: 'not_found_or_not_ready' });
      res.json({
        id,
        assets: tg.summary.assets || [],
        assetCount: tg.summary.assetCount || 0,
        blenderVersion: tg.blenderVersion,
        actionCount: tg.summary.actionCount,
        textureCount: tg.summary.textureCount,
        missingTextures: tg.summary.missingTextures,
      });
    });

    // GET /api/blend-assets/:id/assets/:aid/download — single asset zip
    app.get('/api/blend-assets/:id/assets/:aid/download',
      async (req: any, res: any) => {
        const id = Number(req.params.id);
        const aid = decodeURIComponent(req.params.aid);
        const tg = await loadAssetManifest(id);
        if (!tg) return res.status(404).json({ error: 'not_found_or_not_ready' });
        const asset = (tg.summary.assets || []).find((a: any) => a.id === aid);
        if (!asset) return res.status(404).json({ error: 'asset_not_in_manifest' });

        const assetDir = path.join(BLEND_ASSETS_DIR, String(id));
        const cacheDir = path.join(assetDir, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        const safeAid = aid.replace(/[^a-zA-Z0-9._-]/g, '_');
        const zipOut = path.join(cacheDir, safeAid + '.zip');

        if (!fs.existsSync(zipOut)) {
          const fixedBlend = path.join(assetDir, 'fixed.blend');
          const texDir = path.join(assetDir, 'textures');
          const manifestPath = path.join(assetDir, 'manifest.json');
          try {
            const env: Record<string, string> = {
              BLEND_EXTRACTOR_INPUT: fixedBlend,
              BLEND_EXTRACTOR_OUTPUT: zipOut,
              BLEND_EXTRACTOR_TEXDIR: texDir,
              BLEND_EXTRACTOR_ASSET: aid,
              BLEND_EXTRACTOR_MANIFEST: manifestPath,
            };
            const { stdout, stderr } = await spawnBlender(env, BLEND_EXTRACTOR_SCRIPT);
            const summary = extractSummary(stdout, 'EXTRACTOR SUMMARY')
              || extractSummary(stderr, 'EXTRACTOR SUMMARY');
            if (!summary || !summary.ok) {
              console.error('[blend-asset] extractor failed for asset', aid,
                { stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) });
              return res.status(500).json({
                error: 'extractor_failed',
                asset: aid,
                detail: (stdout + '\n' + stderr).slice(-2000),
              });
            }
          } catch (e: any) {
            return res.status(500).json({
              error: 'extractor_spawn_failed',
              asset: aid,
              detail: e?.message,
            });
          }
        }

        // Bump download counter for the parent resource (one click
        // = one download regardless of how many times the user hits
        // the same asset URL).
        await db.run(
          `UPDATE resources SET downloadCount = downloadCount + 1 WHERE id = ?`,
          [id]);

        const stat = fs.statSync(zipOut);
        const filename = `${safeAid}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', String(stat.size));
        res.setHeader('Content-Disposition',
          `attachment; filename="${filename}"`);
        fs.createReadStream(zipOut).pipe(res);
      }
    );

    // GET /api/blend-assets/:id/thumbnail — render preview PNG. If the
    // async background render hasn't finished yet, returns 404 so the
    // frontend can show a gradient placeholder.
    app.get('/api/blend-assets/:id/thumbnail', async (req: any, res: any) => {
      const id = Number(req.params.id);
      const thumb = path.join(BLEND_ASSETS_DIR, String(id), 'thumbnail.png');
      if (!fs.existsSync(thumb)) return res.status(404).end();
      // Self-heal the thumbnailReady flag: older uploads rendered the PNG
      // fine but the async DB patch never landed, leaving the frontend
      // stuck on "Thumbnail generating…" forever. If the file exists the
      // render clearly succeeded — flip the flag once and move on.
      try {
        const row: any = await db.get(
          `SELECT tagGroups FROM resources WHERE id = ?`, [id]);
        const tg = safeJson(row?.tagGroups);
        if (tg && tg.schema === 'blend-asset-v1' && tg.thumbnailReady !== true) {
          tg.thumbnailReady = true;
          await db.run(`UPDATE resources SET tagGroups = ? WHERE id = ?`,
            [JSON.stringify(tg), id]);
        }
      } catch { /* best-effort */ }
      res.setHeader('Content-Type', 'image/png');
      // Short cache: thumbnails can be re-rendered (e.g. after a render
      // engine fix), and stale black-white previews confused the user.
      // 5 minutes is enough to absorb burst traffic without pinning
      // outdated images for an hour.
      res.setHeader('Cache-Control', 'public, max-age=300');
      fs.createReadStream(thumb).pipe(res);
    });

    // GET /api/blend-assets/:id/renders — list per-camera renders on disk.
    // thumbnail.png (first camera) + camera_<Name>.png for the rest.
    //
    // Dedupe: if thumbnail.png is byte-identical to any camera_*.png
    // (the historical case — thumbnail was copied from the first
    // camera), drop the duplicate so the UI doesn't show the same
    // image twice under two different "Camera_1" entries.
    app.get('/api/blend-assets/:id/renders', async (req: any, res: any) => {
      const id = Number(req.params.id);
      const dir = path.join(BLEND_ASSETS_DIR, String(id));
      if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not_found' });
      const all = fs.readdirSync(dir)
        .filter((f) => f === 'thumbnail.png' || /^camera_.+\.png$/.test(f));
      const thumbPath = path.join(dir, 'thumbnail.png');
      let thumbBytes: Buffer | null = null;
      if (all.includes('thumbnail.png')) {
        thumbBytes = fs.readFileSync(thumbPath);
        const dup = all.find((f) =>
          f !== 'thumbnail.png' &&
          fs.readFileSync(path.join(dir, f)).equals(thumbBytes)
        );
        if (dup) {
          // Identical bytes — drop the thumbnail. The camera_*.png entry
          // already represents this view; keeping both would render twice.
          all.splice(all.indexOf('thumbnail.png'), 1);
        }
      }
      const files = all.sort((a, b) =>
        (a === 'thumbnail.png' ? -1 : b === 'thumbnail.png' ? 1 : a.localeCompare(b)));
      res.json({
        id,
        renders: files.map((f) => ({
          file: f,
          url: `/api/blend-assets/${id}/renders/${encodeURIComponent(f)}`,
          camera: f === 'thumbnail.png'
            ? (path.basename(files[1] || '').replace(/^camera_/, '').replace(/\.png$/, '') || 'default')
            : f.replace(/^camera_/, '').replace(/\.png$/, ''),
        })),
      });
    });

    // GET /api/blend-assets/:id/renders/:file — stream one render PNG.
    app.get('/api/blend-assets/:id/renders/:file', async (req: any, res: any) => {
      const id = Number(req.params.id);
      const file = path.basename(String(req.params.file)); // no traversal
      if (!/^(thumbnail|camera_.+)\.png$/.test(file)) {
        return res.status(400).json({ error: 'bad_file' });
      }
      const fp = path.join(BLEND_ASSETS_DIR, String(id), file);
      if (!fs.existsSync(fp)) return res.status(404).end();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=300');
      fs.createReadStream(fp).pipe(res);
    });

    // GET /api/blend-assets/:id/manifest — raw manifest.json for debug
    app.get('/api/blend-assets/:id/manifest', async (req: any, res: any) => {
      const id = Number(req.params.id);
      const mp = path.join(BLEND_ASSETS_DIR, String(id), 'manifest.json');
      if (!fs.existsSync(mp)) return res.status(404).end();
      res.setHeader('Content-Type', 'application/json');
      fs.createReadStream(mp).pipe(res);
    });

    // (2026-08-24) all asset downloads go via the resource's baidu-pan share
    // link (resources.fileUrl), set by the admin.

  // Static file serving for uploaded resources (admin uploads land here).
  app.use('/api/files', express.static(path.resolve(__dirname, '..', 'data', 'uploads')));

  // ===================================================================
  // Admin: users + invites
  // ===================================================================
  app.get('/api/admin/users', requireAuth, requireAdmin, async (_req: any, res: any) => {
    const users: any[] = await db.all(
      `SELECT id, username, email, role, creditsRemaining, creditsResetAt, isSubscribed, createdAt
       FROM users ORDER BY id`
    );
    res.json({ users });
  });

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      return res.status(400).json({ error: 'cannot_delete_self' });
    }
    const row: any = await db.get(`SELECT role FROM users WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (row.role === 'admin') {
      const otherAdmins: any = await db.get(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?`,
        [id]
      );
      if ((otherAdmins?.c ?? 0) === 0) {
        return res.status(409).json({ error: 'cannot_delete_last_admin' });
      }
    }
    await db.run(`DELETE FROM users WHERE id = ?`, [id]);
    res.json({ ok: true });
  });

  app.post('/api/admin/users/:id/toggle-admin', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const row: any = await db.get(`SELECT role FROM users WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const newRole = row.role === 'admin' ? 'user' : 'admin';
    // Last-admin guard: refuse to demote if this is the only admin left
    // (would lock the entire site out of the admin dashboard).
    if (row.role === 'admin' && newRole === 'user') {
      const otherAdmins: any = await db.get(
        `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?`,
        [id]
      );
      if ((otherAdmins?.c ?? 0) === 0) {
        return res.status(409).json({ error: 'cannot_demote_last_admin' });
      }
    }
    await db.run(`UPDATE users SET role = ? WHERE id = ?`, [newRole, id]);
    res.json({ ok: true, role: newRole });
  });

  app.post('/api/admin/users/:id/toggle-subscribe', requireAuth, requireAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    const row: any = await db.get(`SELECT isSubscribed FROM users WHERE id = ?`, [id]);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const newVal = row.isSubscribed ? 0 : 1;
    await db.run(`UPDATE users SET isSubscribed = ? WHERE id = ?`, [newVal, id]);
    res.json({ ok: true, isSubscribed: !!newVal });
  });

  app.get('/api/admin/invites', requireAuth, requireAdmin, async (_req: any, res: any) => {
    const rows: any[] = await db.all(
      `SELECT id, code, createdBy, usedBy, createdAt, usedAt FROM invites ORDER BY id DESC`
    );
    res.json({ invites: rows });
  });

  app.post('/api/admin/invites', requireAuth, requireAdmin, async (req: any, res: any) => {
    const code = String(req.body?.code || '').trim();
    if (!code) {
      // Generate a random 16-char invite code if not provided.
      const generated = crypto.randomBytes(8).toString('hex');
      await db.run(
        `INSERT INTO invites (code, createdBy) VALUES (?, ?)`,
        [generated, req.user.id]
      );
      return res.json({ ok: true, code: generated });
    }
    await db.run(
      `INSERT INTO invites (code, createdBy) VALUES (?, ?)`,
      [code, req.user.id]
    );
    res.json({ ok: true, code });
  });

  // ===================================================================
  // HIP Path Doctor tool — upload .hip, run hython, stream back a zip
  // containing the fixed .hip + the audit .md
  //
  // All three tool routes share a single helper (see
  // server/lib/toolEndpoint.ts) — this is the spec that drives it.
  // ===================================================================
  const HYTHON_PATH_LOCAL = HYTHON_PATH;
  const HIP_PATH_DOCTOR_TMP_LOCAL = HIP_PATH_DOCTOR_TMP;
  const HIP_PATH_DOCTOR_MAX_BYTES_LOCAL = HIP_PATH_DOCTOR_MAX_BYTES;

  const hipPathDoctorUpload = makeToolUpload({
    tmpDirRoot: HIP_PATH_DOCTOR_TMP_LOCAL,
    maxBytes: HIP_PATH_DOCTOR_MAX_BYTES_LOCAL,
    fileFilter: (name) => {
      const lower = name.toLowerCase();
      if (lower.endsWith('.hip') || lower.endsWith('.hipnc')) return null;
      return new Error('Only .hip and .hipnc files are allowed.');
    },
  });

  function rmDirSafe(dir: string) {
    try {
      if (dir && fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) { /* ignore */ }
  }

  // Read the .hip text header and pull out HIPFILE / JOB env defaults so
  // hython's $HIP doesn't get reset to the upload directory.
  function parseHipEnvDefaults(hipPath: string): { hipBase: string; jobBase: string } {
    let hipBase = '';
    let jobBase = '';
    try {
      const fd = fs.openSync(hipPath, 'r');
      const buf = Buffer.alloc(8192);
      const bytes = fs.readSync(fd, buf, 0, 8192, 0);
      fs.closeSync(fd);
      const header = buf.subarray(0, bytes).toString('utf-8');
      const hipfileMatch = header.match(/HIPFILE\s*=\s*'([^']+)'/);
      const jobMatch = header.match(/\bJOB\s*=\s*'([^']+)'/);
      if (hipfileMatch) {
        const hipfilePath = hipfileMatch[1].replace(/\\/g, '/');
        const parent = hipfilePath.replace(/\/[^/]+$/, '').replace(/\/+$/, '');
        if (parent) hipBase = parent;
      }
      if (jobMatch) jobBase = jobMatch[1].replace(/\\/g, '/');
    } catch (e) {
      console.warn('[tool] parseHipEnvDefaults failed for', hipPath, e);
    }
    return { hipBase, jobBase };
  }

  // Glue the spec into the helper. The closure below is what runs in
  // the request lifecycle — same shape as the original endpoint.
  const hipPathDoctorSpec: ToolEndpointSpec = {
    name: 'hip-path-doctor',
    hythonPath: HYTHON_PATH_LOCAL,
    tmpDirRoot: HIP_PATH_DOCTOR_TMP_LOCAL,
    maxBytes: HIP_PATH_DOCTOR_MAX_BYTES_LOCAL,
    scriptPath: HIP_PATH_DOCTOR_SCRIPT,
    headers: {
      summary: 'X-Path-Doctor-Summary',
      result: 'X-Path-Doctor-Result',
      credits: 'X-Path-Doctor-Credits',
    },
    resultMarker: 'HIP DOCTOR RESULT',
    validate: (req) => {
      const feature = parseInt(String(req.body?.feature ?? ''), 10);
      if (![0, 1, 2, 3].includes(feature)) {
        return 'feature must be 0, 1, 2, or 3.';
      }
      return null;
    },
    buildArgs: (ctx) => {
      const feature = parseInt(String(ctx.req.body?.feature ?? '0'), 10);
      const envDefaults = parseHipEnvDefaults(ctx.inputPath);
      const args: string[] = [
        HIP_PATH_DOCTOR_SCRIPT,
        ctx.inputPath,
        path.join(ctx.tmpDir, ctx.origStem + ctx.origExt),
        '--feature', String(feature),
        '--input-name', ctx.origName,
      ];
      if (envDefaults.hipBase) args.push('--hip-base', envDefaults.hipBase);
      if (envDefaults.jobBase) args.push('--job-base', envDefaults.jobBase);
      if (feature === 1) {
        args.push('--old', String(ctx.req.body?.old ?? ''));
        args.push('--new', String(ctx.req.body?.new ?? ''));
      } else if (feature === 3) {
        args.push('--direction', String(parseInt(String(ctx.req.body?.direction ?? '0'), 10)));
        args.push('--base', String(parseInt(String(ctx.req.body?.base ?? '0'), 10)));
        if (ctx.req.body?.customBase) args.push('--custom-base', String(ctx.req.body.customBase));
      }
      return args;
    },
    outputHipPath: (ctx) => path.join(ctx.tmpDir, ctx.origStem + ctx.origExt),
    outputMdPath: (ctx) =>
      path.join(ctx.tmpDir, ctx.origStem + '_NexArt_hippathdoctor.md'),
  };

  app.post(
    '/api/tools/hip-path-doctor/run',
    requireAuth,
    toolLimiter,
    (req: any, res: any, next: any) => {
      hipPathDoctorUpload.single('file')(req, res, (err: any) => {
        if (err) {
          rmDirSafe((req as any).toolTmpDir);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `File too large. Max ${(HIP_PATH_DOCTOR_MAX_BYTES_LOCAL / 1024 / 1024).toFixed(0)} MB.`,
            });
          }
          return res.status(400).json({ error: err.message || 'Upload failed.' });
        }
        next();
      });
    },
    createToolEndpoint(hipPathDoctorSpec)
  );

  // ===================================================================
  // HIP Format Bridge endpoint — /api/tools/hip-format-bridge/run
  // Mirrors the hip-path-doctor route: multer upload → spawn CLI → zip
  // stream back. Same credit gate, same audit MD, same zip layout.
  // ===================================================================
  const HIP_FORMAT_BRIDGE_TMP_LOCAL = HIP_FORMAT_BRIDGE_TMP;
  const HIP_FORMAT_BRIDGE_MAX_BYTES_LOCAL = HIP_FORMAT_BRIDGE_MAX_BYTES;

  const fmtBridgeUpload = makeToolUpload({
    tmpDirRoot: HIP_FORMAT_BRIDGE_TMP_LOCAL,
    maxBytes: HIP_FORMAT_BRIDGE_MAX_BYTES_LOCAL,
    fileFilter: (name) => {
      const lower = name.toLowerCase();
      if (/\.(3ds|3mf|dae|ply|stl|off|step|stp|iges|igs|sat|sab|brep|dxf)$/i.test(lower)) {
        return null;
      }
      return new Error(
        'Unsupported file type. Allowed: .3ds .3mf .dae .ply .stl .off .step .stp .iges .igs .sat .sab .brep .dxf'
      );
    },
  });

  const hipFormatBridgeSpec: ToolEndpointSpec = {
    name: 'hip-format-bridge',
    hythonPath: HYTHON_PATH_LOCAL,
    tmpDirRoot: HIP_FORMAT_BRIDGE_TMP_LOCAL,
    maxBytes: HIP_FORMAT_BRIDGE_MAX_BYTES_LOCAL,
    scriptPath: HIP_FORMAT_BRIDGE_SCRIPT,
    headers: {
      summary: 'X-Format-Bridge-Summary',
      result: 'X-Format-Bridge-Result',
      credits: 'X-Format-Bridge-Credits',
    },
    resultMarker: 'HIP FORMAT BRIDGE RESULT',
    validate: (req) => {
      const origName = path.basename(String(req.file?.originalname ?? ''));
      const origExt = path.extname(origName).slice(1).toLowerCase();
      if (!HIP_FORMAT_BRIDGE_ALLOWED_EXTS.has(origExt)) {
        return `Unsupported source format ".${origExt}". Allowed: ${Array.from(HIP_FORMAT_BRIDGE_ALLOWED_EXTS).sort().join(', ')}`;
      }
      return null;
    },
    buildArgs: (ctx) => [
      HIP_FORMAT_BRIDGE_SCRIPT,
      ctx.inputPath,
      path.join(ctx.tmpDir, ctx.origStem + '.hip'),
      '--source-ext', ctx.origExt,
      '--input-name', ctx.origName,
    ],
    outputHipPath: (ctx) => path.join(ctx.tmpDir, ctx.origStem + '.hip'),
    outputMdPath: (ctx) =>
      path.join(ctx.tmpDir, ctx.origStem + '_NexArt_hipformatbridge.md'),
  };

  app.post(
    '/api/tools/hip-format-bridge/run',
    requireAuth,
    toolLimiter,
    (req: any, res: any, next: any) => {
      fmtBridgeUpload.single('file')(req, res, (err: any) => {
        if (err) {
          rmDirSafe((req as any).toolTmpDir);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `File too large. Max ${(HIP_FORMAT_BRIDGE_MAX_BYTES_LOCAL / 1024 / 1024).toFixed(0)} MB.`,
            });
          }
          return res.status(400).json({ error: err.message || 'Upload failed.' });
        }
        next();
      });
    },
    createToolEndpoint(hipFormatBridgeSpec)
  );

  // ===================================================================
  // 3DGS Auto Trainer endpoint — /api/tools/gsplats-trainer/run
  // Mirrors the hip-format-bridge / hip-path-doctor route: multer
  // upload → spawn hython → zip stream back. Same credit gate, same
  // audit MD convention, same zip layout.
  // ===================================================================
  const GSPLATS_TRAINER_TMP_LOCAL = GSPLATS_TRAINER_TMP;
  const GSPLATS_TRAINER_MAX_BYTES_LOCAL = GSPLATS_TRAINER_MAX_BYTES;

  const gsplatsUpload = makeToolUpload({
    tmpDirRoot: GSPLATS_TRAINER_TMP_LOCAL,
    maxBytes: GSPLATS_TRAINER_MAX_BYTES_LOCAL,
    fileFilter: (name) => {
      if (name.toLowerCase().endsWith('.zip')) return null;
      return new Error('Only .zip files are accepted. Zip your image folder before uploading.');
    },
  });

  const gsplatsTrainerSpec: ToolEndpointSpec = {
    name: 'gsplats-trainer',
    hythonPath: HYTHON_PATH_LOCAL,
    tmpDirRoot: GSPLATS_TRAINER_TMP_LOCAL,
    maxBytes: GSPLATS_TRAINER_MAX_BYTES_LOCAL,
    scriptPath: GSPLATS_TRAINER_SCRIPT,
    headers: {
      summary: 'X-Gsplats-Trainer-Summary',
      result: 'X-Gsplats-Trainer-Result',
      credits: 'X-Gsplats-Trainer-Credits',
    },
    resultMarker: 'GSPLATS TRAINER RESULT',
    validate: (req) => {
      const projectName = String(req.body?.project_name ?? '').trim();
      // Mirrors the Python-side validation rule: alphanumeric + underscore, no spaces.
      if (!projectName || !/^[A-Za-z0-9_]+$/.test(projectName)) {
        return 'project_name is required and must be alphanumeric / underscore (no spaces).';
      }
      return null;
    },
    buildArgs: (ctx) => {
      const projectName = String(ctx.req.body?.project_name ?? '').trim();
      const downscale = parseInt(String(ctx.req.body?.downscale ?? '1'), 10);
      const maxBatchSize = parseInt(String(ctx.req.body?.max_batch_size ?? '6'), 10);
      const bboxHalfSize = parseFloat(String(ctx.req.body?.bbox_half_size ?? '5.0'));
      const dryRun = ctx.req.body?.dry_run === '1' || ctx.req.body?.dry_run === 'true';
      const args: string[] = [
        GSPLATS_TRAINER_SCRIPT,
        '--images-zip', ctx.inputPath,
        projectName,
        '--output-dir', ctx.tmpDir,
        '--downscale', String(downscale),
        '--max-batch-size', String(maxBatchSize),
        '--bbox-half-size', String(bboxHalfSize),
        '--input-name', ctx.origName,
      ];
      if (dryRun) args.push('--dry-run');
      return args;
    },
    outputHipPath: (ctx) => {
      const projectName = String(ctx.req.body?.project_name ?? '').trim();
      return path.join(ctx.tmpDir, `${projectName}.hip`);
    },
    outputMdPath: (ctx) => {
      const projectName = String(ctx.req.body?.project_name ?? '').trim();
      return path.join(ctx.tmpDir, `${projectName}_NexArt_gsplatstrainer.md`);
    },
  };

  app.post(
    '/api/tools/gsplats-trainer/run',
    requireAuth,
    toolLimiter,
    (req: any, res: any, next: any) => {
      gsplatsUpload.single('file')(req, res, (err: any) => {
        if (err) {
          rmDirSafe((req as any).toolTmpDir);
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `File too large. Max ${(GSPLATS_TRAINER_MAX_BYTES_LOCAL / 1024 / 1024).toFixed(0)} MB.`,
            });
          }
          return res.status(400).json({ error: err.message || 'Upload failed.' });
        }
        next();
      });
    },
    createToolEndpoint(gsplatsTrainerSpec)
  );

  // --- Static / SPA fallback (production only) ---
  if (IS_PROD) {
    const distPath = path.resolve(__dirname, '..', 'web', 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      console.warn(
        `[warn] ${distPath} not found — run \`npm run build\` in web/ first.`
      );
    }
  }

  // ----- Global error middleware (must be last) -----
  // Catches anything that escapes an async handler. Logs full stack but
  // returns a generic message — never leaks file paths or SQL fragments.
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('[api]', req.method, req.url, err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(500).json({ error: 'internal_error' });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] running on http://localhost:${PORT}  (mode=${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch((e) => {
  console.error('[api] startup failed:', e);
  process.exit(1);
});
