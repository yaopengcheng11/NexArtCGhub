import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, User, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { apiFetch, failureOf } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useAuth();
  const { t } = useI18n();

  // If user just registered, prefill username + show a hint
  useEffect(() => {
    const state = location.state as { justRegistered?: string; from?: string } | null;
    if (state?.justRegistered) {
      setUsername(state.justRegistered);
    }
  }, [location.state]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const r = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });

    if (!r.ok) {
      const f = failureOf(r);
      setError(f.error || t('login.invalidCredentials'));
      setIsSubmitting(false);
      return;
    }

    // /api/auth/login returns user directly in some versions; fall back
    // to /me so we don't need a server change.
    await refresh();
    const meRes = await apiFetch<{ user: { role: string } }>('/api/auth/me');
    const role = meRes.ok ? meRes.data.user?.role : 'user';

    // Honor a `from` redirect (set by ProtectedRoute) so deep links survive.
    const state = location.state as { from?: string } | null;
    const dest = state?.from && state.from !== '/login' ? state.from : role === 'admin' ? '/admin' : '/';
    navigate(dest, { replace: true });
    setIsSubmitting(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-12">
      <div
        className="w-full max-w-sm p-10 rounded-3xl"
        style={{
          background: 'rgba(251, 250, 246, 0.7)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
          backdropFilter: 'blur(12px)',
          boxShadow:
            '0 1px 0 rgba(26, 24, 20, 0.03), 0 30px 80px -30px rgba(26, 24, 20, 0.20)',
        }}
      >
        <div className="flex justify-center mb-8">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(168, 128, 107, 0.1)' }}
          >
            <Lock className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
          </div>
        </div>

        <p
          className="text-[10px] uppercase tracking-[0.3em] text-center mb-2"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          {t('login.signInSlash')}
        </p>
        <h2
          className="text-2xl text-center mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg)',
          }}
        >
          {t('login.welcomeBack').split(' ').map((w, i, arr) => (
            <React.Fragment key={i}>
              {i === arr.length - 1 ? <span style={{ fontStyle: 'italic' }}>{w}</span> : w}{' '}
            </React.Fragment>
          ))}
        </h2>
        <p
          className="text-xs text-center mb-8"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {t('login.subtitle')}
        </p>

        {error && (
          <div
            className="mb-5 p-3 rounded-xl text-xs"
            style={{
              background: 'rgba(180, 90, 80, 0.08)',
              border: '1px solid rgba(180, 90, 80, 0.2)',
              color: 'rgb(140, 70, 60)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('login.usernameOrEmail')}
            </label>
            <div className="relative">
              <User
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-3 text-sm outline-none transition-colors"
                style={{
                  background: 'var(--color-input)',
                  border: '1px solid rgba(26, 24, 20, 0.08)',
                  borderRadius: '12px',
                  color: 'var(--color-fg)',
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.border = '1px solid var(--color-accent)')
                }
                onBlur={(e) =>
                  (e.currentTarget.style.border =
                    '1px solid rgba(26, 24, 20, 0.08)')
                }
                placeholder={t('login.usernamePlaceholder')}
              />
            </div>
          </div>

          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('login.password')}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-3 text-sm outline-none transition-colors"
                style={{
                  background: 'var(--color-input)',
                  border: '1px solid rgba(26, 24, 20, 0.08)',
                  borderRadius: '12px',
                  color: 'var(--color-fg)',
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.border = '1px solid var(--color-accent)')
                }
                onBlur={(e) =>
                  (e.currentTarget.style.border =
                    '1px solid rgba(26, 24, 20, 0.08)')
                }
                placeholder={t('login.passwordPlaceholder')}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors"
                style={{ color: 'var(--color-fg-muted)' }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = 'var(--color-fg)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = 'var(--color-fg-muted)')
                }
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full mt-6 py-3 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: 'var(--color-fg)',
              color: 'var(--color-elevated)',
            }}
            onMouseEnter={(e) => {
              if (!isSubmitting)
                e.currentTarget.style.background = 'var(--color-accent)';
            }}
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'var(--color-fg)')
            }
          >
            {isSubmitting ? t('login.signingIn') : t('login.signInCta')}
            {!isSubmitting && <ArrowRight className="w-3 h-3" />}
          </button>
        </form>

        {/* Divider */}
        <div
          className="flex items-center gap-3 my-7"
          style={{ color: 'var(--color-fg-faint)' }}
        >
          <span className="flex-1 h-px" style={{ background: 'rgba(26, 24, 20, 0.08)' }} />
          <span
            className="text-[8px] uppercase tracking-[0.2em]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {t('login.or')}
          </span>
          <span className="flex-1 h-px" style={{ background: 'rgba(26, 24, 20, 0.08)' }} />
        </div>

        <p
          className="text-center text-[10px] uppercase tracking-[0.15em]"
          style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {t('login.invitePrompt')}
          <Link
            to="/register"
            className="ml-1.5 transition-colors"
            style={{ color: 'var(--color-accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = 'var(--color-accent)')
            }
          >
            {t('login.createAccount')}
          </Link>
        </p>
      </div>
    </div>
  );
}
