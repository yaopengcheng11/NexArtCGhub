import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { KeyRound, User, Mail, Lock, ArrowRight, ShieldAlert } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { apiFetch, failureOf } from '../lib/api';

export default function Register() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code') || '';
  const navigate = useNavigate();
  const { t } = useI18n();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If user navigates here with valid code, focus the username input
  useEffect(() => {
    if (code) {
      const el = document.getElementById('reg-username') as HTMLInputElement | null;
      el?.focus();
    }
  }, [code]);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('register.passwordMismatch'));
      return;
    }

    setIsSubmitting(true);
    const r = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: { code, username, email, password },
    });
    if (r.ok) {
      navigate('/login', { state: { justRegistered: username }, replace: true });
    } else {
      const f = failureOf(r);
      setError(f.error || t('register.registrationFailed'));
    }
    setIsSubmitting(false);
  };

  // ===== No invitation code: show access-denied state =====
  if (!code) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-12 text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-6"
          style={{ background: 'rgba(180, 90, 80, 0.08)' }}
        >
          <ShieldAlert
            className="w-6 h-6"
            style={{ color: 'rgb(160, 80, 70)' }}
          />
        </div>
        <p
          className="text-[10px] uppercase tracking-[0.3em] mb-2"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          {t('register.accessDeniedSlash')}
        </p>
        <h1
          className="text-2xl mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg)',
          }}
        >
          {t('register.missingInviteTitle')}
        </h1>
        <p
          className="text-sm max-w-sm mb-8"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {t('register.missingInviteBody')}
        </p>
        <Link
          to="/login"
          className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
          style={{
            color: 'var(--color-fg-soft)',
            border: '1px solid rgba(26, 24, 20, 0.12)',
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = 'var(--color-deep)')
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = 'transparent')
          }
        >
          {t('register.backToSignIn')}
        </Link>
      </div>
    );
  }

  // ===== Has code: render registration form =====
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-12">
      <div
        className="w-full max-w-md p-10 rounded-3xl"
        style={{
          background: 'rgba(251, 250, 246, 0.7)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
          backdropFilter: 'blur(12px)',
          boxShadow:
            '0 1px 0 rgba(26, 24, 20, 0.03), 0 30px 80px -30px rgba(26, 24, 20, 0.20)',
        }}
      >
        <p
          className="text-[10px] uppercase tracking-[0.3em] text-center mb-2"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          {t('register.createAccountSlash')}
        </p>
        <h1
          className="text-2xl text-center mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg)',
          }}
        >
          {(() => {
            const s = t('register.joinTheLibrary');
            const parts = s.split(' ');
            return (
              <>
                {parts.slice(0, -1).join(' ')}{' '}
                <span style={{ fontStyle: 'italic' }}>{parts[parts.length - 1]}</span>
              </>
            );
          })()}
        </h1>
        <p
          className="text-xs text-center mb-8"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {t('register.inviteBased')}
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

        <form onSubmit={handleRegister} className="space-y-4">
          {/* Invitation code (readonly) */}
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('register.invitationCode')}
            </label>
            <div className="relative">
              <KeyRound
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type="text"
                value={code}
                readOnly
                className="w-full pl-10 pr-4 py-3 text-sm cursor-not-allowed"
                style={{
                  background: 'rgba(232, 226, 213, 0.4)',
                  border: '1px solid rgba(26, 24, 20, 0.06)',
                  borderRadius: '12px',
                  color: 'var(--color-fg-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('register.username')}
            </label>
            <div className="relative">
              <User
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                id="reg-username"
                type="text"
                required
                minLength={2}
                maxLength={32}
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
                placeholder={t('register.usernamePlaceholder')}
              />
            </div>
          </div>

          {/* Email (optional) */}
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {(() => {
                const s = t('register.emailOptional');
                const m = s.match(/^(.*?)(\(.*\))?$/);
                return (
                  <>
                    {m?.[1]}{' '}
                    <span style={{ color: 'var(--color-fg-faint)' }}>{m?.[2]}</span>
                  </>
                );
              })()}
            </label>
            <div className="relative">
              <Mail
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                placeholder={t('register.emailPlaceholder')}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('register.password')}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
                placeholder={t('register.passwordMin')}
              />
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('register.confirmPassword')}
            </label>
            <div className="relative">
              <Lock
                className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
                style={{ color: 'var(--color-fg-faint)' }}
              />
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
              />
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
            {isSubmitting ? t('register.creatingCta') : t('register.createCta')}
            {!isSubmitting && <ArrowRight className="w-3 h-3" />}
          </button>
        </form>

        <p
          className="mt-8 text-center text-[10px] uppercase tracking-[0.15em]"
          style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
        >
          {t('register.haveAccount')}
          <Link
            to="/login"
            className="ml-1.5 transition-colors"
            style={{ color: 'var(--color-accent)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = 'var(--color-accent)')
            }
          >
            {t('register.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
