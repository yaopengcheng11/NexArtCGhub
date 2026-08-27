/**
 * createToolEndpoint — shared Express handler for the three tool
 * routes (hip-path-doctor / hip-format-bridge / gsplats-trainer).
 *
 * Each tool had ~200 lines of near-identical multer upload + spawn
 * hython + zip + credit decrement + custom-header dance. They are
 * now expressed as a spec and one helper.
 *
 * The handler:
 *  1. multer uploads the file to a fresh tmp dir
 *  2. Validates file extension / size / per-feature fields
 *  3. Checks credit gate (atomic SQL self-decrement on success)
 *  4. Spawns hython with a 10-min watchdog + 50MB stdout cap
 *  5. Streams back a zip of the produced .hip + the audit MD
 *
 * See server.ts for usage. The handler assumes `requireAuth` and
 * `toolLimiter` are wired before it.
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import multer from 'multer';
import type { Request, Response } from 'express';

export interface ToolEndpointSpec {
  /** Route name — used for tmp dir, error messages, header prefixes. */
  name: string;
  /** hython executable path (env-overridden). */
  hythonPath: string;
  /** Where uploaded files land (must exist; makeToolUpload creates it). */
  tmpDirRoot: string;
  /** Max upload bytes. */
  maxBytes: number;
  /** Path to the python script to spawn. */
  scriptPath: string;
  /**
   * Multer fileFilter — only consumed by makeToolUpload (which is
   * constructed from a Pick of this spec), not by createToolEndpoint
   * itself. Optional here because the upload middleware can be built
   * separately.
   */
  fileFilter?: (originalName: string) => Error | null;
  /** Per-request validation AFTER upload. Return an error string to 400. */
  validate?: (req: Request) => string | null;
  /** Build the CLI args passed to hython. */
  buildArgs: (ctx: ToolRunContext) => string[];
  /** Output .hip path (inside the tmp dir). */
  outputHipPath: (ctx: ToolRunContext) => string;
  /** Optional .md audit path. */
  outputMdPath?: (ctx: ToolRunContext) => string;
  /** Marker text inside stderr that bounds the clean RESULT block. */
  resultMarker: string;
  /** Custom HTTP header names for the tool's response metadata. */
  headers: {
    summary: string;
    result: string;
    credits: string;
  };
}

export interface ToolRunContext {
  tmpDir: string;
  inputPath: string;
  origName: string;
  origStem: string;
  origExt: string;
  req: Request;
}

/**
 * Multer diskStorage factory — every tool uses the same shape (random
 * 8-byte hex tmp dir, sanitized filename). Returning a single function
 * here means we can't accidentally drift the implementations.
 */
export function makeToolUpload(spec: Pick<ToolEndpointSpec, 'tmpDirRoot' | 'maxBytes' | 'fileFilter'>) {
  return multer({
    storage: multer.diskStorage({
      destination: (req: any, _file, cb) => {
        const id = crypto.randomBytes(8).toString('hex');
        const dir = path.join(spec.tmpDirRoot, id);
        fs.mkdirSync(dir, { recursive: true });
        (req as any).toolTmpDir = dir;
        (req as any).toolTmpId = id;
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, 'input_' + safe);
      },
    }),
    limits: { fileSize: spec.maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!spec.fileFilter) return cb(null, true);
      const err = spec.fileFilter(file.originalname);
      if (err) return cb(err);
      cb(null, true);
    },
  });
}

/**
 * Express handler factory. Returns the async (req, res) handler that
 * runs the full tool pipeline. Pair it with the matching multer
 * upload middleware (see makeToolUpload).
 */
export function createToolEndpoint(spec: ToolEndpointSpec) {
  return async (req: Request, res: Response) => {
    const tmpDir = (req as any).toolTmpDir as string;
    const inputPath = req.file?.path;
    const origName = path.basename(req.file?.originalname ?? '');
    const origExt = path.extname(origName).slice(1).toLowerCase();
    const origStem = origName.slice(0, origName.length - origExt.length - 1);

    if (!inputPath) {
      rmDirSafe(tmpDir);
      return res.status(400).json({ error: 'No file uploaded (field name: file).' });
    }

    // Per-tool validation
    if (spec.validate) {
      const msg = spec.validate(req);
      if (msg) {
        rmDirSafe(tmpDir);
        return res.status(400).json({ error: msg });
      }
    }

    // Credit gate — atomic decrement BEFORE spawning. This is the
    // single source of truth: if the UPDATE returns 0 changes, no
    // concurrent request beat us to the last credit and we must refuse.
    // Earlier code did check-then-act (race-y: 5 concurrent requests
    // could all pass the gate and all execute hython; this closes that).
    //
    // For subscribed users we skip the decrement entirely (credits
    // behave as "unlimited").
    const user = (req as any).user;
    const reqDb = (req as any).db;
    if (!reqDb) {
      console.error(
        `[tool:${spec.name}] req.db missing — server middleware bug; refusing to run`
      );
      rmDirSafe(tmpDir);
      return res.status(500).json({ error: 'server_misconfigured' });
    }
    let chargedChanges = 0;
    let remainingAfter: number | null = null;
    if (!user.isSubscribed) {
      const r: any = await reqDb.run(
        `UPDATE users
           SET creditsRemaining = MAX(0, creditsRemaining - 1)
         WHERE id = ? AND creditsRemaining > 0`,
        [user.id]
      );
      chargedChanges = r?.changes ?? 0;
      if (chargedChanges === 0) {
        rmDirSafe(tmpDir);
        return res.status(402).json({
          error: 'no_credits',
          message:
            'You have used all your free runs for this month. Visit /pricing to get more.',
        });
      }
      const row: any = await reqDb.get(
        `SELECT creditsRemaining FROM users WHERE id = ?`,
        [user.id]
      );
      remainingAfter = row?.creditsRemaining ?? 0;
    } else {
      remainingAfter = null;
    }

    const ctx: ToolRunContext = {
      tmpDir,
      inputPath,
      origName,
      origStem,
      origExt,
      req,
    };

    const outHipPath = spec.outputHipPath(ctx);
    const outMdPath = spec.outputMdPath?.(ctx);

    const args = spec.buildArgs(ctx);

    if (!fs.existsSync(spec.hythonPath)) {
      rmDirSafe(tmpDir);
      return res.status(503).json({
        error: 'Houdini hython.exe is not available on this server. Set HYTHON_PATH env to fix.',
      });
    }
    if (!fs.existsSync(spec.scriptPath)) {
      rmDirSafe(tmpDir);
      return res.status(503).json({
        error: `${spec.scriptPath.split(/[\\/]/).pop()} is missing. Check api/tools/ directory.`,
      });
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutBytes = 0;
    // Spawn hython. `detached: true` on POSIX makes the child the leader
    // of a new process group, so killTree() can SIGKILL the whole tree
    // (Houdini spawns Mantra/ROP/Python workers). On Windows we use
    // taskkill /T /F below for the same reason (TerminateProcess only
    // kills the PID, leaving Mantra/RenderData workers alive).
    const child = spawn(spec.hythonPath, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    // Settle latch: every exit path goes through settle() so we only
    // (a) clear the watchdog,
    // (b) refund credit if we charged,
    // (c) kill child + remove tmp,
    // (d) write the response,
    // exactly once. Without this, the watchdog (timer fires 10 min) and
    // 'close' (child exits) race against each other and the client
    // disconnect (req.on('aborted')/res.on('close')) — leading to
    // double responses, double refunds, and tmpDir leaked.
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try { fn(); } catch (e) {
        console.error(`[${spec.name}] settle error`, e);
      }
    };
    const killTree = () => {
      if (child.killed || child.exitCode !== null) return;
      try { child.kill('SIGKILL'); } catch { /* already dead */ }
      if (process.platform === 'win32') {
        // taskkill /T /F walks the whole process tree (Mantra, ROP
        // workers, Python interpreters spawned by hython). Without
        // /T, parent kill leaves the workers holding .hip mmap locks
        // that prevent fs.rmSync from cleaning the tmpDir.
        try {
          spawn('taskkill', ['/PID', String(child.pid ?? 0), '/T', '/F'], {
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
          });
        } catch { /* best effort */ }
      } else if (child.pid) {
        // POSIX: child is a detached process-group leader (spawn used
        // detached: true), so -pid kills the whole group.
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ }
      }
    };

    const watchdog = setTimeout(() => {
      settle(() => {
        killTree();
        if (!res.headersSent) res.status(504).json({ error: 'tool_timeout' });
        // Don't refund on timeout — user ran out of patience, the work
        // ran to its conclusion (or got stuck). Charging is correct.
        rmDirSafe(tmpDir);
      });
    }, 10 * 60 * 1000);

    // Client disconnect: even if hython is happily producing output,
    // the receiver went away. Kill the subprocess so we don't waste
    // CPU + disk on a zip nobody is reading. (res.on('close') fires
    // for both normal completion and abrupt close, so we can't use it
    // alone — but the settled latch prevents the duplicate-response bug.)
    res.on('close', () => {
      settle(() => {
        killTree();
        // No refund on client disconnect — they cancelled, the work
        // doesn't count for them but the GPU time was spent.
        rmDirSafe(tmpDir);
      });
    });

    child.stdout.on('data', (b: Buffer) => {
      stdoutBytes += b.length;
      if (stdoutBytes > 50 * 1024 * 1024) {
        // Tool is misbehaving (or the user uploaded a 200MB .blend that
        // produces megabytes of stdout). Kill and report — don't pretend
        // it succeeded.
        settle(() => {
          killTree();
          if (!res.headersSent) {
            // Refund: the user's work didn't produce a result, they
            // didn't get any value.
            if (chargedChanges > 0) {
              reqDb.run(
                `UPDATE users SET creditsRemaining = creditsRemaining + 1 WHERE id = ?`,
                [user.id]
              ).catch(() => undefined);
            }
            res.status(502).json({ error: 'tool_output_too_large' });
            rmDirSafe(tmpDir);
          }
        });
        return;
      }
      stdoutBuf += b.toString('utf-8');
    });
    child.stderr.on('data', (b: Buffer) => { stderrBuf += b.toString('utf-8'); });

    child.on('error', (err) => {
      settle(() => {
        if (chargedChanges > 0) {
          reqDb.run(
            `UPDATE users SET creditsRemaining = creditsRemaining + 1 WHERE id = ?`,
            [user.id]
          ).catch(() => undefined);
        }
        rmDirSafe(tmpDir);
        if (!res.headersSent) res.status(500).json({ error: 'tool_spawn_failed' });
      });
    });

    child.on('close', async (code) => {
      settle(() => {
        const dbLocal = (req as any).db;
        if (!dbLocal) {
          console.error(
            `[tool:${spec.name}] req.db missing — server middleware bug; ` +
              `skipping credit decrement + audit log`
          );
          rmDirSafe(tmpDir);
          if (!res.headersSent) {
            res.status(500).json({ error: 'server_misconfigured' });
          }
          return;
        }
        const fail = (msg: string, extra?: object) => {
          if (chargedChanges > 0) {
            dbLocal.run(
              `UPDATE users
                 SET creditsRemaining = creditsRemaining + 1
               WHERE id = ?`,
              [user.id]
            ).catch((e: unknown) => {
              console.warn(`[${spec.name}] credit refund failed for user`, user.id, e);
            });
          }
          rmDirSafe(tmpDir);
          if (!res.headersSent) res.status(500).json({ error: msg, ...extra });
        };

        if (code !== 0) {
          return fail(`${spec.name} failed (exit ${code}).`, {
            stderr: stderrBuf.slice(-2000),
          });
        }
        // Last-line summary (most tools print JSON to stdout's last line).
        let summary: any = {};
        try {
          const lastLine = stdoutBuf.trim().split(/\r?\n/).pop() || '{}';
          summary = JSON.parse(lastLine);
        } catch {
          /* non-fatal */
        }

        if (!fs.existsSync(outHipPath)) {
          return fail(`${spec.name} did not produce output.`);
        }

        // Pull clean RESULT text from stderr.
        const markerRe = new RegExp(
          `===\\s+${spec.resultMarker}\\s+===\\r?\\n([\\s\\S]*?)===\\s+/${spec.resultMarker}\\s+===`
        );
        const markerMatch = stderrBuf.match(markerRe);
        const cleanResult = markerMatch?.[1]
          ? markerMatch[1].replace(/\r\n/g, '\n').trim()
          : '';

        // Build the zip parts.
        const zipParts: { name: string; data: Buffer }[] = [
          { name: path.basename(outHipPath), data: fs.readFileSync(outHipPath) },
        ];
        if (outMdPath && fs.existsSync(outMdPath)) {
          zipParts.push({
            name: outMdPath.split(/[\\/]/).pop() as string,
            data: fs.readFileSync(outMdPath),
          });
        }

        // Inline buildZip import — small wrapper that doesn't pull a 3rd-party dep.
        const zipBuf = buildZip(zipParts);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${spec.name}-${origStem}.zip"`
        );
        res.setHeader(
          spec.headers.summary,
          encodeURIComponent(JSON.stringify(summary))
        );
        res.setHeader(spec.headers.result, encodeURIComponent(cleanResult));

        // We debited credits atomically in the credit gate (so
        // concurrent requests can't all pass); remainingAfter was
        // captured there — no second UPDATE here. Refund on
        // failure is handled by fail() above.
        res.setHeader(
          spec.headers.credits,
          remainingAfter === null ? 'unlimited' : String(remainingAfter)
        );
        res.setHeader('Content-Length', String(zipBuf.length));
        res.end(zipBuf, () => rmDirSafe(tmpDir));
      });
    });
  };
}

function rmDirSafe(dir: string) {
  try {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// Inlined minimal zip writer (STORE, no compression) — keeps the helper
// self-contained. Same format as server.ts's buildZip but kept here
// so createToolEndpoint has no dependency on server.ts internals.
function buildZip(parts: { name: string; data: Buffer }[]): Buffer {
  const now = new Date();
  const time =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const date =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localChunks: Buffer[] = [];
  const entries: Array<{ name: string; data: Buffer; crc: number; size: number; offset: number }> = [];
  let cursor = 0;
  for (const part of parts) {
    const nameBuf = Buffer.from(part.name, 'utf-8');
    const data = part.data;
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6);
    lfh.writeUInt16LE(0, 8);
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    const buf = Buffer.concat([lfh, nameBuf, data]);
    entries.push({ name: part.name, data, crc, size: data.length, offset: cursor });
    localChunks.push(buf);
    cursor += buf.length;
  }
  const cdChunks: Buffer[] = [];
  let cdSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8');
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.size, 20);
    cd.writeUInt32LE(e.size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(e.offset, 42);
    const cdBuf = Buffer.concat([cd, nameBuf]);
    cdChunks.push(cdBuf);
    cdSize += cdBuf.length;
  }
  const cdOffset = cursor;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, ...cdChunks, eocd]);
}

function crc32(buf: Buffer): number {
  let c = 0xFFFFFFFF >>> 0;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = c ^ byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
