import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <Compass
        className="w-10 h-10 mb-4"
        style={{ color: 'var(--color-fg-faint)' }}
      />
      <h1
        className="text-3xl mb-2"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--color-fg)',
        }}
      >
        Lost in the lattice
      </h1>
      <p
        className="text-sm mb-8 max-w-md"
        style={{ color: 'var(--color-fg-muted)' }}
      >
        The page you were looking for doesn't exist or has been moved.
      </p>
      <Link
        to="/"
        className="px-6 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
        style={{
          background: 'var(--color-fg)',
          color: 'var(--color-elevated)',
        }}
      >
        Back to home
      </Link>
    </div>
  );
}
