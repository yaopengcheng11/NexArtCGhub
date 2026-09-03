// Crypto round-trip tests for the payment gateways, run against locally
// generated RSA keys (no network, no merchant account needed).
//   npx tsx tools/test_payment_crypto.ts
// Exits non-zero on the first failure.

import crypto from 'crypto';
import {
  alipayConfigFromEnv,
  buildAlipayPagePayUrl,
  verifyAlipayNotify,
} from '../server/payment/alipay.js';
import {
  wechatConfigFromEnv,
  verifyWechatCallback,
  decryptWechatResource,
} from '../server/payment/wechat.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
console.log('== Alipay ==');
{
  // The merchant keypair signs the gateway URL; a separate "alipay side"
  // keypair signs the async notify (in production the notify is signed by
  // Alipay and we verify with ALIPAY_PUBLIC_KEY).
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const alipaySide = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.ALIPAY_APP_ID = '2021000000000000';
  process.env.ALIPAY_PRIVATE_KEY = merchant.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  process.env.ALIPAY_PUBLIC_KEY = alipaySide.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const cfg = alipayConfigFromEnv();
  check('config loaded', !!cfg);

  const url = buildAlipayPagePayUrl(cfg!, {
    outTradeNo: 'CG1TTESTR01',
    totalAmountYuan: '99.00',
    subject: 'HIP Path Doctor — Pro',
    notifyUrl: 'https://example.com/api/webhooks/alipay',
    returnUrl: 'https://example.com/pricing/success',
  });
  check('gateway url built', url.startsWith('https://openapi.alipay.com/gateway.do?'));
  check('url is GET-able length', url.length < 2048, `len=${url.length}`);

  const params: Record<string, string> = {};
  for (const [k, v] of new URL(url).searchParams as any) params[k] = v;
  check('sign present', !!params.sign);
  check('method', params.method === 'alipay.trade.page.pay');
  check('biz_content amount', JSON.parse(params.biz_content).total_amount === '99.00');

  // Simulate the async notify: Alipay signs the notify fields with its own
  // key. Re-derive the canonical sign content independently (filter
  // sign/empty, sort, join k=v&) so the test cross-checks the module.
  const signCanonical = (fields: Record<string, string>) => {
    const content = Object.keys(fields)
      .filter((k) => k !== 'sign' && fields[k] !== '')
      .sort()
      .map((k) => `${k}=${fields[k]}`)
      .join('&');
    const s = crypto.createSign('RSA-SHA256');
    s.update(content, 'utf8');
    return s.sign(
      alipaySide.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'base64'
    );
  };

  const notify: Record<string, string> = {
    app_id: '2021000000000000',
    method: 'alipay.trade.page.pay',
    charset: 'utf-8',
    sign_type: 'RSA2',
    timestamp: '2026-09-03 12:00:00',
    version: '1.0',
    out_trade_no: 'CG1TTESTR01',
    trade_no: '2026090322001400001234567890',
    trade_status: 'TRADE_SUCCESS',
    total_amount: '99.00',
  };
  notify.sign = signCanonical(notify);

  const paidCheck = verifyAlipayNotify(cfg!, notify);
  check('notify verified', paidCheck.ok && paidCheck.paid, paidCheck.reason);
  check('out_trade_no round-trip', paidCheck.outTradeNo === 'CG1TTESTR01');
  check('amount → fen', paidCheck.totalAmountFen === 9900);

  const tampered = { ...notify, total_amount: '0.01' };
  check('tampered amount rejected', !verifyAlipayNotify(cfg!, tampered).ok);
  const wrongKey = { ...notify, sign: Buffer.from('deadbeef').toString('base64') };
  check('forged sign rejected', !verifyAlipayNotify(cfg!, wrongKey).ok);
  const wrongApp = { ...notify, app_id: '9999' };
  check('foreign app_id rejected', !verifyAlipayNotify(cfg!, wrongApp).ok);
}

// ---------------------------------------------------------------------------
console.log('== WeChat Pay v3 ==');
{
  const merchant = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platformPublicKey = platform.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  process.env.WXPAY_MCHID = '1900000001';
  process.env.WXPAY_APPID = 'wx8888888888888888';
  process.env.WXPAY_SERIAL_NO = '5157F09EFDC096DE15EBE81A47057A72AAAAAAAA';
  process.env.WXPAY_PRIVATE_KEY = merchant.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  process.env.WXPAY_APIV3_KEY = '0123456789abcdef0123456789abcdef';
  process.env.WXPAY_PLATFORM_CERT = platformPublicKey;
  process.env.WXPAY_PLATFORM_CERT_SERIAL = 'PLATFORMSERIAL0001';
  // Keep the test hermetic: point cert auto-refresh at a dead port so the
  // env-provided platform cert above is the only trust anchor used.
  process.env.WXPAY_API_BASE = 'http://127.0.0.1:1';
  const cfg = wechatConfigFromEnv();
  check('config loaded', !!cfg);

  // ---- reproduce the resource encryption the platform would send
  const apiv3Key = cfg!.apiv3Key;
  const nonce = crypto.randomBytes(12).toString('hex').slice(0, 16);
  const payload = JSON.stringify({
    out_trade_no: 'CG2TTESTR02',
    transaction_id: 'wx250930123412345678',
    trade_state: 'SUCCESS',
    amount: { total: 3500, currency: 'CNY' },
  });
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(apiv3Key, 'utf8'),
    Buffer.from(nonce, 'utf8')
  );
  cipher.setAAD(Buffer.from('transaction', 'utf8'));
  const enc = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, tag]).toString('base64');

  // ---- request signing: the Authorization header construction is shared
  // with native order creation (network calls); the security-critical
  // callback verification path below uses real generated keys.

  // ---- callback verify + decrypt round trip
  const body = JSON.stringify({
    id: 'EV-20260903-1',
    event_type: 'TRANSACTION.SUCCESS',
    resource: {
      algorithm: 'AEAD_AES_256_GCM',
      associated_data: 'transaction',
      nonce,
      ciphertext,
    },
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const headerNonce = crypto.randomBytes(12).toString('hex');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${ts}\n${headerNonce}\n${body}\n`, 'utf8');
  const signature = signer.sign(
    platform.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    'base64'
  );

  const result = await verifyWechatCallback(
    cfg!,
    {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': headerNonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': 'PLATFORMSERIAL0001',
    },
    Buffer.from(body, 'utf8')
  );
  check('callback signature verified', result.ok, result.reason);
  check('event type', result.eventType === 'TRANSACTION.SUCCESS');

  const decrypted = JSON.parse(
    decryptWechatResource(apiv3Key, (result.resource as any) ?? {})
  );
  check('decrypt round-trip', decrypted.out_trade_no === 'CG2TTESTR02');
  check('amount fen', decrypted.amount.total === 3500);

  // ---- tampered envelope must fail verification (event_type is part of
  // the signed envelope; out_trade_no lives in the encrypted resource).
  const tamperedBody = body.replace('TRANSACTION.SUCCESS', 'REFUND.SUCCESS');
  const bad = await verifyWechatCallback(
    cfg!,
    {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': headerNonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': 'PLATFORMSERIAL0001',
    },
    Buffer.from(tamperedBody, 'utf8')
  );
  check('tampered body rejected', !bad.ok, bad.reason);
  const wrongSerial = await verifyWechatCallback(
    cfg!,
    {
      'wechatpay-timestamp': ts,
      'wechatpay-nonce': headerNonce,
      'wechatpay-signature': signature,
      'wechatpay-serial': 'UNKNOWN',
    },
    Buffer.from(body, 'utf8')
  );
  check('unknown serial rejected', !wrongSerial.ok, wrongSerial.reason);
}

console.log(failures === 0 ? '\nAll payment crypto tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
