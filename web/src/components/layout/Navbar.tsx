import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Coins, LogOut, Menu, User, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../lib/utils';
import { apiFetch } from '../../lib/api';
import React from 'react';
import { useI18n, Locale } from '../../i18n/I18nContext';

export default function Navbar() {
  const { user, clear } = useAuth();
  const location = useLocation();
  const { locale, setLocale, t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    clear();
    setUserMenuOpen(false);
    setMobileOpen(false);
  };

  // Route change closes any open menu.
  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Click-away for the desktop user dropdown.
  useEffect(() => {
    if (!userMenuOpen) return;
    const close = () => setUserMenuOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [userMenuOpen]);

  const creditsLabel = user?.isSubscribed
    ? '∞ credits'
    : `● ${user?.creditsRemaining ?? 0} credits`;

  return (
    <header
      className="sticky top-0 z-50 h-16 sm:h-20 flex items-center justify-between px-4 sm:px-8 lg:px-10 shrink-0 backdrop-blur-md"
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
          <NavLink to="/pricing" isActive={location.pathname.startsWith('/pricing')}>
            {t('nav.pricing')}
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink to="/admin" isActive={location.pathname.startsWith('/admin')}>
              {t('nav.controlRoom')}
            </NavLink>
          )}
        </nav>
      </div>

      {/* ===== Top-right area: language + (desktop) auth / (mobile) burger ===== */}
      <div className="flex items-center gap-2">
        <LanguageToggle locale={locale} onChange={setLocale} />

        {user ? (
          <>
            {/* Desktop: credits pill + user dropdown */}
            <Link
              to="/pricing"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors"
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
              <span className="text-[11px] tracking-[0.1em]">{creditsLabel}</span>
            </Link>

            <div className="relative hidden md:block" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors"
                style={{
                  background: userMenuOpen ? 'rgba(168, 128, 107, 0.16)' : 'rgba(168, 128, 107, 0.08)',
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
                <ChevronDown
                  className={cn('w-3 h-3 transition-transform duration-300', userMenuOpen && 'rotate-180')}
                />
              </button>

              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-48 rounded-2xl p-1.5"
                  style={{
                    background: 'rgba(251, 250, 246, 0.92)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    boxShadow: '0 1px 0 rgba(26,24,20,0.04), 0 24px 60px -20px rgba(26,24,20,0.25)',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  <Link
                    to="/pricing"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] uppercase tracking-[0.15em] transition-colors hover:bg-[rgba(26,24,20,0.05)]"
                    style={{ color: 'var(--color-fg-soft)' }}
                  >
                    <Coins className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} />
                    <span className="flex-1">{t('nav.buyCredits')}</span>
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                    >
                      {creditsLabel}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[11px] uppercase tracking-[0.15em] transition-colors hover:bg-[rgba(26,24,20,0.05)] cursor-pointer"
                    style={{ color: 'var(--color-fg-soft)' }}
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    {t('nav.signOut')}
                  </button>
                </div>
              )}
            </div>

            {/* Mobile burger */}
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label={t('nav.menu')}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-full transition-colors"
              style={{
                color: 'var(--color-fg-soft)',
                border: '1px solid rgba(26, 24, 20, 0.12)',
              }}
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </>
        ) : (
          <>
            {/* Desktop auth links (mobile: inside burger panel) */}
            <Link
              to="/login"
              className="hidden md:block text-[11px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
              style={{ color: 'var(--color-fg-soft)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-soft)')}
            >
              {t('nav.signIn')}
            </Link>
            <Link
              to="/register"
              className="hidden md:block text-[11px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
              style={{
                background: 'var(--color-fg)',
                color: 'var(--color-elevated)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-fg)')}
            >
              {t('nav.register')}
            </Link>

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-label={t('nav.menu')}
              className="md:hidden flex items-center justify-center w-9 h-9 rounded-full transition-colors"
              style={{
                color: 'var(--color-fg-soft)',
                border: '1px solid rgba(26, 24, 20, 0.12)',
              }}
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>

      {/* ===== Mobile dropdown panel ===== */}
      {mobileOpen && (
        <div
          className="md:hidden absolute left-3 right-3 top-[calc(100%+8px)] rounded-3xl overflow-hidden"
          style={{
            background: 'rgba(251, 250, 246, 0.95)',
            border: '1px solid rgba(26, 24, 20, 0.08)',
            boxShadow: '0 1px 0 rgba(26,24,20,0.04), 0 30px 70px -20px rgba(26,24,20,0.28)',
            backdropFilter: 'blur(14px)',
          }}
        >
          <div className="p-2">
            <MobileLink to="/" label={t('nav.resources')} active={location.pathname === '/'} />
            {/* Purchase entry with live balance — the whole point of the menu */}
            <Link
              to="/pricing"
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-colors hover:bg-[rgba(26,24,20,0.05)]"
              style={{
                background: user ? 'rgba(168, 128, 107, 0.08)' : 'transparent',
              }}
            >
              <Coins className="w-4 h-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
              <span
                className="flex-1 text-[12px] uppercase tracking-[0.18em]"
                style={{ color: 'var(--color-fg)' }}
              >
                {t('nav.pricing')}
              </span>
              {user && (
                <span
                  className="text-[10px] tracking-[0.1em]"
                  style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                >
                  {creditsLabel}
                </span>
              )}
            </Link>
            {user?.role === 'admin' && (
              <MobileLink
                to="/admin"
                label={t('nav.controlRoom')}
                active={location.pathname.startsWith('/admin')}
              />
            )}

            <div className="my-2 h-px bg-[rgba(26,24,20,0.06)]" />

            {user ? (
              <>
                <div
                  className="flex items-center gap-2.5 px-4 py-2.5 text-[11px] uppercase tracking-[0.15em]"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  <User className="w-3.5 h-3.5" />
                  {user.username}
                </div>
                <MobileAction label={t('nav.signOut')} onClick={handleLogout} icon={<LogOut className="w-4 h-4" />} />
              </>
            ) : (
              <>
                <MobileLink to="/login" label={t('nav.signIn')} />
                <Link
                  to="/register"
                  className="mt-2 flex items-center justify-center px-4 py-3 rounded-2xl text-[12px] uppercase tracking-[0.2em] transition-colors"
                  style={{
                    background: 'var(--color-fg)',
                    color: 'var(--color-elevated)',
                  }}
                >
                  {t('nav.register')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
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

function MobileLink({
  to,
  label,
  active = false,
}: {
  to: string;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      to={to}
      className="flex items-center px-4 py-3.5 rounded-2xl text-[12px] uppercase tracking-[0.18em] transition-colors hover:bg-[rgba(26,24,20,0.05)]"
      style={{ color: active ? 'var(--color-fg)' : 'var(--color-fg-soft)' }}
    >
      {label}
    </Link>
  );
}

function MobileAction({
  label,
  onClick,
  icon,
}: {
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-[12px] uppercase tracking-[0.18em] transition-colors hover:bg-[rgba(26,24,20,0.05)] cursor-pointer"
      style={{ color: 'var(--color-fg-soft)' }}
    >
      {icon}
      {label}
    </button>
  );
}
