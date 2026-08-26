import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';

type Currency = 'usd' | 'cny';
type Region = 'cn' | 'intl';
type PaymentMethod = 'card' | 'wechat_pay' | 'alipay';

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
interface PricingData {
  credits: CreditTier[];
  hda: HdaTier[];
  currency: Currency;
  paymentMethods: PaymentMethod[];
  freeTierCredits: number;
  stripePublishableKey: string;
  both: {
    usd: { credits: CreditTier[]; hda: HdaTier[] };
    cny: { credits: CreditTier[]; hda: HdaTier[] };
  };
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
  const canceled = params.get('canceled');

  useEffect(() => {
    // Locale drives the default region. If the user manually switched
    // regions with the toggle, the manual choice wins (until they switch
    // languages too).
    setRegion((prev) => (locale === 'zh' ? 'cn' : 'intl'));
  }, [locale]);

  useEffect(() => {
    setData(null);
    fetch(`/api/pricing?region=${region}`)
      .then((r) => r.json())
      .then((d: PricingData) => setData(d))
      .catch(() => setErr('Failed to load pricing.'));
  }, [region]);

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

  const startCheckout = async (kind: 'credits' | 'hda', tier: string) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setBusyTier(`${kind}:${tier}`);
    setErr(null);
    try {
      const resp = await fetch(`/api/checkout/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier, currency: data?.currency }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        if (json.error === 'stripe_not_configured') {
          throw new Error(
            'Payments are not yet wired up on the server. The dev can set STRIPE_SECRET_KEY in api/.env to test.'
          );
        }
        if (json.error === 'hda_not_deployed') {
          throw new Error(json.message || 'HDA binary not deployed.');
        }
        throw new Error(json.message || json.error || 'Checkout failed');
      }
      window.location.href = json.url;
    } catch (e: any) {
      setErr(e?.message || 'Checkout failed');
    } finally {
      setBusyTier(null);
    }
  };

  // Footer text: which payment methods show up in Stripe Checkout for
  // this currency. We surface it so users know WeChat Pay / Alipay
  // exist — Stripe's locale-routing isn't always obvious.
  const paymentMethodsLabel = useMemo(() => {
    if (!data) return '';
    const map: Record<PaymentMethod, string> = {
      card: region === 'cn' ? '银行卡 / 信用卡' : 'Credit / debit card',
      wechat_pay: 'WeChat Pay',
      alipay: 'Alipay',
    };
    return data.paymentMethods.map((m) => map[m]).join(' · ');
  }, [data, region]);

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

      {!data ? (
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

      <p
        className="text-[10px] text-center"
        style={{ color: 'var(--color-fg-faint)' }}
      >
        Pay with {paymentMethodsLabel} · Stripe Checkout ·
        <Link to="/" className="ml-1" style={{ color: 'var(--color-accent)' }}>Back to library</Link>
      </p>
    </div>
  );
}
