import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

// Auth state shared across the app.
//
// IMPORTANT: the backend stores the session in an httpOnly cookie
// (`admin_token`). The browser will only send it on requests that
// include `credentials: 'include'`, which apiFetch does by default.
// Never call `fetch` directly for /api/* — always go through apiFetch.

export type UserRole = 'user' | 'admin';

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  role: UserRole;
  creditsRemaining?: number;
  creditsResetAt?: string | null;
  isSubscribed?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  /** Replace the cached user (e.g. after login). */
  setUser: (u: AuthUser | null) => void;
  /** Re-fetch the current user from /api/auth/me. */
  refresh: () => Promise<void>;
  /** Clear local user state. Caller is responsible for the logout POST. */
  clear: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await apiFetch<{ user: AuthUser }>('/api/auth/me');
    setUser(r.ok ? r.data.user : null);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const clear = useCallback(() => setUser(null), []);

  return (
    <AuthContext.Provider value={{ user, loading, setUser, refresh, clear }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
};
