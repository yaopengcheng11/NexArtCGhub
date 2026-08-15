import { Github, Twitter } from 'lucide-react';

export default function Footer() {
  return (
    <footer
      className="w-full px-6 sm:px-8 lg:px-10 py-6 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] shrink-0 mt-auto"
      style={{
        color: 'var(--color-fg-muted)',
        borderTop: '1px solid rgba(26, 24, 20, 0.06)',
      }}
    >
      <div className="flex items-center gap-6">
        <span className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--color-accent)' }}
            aria-hidden
          />
          Library online
        </span>
        <span className="hidden sm:inline" style={{ color: 'var(--color-fg-faint)' }}>
          · Built for creators
        </span>
      </div>

      <div className="flex items-center gap-5">
        <span style={{ color: 'var(--color-fg-faint)' }}>
          © {new Date().getFullYear()} CG Resource Hub
        </span>
        <a
          href="#"
          className="transition-colors"
          style={{ color: 'var(--color-fg-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
          aria-label="GitHub"
        >
          <Github className="w-3.5 h-3.5" />
        </a>
        <a
          href="#"
          className="transition-colors"
          style={{ color: 'var(--color-fg-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
          aria-label="Twitter"
        >
          <Twitter className="w-3.5 h-3.5" />
        </a>
      </div>
    </footer>
  );
}
