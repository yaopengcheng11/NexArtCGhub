import React from 'react';
import { X } from 'lucide-react';
import {
  ADMIN_CATEGORIES,
  ADMIN_LICENSES,
  ADMIN_LANGUAGES,
  ADMIN_RESOURCE_TYPES,
  ADMIN_TAG_POOLS,
  type AdminResourceForm,
  type AdminTagCategory,
} from '../../types/admin';
import type { FormAction } from '../../pages/Admin';

interface ResourceEditModalProps {
  formData: AdminResourceForm;
  /**
   * Dispatch from the parent's useReducer (typed against FormAction).
   * Field edits dispatch `{ type: 'patch', patch: {...} }` — NOT the
   * setState `(prev) => next` shape, which a reducer would silently
   * misinterpret as an action object.
   */
  setFormData: (action: FormAction) => void;
  editingId: number | null;
  onClose: () => void;
  onSave: (e: React.FormEvent) => void;
  onToggleTag: (cat: AdminTagCategory, tag: string) => void;
}

const TAG_CATEGORIES: AdminTagCategory[] = ['software', 'element', 'technique'];

/**
 * Create / edit a single resource. Modal with full multi-dim tag picker.
 * Form state is owned by the parent (ResourcesTab) so save can be
 * triggered with one click anywhere.
 */
export function ResourceEditModal({
  formData,
  setFormData,
  editingId,
  onClose,
  onSave,
  onToggleTag,
}: ResourceEditModalProps) {
  const update = <K extends keyof AdminResourceForm>(
    key: K,
    value: AdminResourceForm[K]
  ) => setFormData({ type: 'patch', patch: { [key]: value } } as FormAction);

  // Escape to close + focus trap + scroll lock (matches ConfirmDialog).
  const dialogRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const items = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute('disabled'));
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
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Autofocus the title input so keyboard users start in the form.
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-edit-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(26, 24, 20, 0.32)', backdropFilter: 'blur(8px)' }}
    >
      <div
        ref={dialogRef}
        className="rounded-3xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: 'var(--color-elevated)',
          border: '1px solid rgba(26, 24, 20, 0.08)',
          boxShadow: '0 30px 80px -20px rgba(26, 24, 20, 0.35)',
        }}
      >
        <div
          className="flex items-center justify-between p-6"
          style={{ borderBottom: '1px solid rgba(26, 24, 20, 0.06)' }}
        >
          <div>
            <p
              className="text-[10px] uppercase tracking-[0.3em] mb-1"
              style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
            >
              {editingId ? '/ Edit' : '/ New asset'}
            </p>
            <h2
              id="resource-edit-title"
              className="text-xl"
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                letterSpacing: '-0.02em',
                color: 'var(--color-fg)',
              }}
            >
              {editingId ? 'Edit resource' : 'Add a resource'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-full transition-colors"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSave} className="p-6 overflow-y-auto flex-1 space-y-5">
          <Field label="Title">
            <input
              required
              value={formData.title}
              onChange={(e) => update('title', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={inputStyle}
            />
          </Field>

          <Field label="Description">
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => update('description', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none resize-none"
              style={inputStyle}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select
                value={formData.category}
                onChange={(e) => update('category', e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                {ADMIN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Free-form tags (comma separated)">
              <input
                placeholder="shader, env, pack"
                value={formData.tags}
                onChange={(e) => update('tags', e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              />
            </Field>
          </div>

          {/* ─── Taxonomy: required selects + optional language ─── */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="资源类型 *">
              <select
                required
                value={formData.resType}
                onChange={(e) => update('resType', e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                <option value="">— 请选择 —</option>
                {ADMIN_RESOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="许可协议 *">
              <select
                required
                value={formData.license}
                onChange={(e) => update('license', e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                <option value="">— 请选择 —</option>
                {ADMIN_LICENSES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="免费 / 付费 *">
              <select
                required
                value={formData.isFree ? '1' : '0'}
                onChange={(e) => update('isFree', e.target.value === '1')}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                <option value="1">免费</option>
                <option value="0">付费</option>
              </select>
            </Field>
            <Field label="语言（可选）">
              <select
                value={formData.language}
                onChange={(e) => update('language', e.target.value)}
                className="w-full px-4 py-3 text-sm outline-none"
                style={inputStyle}
              >
                <option value="">— 未指定 —</option>
                {ADMIN_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <MultiDimTags formData={formData} onToggle={onToggleTag} />

          <Field label="Cover image URL">
            <input
              required
              placeholder="https://..."
              value={formData.imageUrl}
              onChange={(e) => update('imageUrl', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={inputStyle}
            />
          </Field>

          <Field label="网盘链接（整包下载，可选）">
            <input
              placeholder="https://pan.baidu.com/s/xxxxxxxx （留空则只提供单资产下载）"
              value={formData.fileUrl}
              onChange={(e) => update('fileUrl', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={inputStyle}
            />
          </Field>

          <Field label="提取码（可选）">
            <input
              placeholder="如 abcd"
              value={formData.panCode}
              onChange={(e) => update('panCode', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={inputStyle}
            />
          </Field>

          <div>
            <label
              className="block text-[10px] uppercase tracking-[0.2em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              渲染器（Blend 资产）
            </label>
            <select
              value={formData.renderEngine}
              onChange={(e) => update('renderEngine', e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
            >
              <option value="">— 未指定 —</option>
              <option value="CYCLES">Cycles (ray-traced)</option>
              <option value="BLENDER_EEVEE">Eevee (legacy)</option>
              <option value="BLENDER_EEVEE_NEXT">Eevee Next (4.0+)</option>
              <option value="BLENDER_WORKBENCH">Workbench</option>
            </select>
            <p
              className="text-[10px] mt-1.5"
              style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
            >
              blender 没装时手动设。装了之后跑 <code style={{ background: 'rgba(0,0,0,0.04)', padding: '0 4px' }}>manage.py reparse &lt;id&gt;</code> 自动覆盖
            </p>
          </div>

          <div
            className="pt-5 flex justify-end gap-2 mt-2"
            style={{ borderTop: '1px solid rgba(26, 24, 20, 0.06)' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
              style={{ color: 'var(--color-fg-soft)', border: '1px solid rgba(26, 24, 20, 0.12)' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
              style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
            >
              {editingId ? 'Save changes' : 'Add resource'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: 'var(--color-input)',
  border: '1px solid rgba(26, 24, 20, 0.08)',
  borderRadius: '12px',
  color: 'var(--color-fg)',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="block text-[10px] uppercase tracking-[0.2em] mb-2"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function MultiDimTags({
  formData,
  onToggle,
}: {
  formData: AdminResourceForm;
  onToggle: (cat: AdminTagCategory, tag: string) => void;
}) {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{
        background: 'rgba(232, 226, 213, 0.25)',
        border: '1px solid rgba(26, 24, 20, 0.04)',
      }}
    >
      <p
        className="text-[10px] uppercase tracking-[0.2em]"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        Multi-dimensional tags
      </p>
      {TAG_CATEGORIES.map((cat) => (
        <div key={cat}>
          <p
            className="text-[9px] uppercase tracking-[0.25em] mb-2"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {cat}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {ADMIN_TAG_POOLS[cat].map((tag) => {
              const active = formData.tagGroups[cat].includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onToggle(cat, tag)}
                  aria-pressed={active}
                  className="text-[11px] px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: active ? 'var(--color-accent)' : 'rgba(251, 250, 246, 0.7)',
                    color: active ? 'var(--color-elevated)' : 'var(--color-fg-soft)',
                    border: active
                      ? '1px solid var(--color-accent)'
                      : '1px solid rgba(26, 24, 20, 0.08)',
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
