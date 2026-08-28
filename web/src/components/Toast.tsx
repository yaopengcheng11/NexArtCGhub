import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Lightweight global toast queue. The Provider sits inside the App
 * tree; components call useToast() to push messages. Toasts auto-dismiss
 * after 3.5s but can also be closed manually.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Track auto-dismiss timers so we can clear them on unmount (a toast
  // timer firing after the Provider unmounts — e.g. an ErrorBoundary
  // replaced the tree — would call setState on an unmounted component).
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  // Module-scoped counter shared across tests — move it into a ref so
  // each Provider instance has its own, and tests don't collide.
  const nextIdRef = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((cur) => cur.filter((it) => it.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextIdRef.current++;
      setItems((cur) => [...cur, { id, kind, message }]);
      const timer = setTimeout(() => remove(id), 3500);
      timersRef.current.add(timer);
    },
    [remove]
  );

  // Clear pending timers on unmount (provider removed from the tree).
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const api: ToastApi = {
    push,
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {items.map((it) => (
          <ToastView key={it.id} item={it} onClose={() => remove(it.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: no provider, log only. Lets components work outside
    // the provider tree without crashing.
    return {
      push: () => undefined,
      success: () => undefined,
      error: (m: string) => console.error('[toast]', m),
      info: () => undefined,
    } as ToastApi;
  }
  return ctx;
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const colors: Record<ToastKind, { bg: string; fg: string; Icon: React.ComponentType<{ className?: string }> }> = {
    success: { bg: 'rgba(120, 160, 110, 0.12)', fg: 'rgb(80, 120, 70)', Icon: CheckCircle2 },
    error: { bg: 'rgba(180, 60, 60, 0.10)', fg: 'rgb(160, 50, 50)', Icon: AlertCircle },
    info: { bg: 'rgba(120, 140, 170, 0.12)', fg: 'rgb(80, 100, 140)', Icon: Info },
  };
  const c = colors[item.kind];
  const Icon = c.Icon;
  return (
    <div
      // Errors are assertive so assistive tech announces them promptly
      // even if the user is mid-task (auto-dismiss 3.5s can otherwise
      // beat the polite queue).
      role={item.kind === 'error' ? 'alert' : undefined}
      className="flex items-start gap-2 rounded-2xl px-4 py-3 max-w-sm shadow-lg"
      style={{ background: c.bg, border: `1px solid ${c.fg}33`, color: c.fg }}
    >
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <p className="text-xs leading-relaxed flex-1">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="opacity-60 hover:opacity-100"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
