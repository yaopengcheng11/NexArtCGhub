import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, KeyRound, X } from 'lucide-react';
import QRCode from 'qrcode';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';

type Currency = 'usd' | 'cny';
type Region = 'cn' | 'intl';
type PaymentMethod = 'card' | 'wechat_pay' | 'alipay' | 'wechat';
// CN-direct gateways (bypass Stripe entirely for mainland payments).
type CnPayMethod = 'alipay' | 'wechat';

interface CreditTier {
  id: string;
  name: string;
  credits: number;
  amount: number;       // minor units (cents or fen)
  perFix: number;       // helper: minor units per fix
  highlight?: boolean;
}
interface HdaTier {
  id: string;
  name: string;
  amount: number;
  maxRuns: number;      // 0 = unlimited
  durationDays: number;
  highlight?: boolean;
}
interface Gateways {
  stripe: boolean;
  alipay: boolean;
  wechat: boolean;
  mock: boolean;
}
interface PricingData {
  credits: CreditTier[];
  hda: HdaTier[];
  currency: Currency;
  paymentMethods: PaymentMethod[];
  gateways?: Gateways;
  freeTierCredits: number;
  stripePublishableKey: string;
  both: {
    usd: { credits: CreditTier[]; hda: HdaTier[] };
    cny: { credits: CreditTier[]; hda: HdaTier[] };
  };
}

interface CheckoutResponse {
  url?: string;        // full-page redirect (Stripe / Alipay gateway)
  codeUrl?: string;    // WeChat Native `weixin://` QR payload
  paymentId?: number;  // CN-direct payments, for status polling
  error?: string;
  message?: string;
}

export default function Pricing() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [data, setData] = useState<PricingData | null>(null);
  const [region, setRegion] = useState<Region>(() => (locale === 'zh' ? 'cn' : 'intl'));
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // CN-direct payment modal: choose the gateway, then (WeChat) show the
  // QR and poll the order until the callback flips it to completed.
  const [payModal, setPayModal] = useState<
    | null
    | { step: 'choose'; kind: 'credits' | 'hda'; tier: string }
    | {
        step: 'qr';
        kind: 'credits' | 'hda';
        tier: string;
        paymentId: number;
        codeUrl: string;
        qrDataUrl: string | null;
      }
  >(null);
  // Distinct failure flag so the renderer can show a retry panel instead
  // of an infinite spinner when the pricing fetch fails.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const canceled = params.get('canceled');

  useEffect(() => {
    // Locale drives the default region. If the user manually switched
    // regions with the toggle, the manual choice wins (until they switch
    // languages too).
    setRegion((prev) => (locale === 'zh' ? 'cn' : 'intl'));
  }, [locale]);

  useEffect(() => {
    let active = true;
    setData(null);
    setLoadFailed(false);
    setErr(null);
    fetch(`/api/pricing?region=${region}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PricingData) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setErr('Failed to load pricing.');
        }
      });
    return () => {
      active = false;
    };
  }, [region, reloadTick]);

  // fmt() — minor units → human string. ¥ / $ with the right grouping.
  const fmt = (minor: number, currency: Currency) => {
    const major = minor / 100;
    const symbol = currency === 'cny' ? '¥' : '$';
    if (Number.isInteger(major)) return `${symbol}${major.toLocaleString()}`;
    return `${symbol}${major.toFixed(2)}`;
  };

  // Each tier carries a perFix value in MINOR units; show in MAJOR units
  // so the comparison feels right (e.g. "~$0.25/fix" vs "¥0.75/fix").
  const perFixMajor = (minor: number, currency: Currency) => {
    const major = minor / 100;
    const symbol = currency === 'cny' ? '¥' : '$';
    if (major < 1) return `${symbol}${major.toFixed(2)}`;
    return `${symbol}${major.toFixed(1)}`;
  };

  // Which CN-direct gateways are usable right now. In mock mode the
  // backend emulates both, so both buttons work end to end.
  const cnMethods = useMemo<CnPayMethod[]>(() => {
    if (!data?.gateways || region !== 'cn') return [];
    const g = data.gateways;
    const methods: CnPayMethod[] = [];
    if (g.alipay) methods.push('alipay');
    if (g.wechat) methods.push('wechat');
    if (g.mock) return ['alipay', 'wechat'];
    return methods;
  }, [data, region]);

  const startCheckout = async (
    kind: 'credits' | 'hda',
    tier: string,
    cnMethod?: CnPayMethod
  ) => {
    if (!user) {
      navigate('/login');
      return;
    }
    // CN users with a real choice get the method picker first.
    if (!cnMethod && cnMethods.length > 1) {
      setPayModal({ step: 'choose', kind, tier });
      return;
    }
    const method = cnMethod ?? cnMethods[0];
    setBusyTier(`${kind}:${tier}`);
    setErr(null);
    try {
      const resp = await fetch(`/api/checkout/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier, currency: data?.currency, method }),
      });
      const json: CheckoutResponse = await resp.json();
      if (!resp.ok) {
        if (json.error === 'stripe_not_configured' || /not_configured/.test(String(json.error))) {
          throw new Error(json.message || 'Payments are not yet wired up on the server.');
        }
        if (json.error === 'hda_not_deployed') {
          throw new Error(json.message || 'HDA binary not deployed.');
        }
        throw new Error(json.message || json.error || 'Checkout failed');
      }
      if (json.url) {
        // Stripe checkout or the Alipay hosted cashier.
        window.location.href = json.url;
        return;
      }
      if (json.codeUrl && json.paymentId) {
        // WeChat Native: render the QR locally and poll the order.
        const qrDataUrl = json.codeUrl.startsWith('weixin://')
          ? await QRCode.toDataURL(json.codeUrl, {
              width: 232,
              margin: 1,
              color: { dark: '#1a1814', light: '#ffffff' },
            })
          : null; // mock mode: the "QR" is a local mock-cashier URL
        setPayModal({
          step: 'qr',
          kind,
          tier,
          paymentId: json.paymentId,
          codeUrl: json.codeUrl,
          qrDataUrl,
        });
        return;
      }
      throw new Error('Unexpected checkout response.');
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
    } finally {
      setBusyTier(null);
    }
  };

  // Poll the payment row while the WeChat QR modal is open. On completed,
  // jump to the shared success page (which renders credits vs license).
  useEffect(() => {
    if (payModal?.step !== 'qr') return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/payments/${payModal.paymentId}/status`, {
          credentials: 'include',
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!stopped && j.status === 'completed') {
          stopped = true;
          clearInterval(timer);
          navigate(
            `/pricing/success?payment_id=${payModal.paymentId}&provider=wechat${
              payModal.kind === 'hda' ? '&hda=1' : ''
            }`
          );
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, 2500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payModal?.step, (payModal as any)?.paymentId]);

  // Footer text: how you can pay, in this region. CN-direct gateways
  // replace the Stripe method list when configured.
  const paymentMethodsLabel = useMemo(() => {
    if (!data) return '';
    if (region === 'cn' && cnMethods.length > 0) {
      const names: Record<CnPayMethod, string> = { alipay: '支付宝', wechat: '微信支付' };
      return cnMethods.map((m) => names[m]).join(' · ');
    }
    const map: Record<PaymentMethod, string> = {
      card: region === 'cn' ? '银行卡 / 信用卡' : 'Credit / debit card',
      wechat_pay: 'WeChat Pay',
      alipay: 'Alipay',
      wechat: '微信支付',
    };
    return data.paymentMethods.map((m) => map[m]).join(' · ');
  }, [data, region, cnMethods]);

  const viaStripe = !(region === 'cn' && cnMethods.length > 0);

  return (
    <div className="flex flex-col gap-10 mt-2 max-w-5xl mx-auto">
      {canceled && (
        <div
          className="rounded-2xl px-4 py-3 text-xs"
          style={{
            background: 'rgba(180, 90, 80, 0.08)',
            color: 'rgb(140, 70, 60)',
          }}
        >
          Checkout was canceled. You weren't charged. Try again when you're ready.
        </div>
      )}

      {/* Header */}
      <section>
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <p
            className="text-[10px] uppercase tracking-[0.3em] mb-3"
            style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
          >
            / Pricing
          </p>
          {/* Region toggle. Defaults from the i18n locale; users can
              override (e.g. a Chinese user abroad who wants USD + card). */}
          <div
            className="inline-flex items-center rounded-full p-0.5 text-[10px] uppercase tracking-[0.2em]"
            style={{
              background: 'rgba(26, 24, 20, 0.05)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <button
              onClick={() => setRegion('intl')}
              className="px-3 py-1 rounded-full transition-colors"
              style={{
                background: region === 'intl' ? 'var(--color-fg)' : 'transparent',
                color: region === 'intl' ? 'var(--color-elevated)' : 'var(--color-fg-soft)',
              }}
            >
              USD · Intl
            </button>
            <button
              onClick={() => setRegion('cn')}
              className="px-3 py-1 rounded-full transition-colors"
              style={{
                background: region === 'cn' ? 'var(--color-fg)' : 'transparent',
                color: region === 'cn' ? 'var(--color-elevated)' : 'var(--color-fg-soft)',
              }}
            >
              CNY · 中国
            </button>
          </div>
        </div>
        <h1
          className="text-2xl md:text-3xl leading-tight mb-3"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}
        >
          {region === 'cn' ? '选择适合你的方案' : 'Pick the way that fits your workflow'}
        </h1>
        <p
          className="text-sm leading-relaxed max-w-2xl"
          style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
        >
          {region === 'cn'
            ? '在线跑工具,按修复次数付费;或者买断 HDA 在本地 Houdini 里跑,完全离线可用。'
            : 'Run the tool online and pay only for the fixes you need. Or buy the HDA once and run it locally in Houdini — works fully offline.'}
        </p>
        {user && data && (
          <p
            className="text-xs mt-4"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {user.isSubscribed
              ? 'You are on an unlimited plan.'
              : `You have ${user.creditsRemaining} free fix${user.creditsRemaining === 1 ? '' : 'es'} this month.`}
          </p>
        )}
      </section>

      {err && (
        <div
          className="rounded-2xl px-4 py-3 text-xs"
          style={{
            background: 'rgba(180, 60, 60, 0.08)',
            color: 'rgba(180, 60, 60, 0.95)',
          }}
        >
          {err}
        </div>
      )}

      {!data && loadFailed ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
          <p className="text-xs" style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}>
            Failed to load pricing.
          </p>
          <button
            type="button"
            onClick={() => setReloadTick((t) => t + 1)}
            className="px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
            style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
          >
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
        </div>
      ) : (
        <>
          {/* Online credits */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2
                className="text-[10px] uppercase tracking-[0.3em]"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
              >
                {region === 'cn' ? '/ 在线工具 · 按次付费' : '/ Online tool · pay per fix'}
              </h2>
              <p
                className="text-[10px]"
                style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {region === 'cn' ? `每月免费 ${data.freeTierCredits} 次` : `Free ${data.freeTierCredits} fixes / month`}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.credits.map((tier) => {
                const busy = busyTier === `credits:${tier.id}`;
                return (
                  <div
                    key={tier.id}
                    className="rounded-3xl p-6 flex flex-col"
                    style={{
                      background: tier.highlight
                        ? 'rgba(168, 128, 107, 0.10)'
                        : 'rgba(251, 250, 246, 0.6)',
                      border: tier.highlight
                        ? '1px solid rgba(168, 128, 107, 0.30)'
                        : '1px solid rgba(26, 24, 20, 0.06)',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-[0.2em] mb-2"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                    >
                      {tier.name}
                    </p>
                    <p
                      className="text-2xl mb-1"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}
                    >
                      {fmt(tier.amount, data.currency)}
                    </p>
                    <p className="text-xs mb-4" style={{ color: 'var(--color-fg-muted)' }}>
                      {region === 'cn'
                        ? `${tier.credits} 次 · 约 ${perFixMajor(tier.perFix, data.currency)}/次`
                        : `${tier.credits} credits · ~${perFixMajor(tier.perFix, data.currency)} per fix`}
                    </p>
                    <ul className="text-xs space-y-1.5 flex-1 mb-5" style={{ color: 'var(--color-fg-soft)' }}>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '无需安装 Houdini' : 'No Houdini install needed'}
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '和 HDA 同款内核' : 'Same engine as the HDA'}
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '积分永久有效' : 'Credits never expire'}
                      </li>
                    </ul>
                    <button
                      onClick={() => startCheckout('credits', tier.id)}
                      disabled={!!busyTier}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-[11px] uppercase tracking-[0.2em] transition-colors"
                      style={{
                        background: busy ? 'var(--color-fg-faint)' : 'var(--color-fg)',
                        color: 'var(--color-elevated)',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {busy
                        ? (region === 'cn' ? '跳转中…' : 'Redirecting…')
                        : (region === 'cn' ? `购买 ${tier.credits} 次` : `Buy ${tier.credits} credits`)}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* HDA license */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2
                className="text-[10px] uppercase tracking-[0.3em]"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
              >
                {region === 'cn' ? '/ HDA · 在 Houdini 内本地运行' : '/ HDA · run locally in Houdini'}
              </h2>
              <p
                className="text-[10px]"
                style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {region === 'cn' ? '1 年授权 · 完全离线' : '1-year license · 100% offline'}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.hda.map((tier) => {
                const busy = busyTier === `hda:${tier.id}`;
                const runs = tier.maxRuns === 0
                  ? (region === 'cn' ? '不限次数' : 'Unlimited runs')
                  : (region === 'cn' ? `${tier.maxRuns} 次运行` : `${tier.maxRuns} runs`);
                return (
                  <div
                    key={tier.id}
                    className="rounded-3xl p-6 flex flex-col"
                    style={{
                      background: tier.highlight
                        ? 'rgba(168, 128, 107, 0.10)'
                        : 'rgba(251, 250, 246, 0.6)',
                      border: tier.highlight
                        ? '1px solid rgba(168, 128, 107, 0.30)'
                        : '1px solid rgba(26, 24, 20, 0.06)',
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <p
                      className="text-[10px] uppercase tracking-[0.2em] mb-2 flex items-center gap-1.5"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                    >
                      <KeyRound className="w-3 h-3" />
                      {tier.name}
                    </p>
                    <p
                      className="text-2xl mb-1"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em' }}
                    >
                      {fmt(tier.amount, data.currency)}
                    </p>
                    <p className="text-xs mb-4" style={{ color: 'var(--color-fg-muted)' }}>
                      {region === 'cn'
                        ? `${runs} · ${tier.durationDays} 天`
                        : `${runs} · ${tier.durationDays} days`}
                    </p>
                    <ul className="text-xs space-y-1.5 flex-1 mb-5" style={{ color: 'var(--color-fg-soft)' }}>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '拖进 Houdini,处理任意 .hip' : 'Drop into Houdini, run on any .hip'}
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '批量 / 脚本化工作流' : 'Batch / scripted workflows'}
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
                        {region === 'cn' ? '本地 license 文件,无需联网' : 'License key file (offline)'}
                      </li>
                    </ul>
                    <button
                      onClick={() => startCheckout('hda', tier.id)}
                      disabled={!!busyTier}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-[11px] uppercase tracking-[0.2em] transition-colors"
                      style={{
                        background: busy ? 'var(--color-fg-faint)' : 'var(--color-fg)',
                        color: 'var(--color-elevated)',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {busy
                        ? (region === 'cn' ? '跳转中…' : 'Redirecting…')
                        : (region === 'cn' ? '购买授权' : 'Buy license')}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

      {/* CN-direct payment modal: gateway picker + WeChat QR */}
      {payModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(26, 24, 20, 0.35)', backdropFilter: 'blur(4px)' }}
          onClick={() => payModal.step === 'choose' && setPayModal(null)}
        >
          <div
            className="w-full max-w-sm p-8 rounded-3xl relative"
            style={{
              background: 'var(--color-elevated)',
              border: '1px solid rgba(26, 24, 20, 0.08)',
              boxShadow: '0 1px 0 rgba(26,24,20,0.04), 0 30px 80px -20px rgba(26,24,20,0.30)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPayModal(null)}
              aria-label="Close"
              className="absolute top-4 right-4 p-1.5 rounded-full transition-colors hover:bg-[rgba(26,24,20,0.06)]"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>

            {payModal.step === 'choose' ? (
              <>
                <p
                  className="text-[10px] uppercase tracking-[0.25em] mb-2"
                  style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                >
                  {region === 'cn' ? '/ 支付方式' : '/ Payment'}
                </p>
                <h3
                  className="text-lg mb-6"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {region === 'cn' ? '选择支付方式' : 'Choose how to pay'}
                </h3>
                <div className="flex flex-col gap-3">
                  {cnMethods.map((m) => {
                    const isAlipay = m === 'alipay';
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          const { kind, tier } = payModal;
                          setPayModal(null);
                          startCheckout(kind, tier, m);
                        }}
                        className="flex items-center gap-3.5 px-5 py-3.5 rounded-2xl text-left transition-colors hover:bg-[rgba(26,24,20,0.04)]"
                        style={{ border: '1px solid rgba(26, 24, 20, 0.10)' }}
                      >
                        <span
                          className="flex items-center justify-center w-9 h-9 rounded-full shrink-0"
                          style={{
                            background: isAlipay ? 'rgba(22, 119, 255, 0.10)' : 'rgba(7, 193, 96, 0.10)',
                          }}
                        >
                          <span
                            className="text-base font-semibold"
                            style={{
                              color: isAlipay ? '#1677ff' : '#07c160',
                              fontFamily: 'var(--font-display)',
                            }}
                          >
                            {isAlipay ? '支' : '微'}
                          </span>
                        </span>
                        <span>
                          <span className="block text-sm" style={{ fontWeight: 500 }}>
                            {region === 'cn'
                              ? isAlipay
                                ? '支付宝'
                                : '微信支付'
                              : isAlipay
                                ? 'Alipay'
                                : 'WeChat Pay'}
                          </span>
                          <span
                            className="block text-[11px] mt-0.5"
                            style={{ color: 'var(--color-fg-muted)' }}
                          >
                            {region === 'cn'
                              ? isAlipay
                                ? '跳转支付宝完成付款'
                                : '微信扫码支付'
                              : isAlipay
                                ? 'Redirect to Alipay'
                                : 'Scan with WeChat'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center text-center">
                <p
                  className="text-[10px] uppercase tracking-[0.25em] mb-2"
                  style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                >
                  {region === 'cn' ? '/ 微信支付' : '/ WeChat Pay'}
                </p>
                <h3
                  className="text-lg mb-1"
                  style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
                >
                  {region === 'cn' ? '扫码支付' : 'Scan to pay'}
                </h3>
                <p className="text-xs mb-5" style={{ color: 'var(--color-fg-muted)' }}>
                  {region === 'cn'
                    ? '请使用微信扫码完成付款'
                    : 'Scan with WeChat to complete the payment'}
                </p>
                {payModal.qrDataUrl ? (
                  <img
                    src={payModal.qrDataUrl}
                    alt="WeChat Pay QR"
                    width={232}
                    height={232}
                    className="rounded-xl"
                    style={{ border: '1px solid rgba(26, 24, 20, 0.08)' }}
                  />
                ) : (
                  // Mock mode: the "QR payload" is the local mock cashier.
                  <a
                    href={payModal.codeUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col items-center justify-center w-[232px] h-[232px] rounded-xl gap-3 text-xs transition-colors hover:bg-[rgba(26,24,20,0.03)]"
                    style={{
                      border: '1px dashed rgba(26, 24, 20, 0.20)',
                      color: 'var(--color-fg-muted)',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.2em' }}>
                      PAYMENT_MOCK
                    </span>
                    <span>{region === 'cn' ? '打开模拟收银台 →' : 'Open mock cashier →'}</span>
                  </a>
                )}
                <p
                  className="flex items-center gap-2 text-xs mt-5"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-accent)' }} />
                  {region === 'cn' ? '等待支付结果,完成后自动跳转…' : 'Waiting for payment…'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <p
        className="text-[10px] text-center"
        style={{ color: 'var(--color-fg-faint)' }}
      >
        {viaStripe ? 'Pay with ' : region === 'cn' ? '支持 ' : 'Pay with '}
        {paymentMethodsLabel}
        {viaStripe ? ' · Stripe Checkout · ' : ' · '}
        <Link to="/" className="ml-1" style={{ color: 'var(--color-accent)' }}>Back to library</Link>
      </p>
    </div>
  );
}
