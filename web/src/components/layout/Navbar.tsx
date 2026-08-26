import { Link, useLocation } from 'react-router-dom';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../lib/api';
import React from 'react';
import { useI18n, Locale } from '../../i18n/I18nContext';

export default function Navbar() {
  const { user, clear } = useAuth();
  const location = useLocation();
  const { locale, setLocale, t } = useI18n();

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clear();
  };

  return (
    <header
      className="sticky top-0 z-50 h-20 flex items-center justify-between px-6 sm:px-8 lg:px-10 shrink-0 backdrop-blur-md"
      style={{
        background: 'rgba(242, 239, 232, 0.72)',
        borderBottom: '1px solid rgba(26, 24, 20, 0.06)',
      }}
    >
      <div className="flex items-center gap-12">
        <Link
          to="/"
          className="flex items-center gap-2.5"
          style={{ color: 'var(--color-fg)' }}
        >
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: 'var(--color-accent)' }}
            aria-hidden
          />
          <span
            className="text-lg"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400, letterSpacing: '0.01em' }}
          >
            CG <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>Hub</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-[11px] uppercase tracking-[0.2em] h-full">
          <NavLink to="/" isActive={location.pathname === '/'}>
            {t('nav.resources')}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" isActive={location.pathname.startsWith('/admin')}>
              {t('nav.controlRoom')}
            </NavLink>
          )}
        </nav>
      </div>

      {/* ===== Top-right auth area + language toggle ===== */}
      <div className="flex items-center gap-2">
        <LanguageToggle locale={locale} onChange={setLocale} />
        {user ? (
          <>
            <Link
              to="/pricing"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors"
              style={{
                background: 'rgba(168, 128, 107, 0.10)',
                color: 'var(--color-accent)',
                fontFamily: 'var(--font-mono)',
              }}
              title={
                user.isSubscribed
                  ? 'Unlimited credits'
                  : 'Free fixes remaining this month'
              }
            >
              <span className="text-[11px] tracking-[0.1em]">
                {user.isSubscribed
                  ? '∞ credits'
                  : `● ${user.creditsRemaining ?? 0} credits`}
              </span>
            </Link>
            <div
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(168, 128, 107, 0.08)',
                color: 'var(--color-accent)',
              }}
            >
              <User className="w-3 h-3" />
              <span
                className="text-[11px] tracking-[0.15em]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {user.username}
              </span>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
              style={{
                color: 'var(--color-fg-soft)',
                border: '1px solid rgba(26, 24, 20, 0.12)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-deep)';
                e.currentTarget.style.color = 'var(--color-fg)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--color-fg-soft)';
              }}
            >
              <LogOut className="w-3 h-3" />
              {t('nav.signOut')}
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="text-[11px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
              style={{ color: 'var(--color-fg-soft)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-soft)')}
            >
              {t('nav.signIn')}
            </Link>
            <Link
              to="/register"
              className="text-[11px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
              style={{
                background: 'var(--color-fg)',
                color: 'var(--color-elevated)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-fg)')}
            >
              {t('nav.register')}
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

function LanguageToggle({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
}) {
  const next: Locale = locale === 'en' ? 'zh' : 'en';
  return (
    <button
      onClick={() => onChange(next)}
      aria-label="Switch language"
      className="text-[11px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-full transition-colors"
      style={{
        color: 'var(--color-fg-muted)',
        border: '1px solid rgba(26, 24, 20, 0.10)',
        fontFamily: 'var(--font-mono)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--color-fg)';
        e.currentTarget.style.borderColor = 'rgba(26, 24, 20, 0.20)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--color-fg-muted)';
        e.currentTarget.style.borderColor = 'rgba(26, 24, 20, 0.10)';
      }}
    >
      {locale === 'en' ? '中文' : 'EN'}
    </button>
  );
}

function NavLink({
  to,
  children,
  isActive,
}: {
  to: string;
  children: React.ReactNode;
  isActive: boolean;
}) {
  return (
    <Link
      to={to}
      data-active={isActive}
      className={cn(
        'ether-link flex items-center py-2 transition-colors',
        isActive ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]'
      )}
    >
      {children}
    </Link>
  );
}

