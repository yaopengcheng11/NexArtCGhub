import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Download, ArrowRight, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';

/**
 * Post-checkout confirmation page (/pricing/success).
 *
 * Stripe redirects here after a completed checkout with
 * `?session_id=...&hda=1` (HDA) or `?session_id=...` (credits). Alipay's
 * sync return and the WeChat QR flow land here with `?payment_id=...`
 * instead. The page asks /api/payments/lookup for the payment row and
 * renders the right confirmation — for HDA purchases it also exposes the
 * signed one-time download URL minted by the server. A payment_id lookup
 * that is still `pending` (the async notify can lag the sync return)
 * keeps polling for up to ~40s.
 */
interface PaymentLookup {
  kind: 'credits' | 'hda';
  tier: string;
  creditsAdded: number | null;
  hdaLicenseKey: string | null;
  status: string;
  amountCents: number | null;
  downloadUrl: string | null;
}

export default function PricingSuccess() {
  const [params] = useSearchParams();
  const sessionId = params.get('session_id') || '';
  const paymentId = params.get('payment_id') || '';
  const isHda = params.get('hda') === '1';
  const navigate = useNavigate();

  const [data, setData] = useState<PaymentLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId && !paymentId) {
      setError('Missing session_id — this page is only reachable after a checkout.');
      setLoading(false);
      return;
    }
    let active = true;
    let tries = 0;
    const query = sessionId
      ? `session_id=${encodeURIComponent(sessionId)}`
      : `payment_id=${encodeURIComponent(paymentId)}`;

    const lookup = async () => {
      tries += 1;
      try {
        const r = await apiFetch<PaymentLookup>(`/api/payments/lookup?${query}`);
        if (!active) return;
        if (!r.ok) {
          // 404 = payment not found (e.g. the webhook hasn't processed yet
          // or the payment belongs to someone else).
          setError(r.status === 404 ? 'not_found' : (r.error || 'lookup_failed'));
          setLoading(false);
          return;
        }
        setData(r.data);
        setLoading(false);
        // Alipay's sync return can beat the async notify, and WeChat's QR
        // flow may land here before the callback is processed — keep
        // polling a pending payment for ~40s before giving up.
        if (r.data.status === 'pending' && paymentId && tries < 16) {
          setTimeout(lookup, 2500);
        }
      } catch {
        if (active) {
          setError('lookup_failed');
          setLoading(false);
        }
      }
    };
    lookup();
    return () => {
      active = false;
    };
  }, [sessionId, paymentId]);

  const tierLabel = data?.tier ?? '';

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
      <div
        className="w-full max-w-md p-10 rounded-3xl text-center"
        style={{
          background: 'rgba(251, 250, 246, 0.7)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
          backdropFilter: 'blur(12px)',
          boxShadow:
            '0 1px 0 rgba(26, 24, 20, 0.03), 0 30px 80px -30px rgba(26, 24, 20, 0.20)',
        }}
      >
        <p
          className="text-[10px] uppercase tracking-[0.3em] mb-3"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / Payment
        </p>

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              Confirming your payment…
            </p>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-4 py-6">
            <AlertTriangle className="w-8 h-8" style={{ color: 'var(--color-accent)' }} />
            <p className="text-sm" style={{ color: 'var(--color-fg-soft)' }}>
              {error === 'not_found'
                ? 'We could not find this payment yet. If you were just redirected from Stripe, the confirmation may take a few seconds — refresh the page, or check your account on the pricing page.'
                : 'Something went wrong confirming your payment. Try refreshing, or contact support.'}
            </p>
            <div className="flex items-center gap-3">
              <Link
                to="/pricing"
                className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
                style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
              >
                Back to pricing
              </Link>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
                style={{ border: '1px solid rgba(26, 24, 20, 0.12)' }}
              >
                Refresh
              </button>
            </div>
          </div>
        )}

        {!loading && data && data.status === 'pending' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--color-accent)' }} />
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              Payment received — confirming your order…
            </p>
          </div>
        )}

        {!loading && data && data.status !== 'pending' && (
          <div className="flex flex-col items-center gap-5">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(74, 124, 89, 0.12)' }}
            >
              <CheckCircle2 className="w-7 h-7" style={{ color: '#4a7c59' }} />
            </div>
            <h1
              className="text-2xl"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: 'var(--color-fg)',
              }}
            >
              {data.kind === 'hda' ? 'License ready' : 'Credits added'}
            </h1>
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              {data.kind === 'hda'
                ? `Your ${tierLabel || ''} HDA license is active. Download the file below — the link works once.`
                : `Your purchase of ${data.creditsAdded ?? ''} credits is complete.`}
            </p>

            {data.kind === 'hda' && data.downloadUrl ? (
              <a
                href={data.downloadUrl}
                className="inline-flex items-center gap-2 px-6 py-3 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
                style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
              >
                <Download className="w-4 h-4" />
                Download .hda
              </a>
            ) : (
              <p className="text-[10px]" style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}>
                {data.status === 'pending'
                  ? 'Payment still processing — the download link appears once confirmed.'
                  : 'No download link available for this purchase.'}
              </p>
            )}

            <button
              type="button"
              onClick={() => navigate('/pricing')}
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] transition-colors"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              Back to pricing
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
