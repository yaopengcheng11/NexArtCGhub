// Alipay 电脑网站支付 (alipay.trade.page.pay) — minimal REST helper.
//
// No npm SDK: the wire protocol is "collect params, sort by key ASCII,
// join k=v&, RSA-SHA256 (RSA2), base64" — node:crypto does the rest.
// Docs: https://opendocs.alipay.com/open/270/105899
//
// Required env:
//   ALIPAY_APP_ID        应用 AppID
//   ALIPAY_PRIVATE_KEY   应用私钥(PKCS8 PEM 或裸 base64)
//   ALIPAY_PUBLIC_KEY    支付宝公钥(注意:不是你的应用公钥;用于验签回调)
// Optional:
//   ALIPAY_GATEWAY       网关,默认 https://openapi.alipay.com/gateway.do
//                        (沙箱联调填 https://openapi-sandbox.dl.alipaydev.com/gateway.do)

import crypto from 'crypto';

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  gateway: string;
}

export function alipayConfigFromEnv(): AlipayConfig | null {
  const appId = process.env.ALIPAY_APP_ID || '';
  const privateKey = normalizePrivateKey(process.env.ALIPAY_PRIVATE_KEY || '');
  const alipayPublicKey = normalizePublicKey(process.env.ALIPAY_PUBLIC_KEY || '');
  if (!appId || !privateKey || !alipayPublicKey) return null;
  const gateway = process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do';
  return { appId, privateKey, alipayPublicKey, gateway };
}

export function alipayConfigured(): boolean {
  return alipayConfigFromEnv() != null;
}

// Accept the raw base64 body most consoles hand you, or a full PEM.
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

/**
 * The canonical sign payload: drop `sign` and empty values, sort the rest
 * by key ASCII, join as `k=v&`. Both request signing and callback
 * verification use this exact algorithm.
 */
function buildSignContent(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

function signWithPrivateKey(content: string, privateKey: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(content, 'utf8');
  return signer.sign(privateKey, 'base64');
}

export function verifyWithAlipayPublicKey(
  content: string,
  signatureBase64: string,
  alipayPublicKey: string
): boolean {
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(content, 'utf8');
  try {
    return verifier.verify(alipayPublicKey, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

export interface AlipayPagePayArgs {
  outTradeNo: string;
  /** Order amount in yuan, e.g. "99.00". */
  totalAmountYuan: string;
  subject: string;
  notifyUrl: string;
  returnUrl: string;
}

/**
 * Build the gateway redirect URL for alipay.trade.page.pay. Alipay accepts
 * a plain GET with all params (incl. sign) in the query string, which is
 * the simplest server-rendered flow for us.
 */
export function buildAlipayPagePayUrl(cfg: AlipayConfig, args: AlipayPagePayArgs): string {
  const bizContent = JSON.stringify({
    out_trade_no: args.outTradeNo,
    product_code: 'FAST_INSTANT_TRADE_PAY',
    total_amount: args.totalAmountYuan,
    subject: args.subject,
  });
  // yyyy-MM-dd HH:mm:ss in Beijing time, per the gateway's expectation.
  const timestamp = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const params: Record<string, string> = {
    app_id: cfg.appId,
    method: 'alipay.trade.page.pay',
    format: 'JSON',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp,
    version: '1.0',
    notify_url: args.notifyUrl,
    return_url: args.returnUrl,
    biz_content: bizContent,
  };
  const sign = signWithPrivateKey(buildSignContent(params), cfg.privateKey);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, v);
  qs.append('sign', sign);
  return `${cfg.gateway}?${qs.toString()}`;
}

export interface AlipayNotifyCheck {
  ok: boolean;
  reason?: string;
  outTradeNo?: string;
  tradeNo?: string;
  /** Fen (integer). Present when the notify carries a parseable amount. */
  totalAmountFen?: number;
  paid: boolean;
}

/**
 * Verify an async notify (the URL-encoded POST body fields) and extract
 * the fields we reconcile against. Checks signature, app_id, and trade
 * status; the caller still checks the amount against the payments row.
 */
export function verifyAlipayNotify(
  cfg: AlipayConfig,
  fields: Record<string, any>
): AlipayNotifyCheck {
  const sign = String(fields.sign || '');
  if (!sign) return { ok: false, reason: 'missing_sign', paid: false };
  const content = buildSignContent(
    Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, String(v ?? '')]))
  );
  if (!verifyWithAlipayPublicKey(content, sign, cfg.alipayPublicKey)) {
    return { ok: false, reason: 'signature_mismatch', paid: false };
  }
  if (String(fields.app_id || '') !== cfg.appId) {
    return { ok: false, reason: 'app_id_mismatch', paid: false };
  }
  const tradeStatus = String(fields.trade_status || '');
  const paid = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED';
  const totalAmountFen = Math.round(parseFloat(String(fields.total_amount || '0')) * 100);
  return {
    ok: true,
    paid,
    outTradeNo: fields.out_trade_no ? String(fields.out_trade_no) : undefined,
    tradeNo: fields.trade_no ? String(fields.trade_no) : undefined,
    totalAmountFen: Number.isFinite(totalAmountFen) ? totalAmountFen : undefined,
  };
}
