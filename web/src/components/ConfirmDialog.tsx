import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Destructive confirmations should set this so the button is red. */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation. Replaces window.confirm() with a styled, keyboard-
 * accessible (Esc to cancel, Enter to confirm), focus-trapped dialog.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  destructive,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const focusables = () => {
      if (!dialogRef.current) return [] as HTMLElement[];
      return Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
    };

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        // Only confirm when focus is inside the dialog — otherwise a
        // stray Enter in a background input would silently fire the
        // destructive action.
        if (dialogRef.current?.contains(document.activeElement)) {
          e.preventDefault();
          onConfirm();
        }
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap: cycle focus within the dialog.
        const items = focusables();
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handler);
    // Move focus into the dialog (confirm is the primary action).
    confirmRef.current?.focus();
    // Lock body scroll while the dialog is up.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-msg"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(26, 24, 20, 0.40)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          {destructive && (
            <div
              className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(180, 60, 60, 0.08)' }}
            >
              <AlertTriangle className="w-4 h-4" style={{ color: 'rgb(180, 60, 60)' }} />
            </div>
          )}
          <div className="flex-1">
            <h2
              id="confirm-dialog-title"
              className="text-base mb-1"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                color: 'var(--color-fg)',
              }}
            >
              {title}
            </h2>
            <p
              id="confirm-dialog-msg"
              className="text-xs leading-relaxed"
              style={{ color: 'var(--color-fg-muted)' }}
            >
              {message}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="p-1 rounded-full shrink-0"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
            style={{
              color: 'var(--color-fg-soft)',
              border: '1px solid rgba(26, 24, 20, 0.12)',
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="px-5 py-2 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
            style={{
              background: destructive ? 'rgb(180, 60, 60)' : 'var(--color-fg)',
              color: 'var(--color-elevated)',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
