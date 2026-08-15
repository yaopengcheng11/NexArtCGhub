import { Link, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../lib/utils';
import React from 'react';

export default function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    logout();
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
          {/* Logo mark: a single warm dot, deliberately minimal */}
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
            Resources
          </NavLink>
          {user ? (
            <NavLink to="/admin" isActive={location.pathname.startsWith('/admin')}>
              Dashboard
            </NavLink>
          ) : (
            <NavLink to="/login" isActive={location.pathname === '/login'}>
              Admin
            </NavLink>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <span
            className="hidden sm:inline text-[11px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            {user.username}
          </span>
        )}
        {user && (
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
            Sign out
          </button>
        )}
      </div>
    </header>
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
