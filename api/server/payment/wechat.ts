// WeChat Pay v3 (Native 扫码支付) — minimal REST helper, no npm SDK.
//
// Docs: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_4_1.shtml
//
// Request auth  : WECHATPAY2-SHA256-RSA204801 — sign
//                 `METHOD\nPATH\ntimestamp\nnonce\nbody\n` with the
//                 merchant private key (apiclient_key.pem).
// Callback auth : verify `Wechatpay-Signature` over
//                 `timestamp\nnonce\nbody\n` with the PLATFORM cert/pubkey
//                 (fetched from /v3/certificates and cached, or provided
//                 via env), then AES-256-GCM decrypt `resource.ciphertext`
//                 with the APIv3 key.
//
// Required env:
//   WXPAY_MCHID          商户号
//   WXPAY_APPID          绑定到该商户号的 appid(公众号/开放平台应用)
//   WXPAY_SERIAL_NO      商户 API 证书序列号
//   WXPAY_PRIVATE_KEY    商户私钥(apiclient_key.pem 的 PEM 内容或路径)
//   WXPAY_APIV3_KEY      APIv3 密钥(32 字节)
// Optional:
//   WXPAY_PLATFORM_CERT      平台证书 PEM(留空则启动后自动拉取并缓存)
//   WXPAY_PLATFORM_CERT_SERIAL  对应证书序列号
//   WXPAY_API_BASE       默认 https://api.mch.weixin.qq.com

import crypto from 'crypto';
import fs from 'fs';

export interface WechatConfig {
  mchid: string;
  appid: string;
  serialNo: string;
  privateKey: string;
  apiv3Key: string;
  apiBase: string;
}

export function wechatConfigFromEnv(): WechatConfig | null {
  const mchid = process.env.WXPAY_MCHID || '';
  const appid = process.env.WXPAY_APPID || '';
  const serialNo = process.env.WXPAY_SERIAL_NO || '';
  const apiv3Key = process.env.WXPAY_APIV3_KEY || '';
  let privateKey = process.env.WXPAY_PRIVATE_KEY || '';
  if (privateKey && !privateKey.includes('-----BEGIN')) {
    // Either a bare base64 body or a filesystem path to the .pem.
    if (privateKey.includes('\\') || privateKey.includes('/')) {
      try {
        privateKey = fs.readFileSync(privateKey, 'utf8');
      } catch {
        return null;
      }
    }
  }
  privateKey = normalizePrivateKey(privateKey);
  if (!mchid || !appid || !serialNo || !privateKey || !apiv3Key) return null;
  return {
    mchid,
    appid,
    serialNo,
    privateKey,
    apiv3Key,
    apiBase: process.env.WXPAY_API_BASE || 'https://api.mch.weixin.qq.com',
  };
}

export function wechatConfigured(): boolean {
  return wechatConfigFromEnv() != null;
}

function normalizePrivateKey(key: string): string {
  if (!key) return '';
  if (key.includes('-----BEGIN')) return key.trim();
  const body = key.replace(/\s+/g, '');
  const chunks = body.match(/.{1,64}/g) || [body];
  return `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----`;
}

function normalizePublicKey(key: string): string {
  if (!key) return '';
  if (key.includes('-----BEGIN')) return key.trim();
  const body = key.replace(/\s+/g, '');
  const chunks = body.match(/.{1,64}/g) || [body];
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----`;
}

function rsaSign(content: string, privateKey: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  return signer.sign(privateKey, 'base64');
}

/**
 * Build the Authorization header for a v3 API request.
 */
function buildAuthHeader(
  cfg: WechatConfig,
  method: string,
  pathWithQuery: string,
  body: string
): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const content = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = rsaSign(content, cfg.privateKey);
  return `WECHATPAY2-SHA256-RSA204801 mchid="${cfg.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serialNo}"`;
}

// ---- Platform certificates (used to VERIFY wechat callbacks) -------------
// WeChat rotates these; the callback's Wechatpay-Serial tells us which one
// signed it. We cache fetched certs in memory and refresh when an unknown
// serial shows up (or via WXPAY_PLATFORM_CERT at boot).

interface PlatformKey {
  serial: string;
  publicKey: string; // normalized PEM
}

const platformKeys = new Map<string, PlatformKey>();
let platformKeysFetchedAt = 0;

export async function getWechatPlatformPublicKeys(cfg: WechatConfig): Promise<PlatformKey[]> {
  // Env-provided cert takes precedence (air-gapped deployments).
  const envCert = process.env.WXPAY_PLATFORM_CERT || '';
  const envSerial = process.env.WXPAY_PLATFORM_CERT_SERIAL || '';
  if (envCert && envSerial && !platformKeys.has(envSerial)) {
    platformKeys.set(envSerial, {
      serial: envSerial,
      publicKey: normalizePublicKey(envCert),
    });
  }
  const stale = Date.now() - platformKeysFetchedAt > 12 * 3600 * 1000;
  if (platformKeys.size === 0 || stale) {
    try {
      await refreshPlatformKeys(cfg);
    } catch (e: any) {
      console.warn('[wxpay] platform cert fetch failed:', e?.message);
    }
  }
  return [...platformKeys.values()];
}

async function refreshPlatformKeys(cfg: WechatConfig): Promise<void> {
  const path = '/v3/certificates';
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(cfg, 'GET', path, ''),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`certificates_${res.status}: ${await res.text()}`);
  }
  const json: any = await res.json();
  for (const item of json?.data ?? []) {
    const dec = item.encrypt_certificate;
    const pem = wechatAesGcmDecrypt(cfg.apiv3Key, dec.associated_data, dec.nonce, dec.ciphertext);
    platformKeys.set(item.serial_no, {
      serial: item.serial_no,
      // It's an X.509 cert; crypto.verify accepts certs as the key.
      publicKey: pem,
    });
  }
  platformKeysFetchedAt = Date.now();
}

// ---- Native order ---------------------------------------------------------

export interface WechatNativeOrderArgs {
  outTradeNo: string;
  /** Amount in fen. */
  totalFen: number;
  description: string;
  notifyUrl: string;
}

/**
 * Create a Native (desktop QR) order. Resolves to the `code_url` the
 * frontend renders as a QR code ("weixin://wxpay/bizpayurl?...").
 */
export async function createWechatNativeOrder(
  cfg: WechatConfig,
  args: WechatNativeOrderArgs
): Promise<string> {
  const path = '/v3/pay/transactions/native';
  const body = JSON.stringify({
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: args.description,
    out_trade_no: args.outTradeNo,
    notify_url: args.notifyUrl,
    amount: { total: args.totalFen, currency: 'CNY' },
  });
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(cfg, 'POST', path, body),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* leave null */
  }
  if (!res.ok || !json?.code_url) {
    const msg = json?.message || `native_order_${res.status}`;
    const err: any = new Error(msg);
    err.wxpayBody = json;
    throw err;
  }
  return String(json.code_url);
}

// ---- Callback verification ------------------------------------------------

export interface WechatCallbackCheck {
  ok: boolean;
  reason?: string;
  eventType?: string;
  resource?: any;
}

/**
 * Verify the callback signature headers against the platform key matching
 * `Wechatpay-Serial`, then return the parsed envelope. Resource decryption
 * is a separate step (decryptWechatResource) so tests can exercise both.
 */
export async function verifyWechatCallback(
  cfg: WechatConfig,
  headers: Record<string, any>,
  rawBody: Buffer
): Promise<WechatCallbackCheck> {
  const timestamp = String(headers['wechatpay-timestamp'] || '');
  const nonce = String(headers['wechatpay-nonce'] || '');
  const signature = String(headers['wechatpay-signature'] || '');
  const serial = String(headers['wechatpay-serial'] || '');
  if (!timestamp || !nonce || !signature || !serial) {
    return { ok: false, reason: 'missing_headers' };
  }
  const keys = await getWechatPlatformPublicKeys(cfg);
  const key = keys.find((k) => k.serial === serial);
  if (!key) {
    // One forced refresh in case this is a rotation we haven't seen.
    try {
      await refreshPlatformKeys(cfg);
    } catch {
      /* handled below */
    }
    const retry = (await getWechatPlatformPublicKeys(cfg)).find((k) => k.serial === serial);
    if (!retry) return { ok: false, reason: 'unknown_platform_serial' };
    return verifyWithKey(retry.publicKey);
  }
  return verifyWithKey(key.publicKey);

  function verifyWithKey(publicKeyPem: string): WechatCallbackCheck {
    const content = `${timestamp}\n${nonce}\n${rawBody.toString('utf8')}\n`;
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(content, 'utf8');
    let ok = false;
    try {
      ok = verifier.verify(publicKeyPem, signature, 'base64');
    } catch {
      ok = false;
    }
    if (!ok) return { ok: false, reason: 'signature_mismatch' };
    let event: any;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
    return { ok: true, eventType: String(event?.event_type || ''), resource: event?.resource };
  }
}

/**
 * AES-256-GCM decrypt of a callback `resource` (or an
 * encrypt_certificate). WeChat's format: base64(nonce[16] || ciphertext
 * || tag[16]), key = APIv3 key, AAD = associated_data.
 */
export function decryptWechatResource(
  apiv3Key: string,
  resource: { associated_data?: string; nonce: string; ciphertext: string }
): string {
  return wechatAesGcmDecrypt(
    apiv3Key,
    resource.associated_data || '',
    resource.nonce,
    resource.ciphertext
  );
}

function wechatAesGcmDecrypt(
  apiv3Key: string,
  aad: string,
  nonce: string,
  ciphertextB64: string
): string {
  const buf = Buffer.from(ciphertextB64, 'base64');
  if (buf.length < 16 + 16) throw new Error('ciphertext_too_short');
  const data = buf.subarray(0, buf.length - 16);
  const tag = buf.subarray(buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiv3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return out.toString('utf8');
}
