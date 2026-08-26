import crypto from 'crypto';
import type { IncomingHttpHeaders } from 'http';

// Minimal Stripe REST + webhook helpers.
// We hit Stripe's REST API directly via fetch — no npm SDK.
// Wire format: `application/x-www-form-urlencoded` for create calls,
// JSON for responses. See https://stripe.com/docs/api

const STRIPE_API = 'https://api.stripe.com/v1';

export interface StripeCreateOptions {
  [key: string]: string | number | boolean | undefined | null;
}

/**
 * POST a form-urlencoded body to Stripe's REST API and return the parsed
 * JSON response. Throws if STRIPE_SECRET_KEY is missing or Stripe returns
 * non-2xx.
 */
export async function stripeCreate(
  secretKey: string,
  path: string,
  params: StripeCreateOptions
): Promise<any> {
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  const res = await fetch(`${STRIPE_API}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave json as null */
  }
  if (!res.ok) {
    const msg = json?.error?.message || `stripe_${path}_failed_${res.status}`;
    const err: any = new Error(msg);
    err.stripeStatus = res.status;
    err.stripeBody = json;
    throw err;
  }
  return json;
}

/**
 * Verify a Stripe webhook signature per
 * https://stripe.com/docs/webhooks#verify-official-libraries
 * The signature header is of the form `t=<timestamp>,v1=<hmac>`.
 * Returns the parsed Stripe event on success; throws on failure.
 */
export function verifyStripeSignature(
  webhookSecret: string,
  rawBody: Buffer,
  signatureHeader: string | string[] | undefined
): any {
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  if (!signatureHeader) {
    throw new Error('missing_stripe_signature');
  }
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const parts = header.split(',').map((p) => p.trim());
  const timestamp = parts
    .find((p) => p.startsWith('t='))
    ?.slice(2);
  const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !v1) {
    throw new Error('malformed_signature_header');
  }
  // Stripe signs `${timestamp}.${rawBody}` with the webhook secret.
  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('signature_mismatch');
  }
  // Reject events older than 5 minutes (replay window).
  const tsSec = parseInt(timestamp, 10);
  if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
    throw new Error('signature_too_old');
  }
  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('invalid_event_json');
  }
  return event;
}
