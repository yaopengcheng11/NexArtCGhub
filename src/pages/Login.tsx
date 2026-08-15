import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock } from 'lucide-react';

export default function Login() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      const userRes = await fetch('/api/auth/me');
      const userData = await userRes.json();
      login(userData.user);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message);
    }
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
          / Admin
        </p>
        <h2
          className="text-3xl text-center mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            letterSpacing: '-0.01em',
            color: 'var(--color-fg)',
          }}
        >
          Welcome <span style={{ fontStyle: 'italic' }}>back</span>
        </h2>
        <p
          className="text-xs text-center mb-8"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          Sign in to manage the library
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
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none transition-colors"
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
                (e.currentTarget.style.border = '1px solid rgba(26, 24, 20, 0.08)')
              }
              required
            />
          </div>
          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none transition-colors"
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
                (e.currentTarget.style.border = '1px solid rgba(26, 24, 20, 0.08)')
              }
              required
            />
          </div>
          <button
            type="submit"
            className="w-full mt-6 py-3 text-[11px] uppercase tracking-[0.2em] transition-colors"
            style={{
              background: 'var(--color-fg)',
              color: 'var(--color-elevated)',
              borderRadius: '999px',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--color-accent)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'var(--color-fg)')
            }
          >
            Sign in
          </button>
        </form>

        <p
          className="mt-8 text-center text-[10px] uppercase tracking-[0.15em] leading-relaxed"
          style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
        >
          Default credentials
          <br />
          <span style={{ color: 'var(--color-fg-muted)' }}>
            admin / admin123
          </span>
        </p>
      </div>
    </div>
  );
}
