// Shared payment fulfilment, provider-agnostic.
//
// All three providers (Stripe / Alipay / WeChat Pay) converge here after
// their own signature + amount reconciliation. The caller owns its
// provider-specific checks; this module owns "what the user bought and
// what they get":
//   kind=credits → payments.status=completed + users.creditsRemaining += N
//   kind=hda     → issue a licenses row + store the key on the payment
//
// TRANSACTION CONTRACT: the caller must wrap the call in
// BEGIN IMMEDIATE / COMMIT (with ROLLBACK on throw), same as the Stripe
// webhook does. Concurrent deliveries of the same payment are excluded by
// the `status = 'pending'` guard re-read inside the transaction.

import crypto from 'crypto';

export type PaymentKind = 'credits' | 'hda';

export interface FulfilPaymentArgs {
  db: any;
  paymentId: number;
  userId: number;
  kind: PaymentKind;
  /** kind=credits: how many credits the metadata promises. */
  credits?: number;
  /** kind=hda: tier id (indie/studio/sub). */
  tier?: string;
  /** kind=hda: run cap (0 is invalid — unlimited is encoded as a big cap). */
  maxRuns?: number;
  /** kind=hda: license validity in days (default 365). */
  durationDays?: number;
}

export type FulfilResult =
  | { ok: true; msg: string }
  | { ok: false; warning: string };

export async function fulfilPayment(args: FulfilPaymentArgs): Promise<FulfilResult> {
  const { db, paymentId, userId, kind } = args;

  // ---- Reconcile against the local pending payment. A verified callback
  // is trustworthy, but its identifiers must describe a payment we actually
  // created, for this user, still pending, of the right kind. A mismatch
  // returns a warning — the caller responds 200/'success' so the provider
  // stops retrying — and NEVER grants the entitlement; an operator
  // reconciles the row by hand.
  const payment: any = await db.get(
    `SELECT id, kind, status, creditsAdded, tier
     FROM payments WHERE id = ? AND userId = ?`,
    [paymentId, userId]
  );
  if (!payment || payment.kind !== kind || payment.status !== 'pending') {
    return { ok: false, warning: 'payment_mismatch' };
  }

  if (kind === 'credits') {
    const credits = Number(args.credits || 0);
    if (payment.creditsAdded != null && credits !== payment.creditsAdded) {
      return { ok: false, warning: 'credits_mismatch' };
    }
    await db.run(
      `UPDATE payments SET status = 'completed', completedAt = datetime('now') WHERE id = ?`,
      [paymentId]
    );
    const user: any = await db.get(`SELECT isSubscribed FROM users WHERE id = ?`, [userId]);
    if (!user?.isSubscribed) {
      // COALESCE: a legacy NULL balance must not swallow the credit grant
      // (NULL + 30 would otherwise stay NULL).
      await db.run(
        `UPDATE users SET creditsRemaining = COALESCE(creditsRemaining, 0) + ? WHERE id = ?`,
        [credits, userId]
      );
    }
    return { ok: true, msg: `+${credits} credits to user ${userId}` };
  }

  // ---- kind === 'hda' ----
  // Validate the entitlement payload BEFORE the INSERT so a malformed
  // callback returns a retryable failure instead of a permanent 500.
  const tier = String(args.tier || '');
  let maxRuns = Number(args.maxRuns || 0);
  const allowedTiers = new Set(['indie', 'studio', 'sub']);
  if (!allowedTiers.has(tier) || !Number.isFinite(maxRuns)) {
    // Throwing (instead of returning a warning) rolls the transaction —
    // including the webhook dedup row — back, so the provider's next
    // delivery can retry. Requires human intervention either way.
    throw new Error(`invalid_hda_metadata: tier=${tier} maxRuns=${maxRuns}`);
  }
  // The 'sub' tier means unlimited runs; the DB CHECK (maxRuns > 0)
  // can't store 0, so encode unlimited as a sentinel the HDA treats as
  // "no practical cap".
  if (maxRuns <= 0) {
    if (tier !== 'sub') throw new Error(`invalid_hda_metadata: tier=${tier} maxRuns=${maxRuns}`);
    maxRuns = 999999;
  }
  if (payment.tier && payment.tier !== tier) {
    return { ok: false, warning: 'tier_mismatch' };
  }
  const durationDays = Number(args.durationDays || 365);
  const expiresAt = new Date(Date.now() + durationDays * 86400 * 1000).toISOString();
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
  return { ok: true, msg: `HDA license ${licenseKey} issued to user ${userId}` };
}
