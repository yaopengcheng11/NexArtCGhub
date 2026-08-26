import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';

interface ProtectedRouteProps {
  /** If set, user.role must match. Used to gate /admin. */
  requireRole?: UserRole;
  children: React.ReactNode;
}

/**
 * Route guard. While auth is still loading, renders a neutral splash
 * (no flash of "you're logged out, redirect to login" before /me
 * returns). Once loaded:
 *  - no user → redirect to /login?from=<current path>
 *  - wrong role → render an inline Access Denied page (no redirect,
 *    so back button still works and the user understands why)
 */
export function ProtectedRoute({ requireRole, children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        className="flex justify-center items-center min-h-[60vh] text-sm"
        style={{ color: 'var(--color-fg-muted)' }}
      >
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{
            borderColor: 'var(--color-accent)',
            borderTopColor: 'transparent',
          }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  if (requireRole && user.role !== requireRole) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <h1
          className="text-2xl mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            color: 'var(--color-fg)',
          }}
        >
          Access denied
        </h1>
        <p className="text-sm" style={{ color: 'var(--color-fg-muted)' }}>
          This page is only available to {requireRole}s.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
