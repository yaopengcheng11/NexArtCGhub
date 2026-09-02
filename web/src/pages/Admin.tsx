import React, { useEffect, useReducer, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, RefreshCw, Users, Package, Mail } from 'lucide-react';
import { apiFetch, failureOf } from '../lib/api';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { ResourceEditModal } from '../components/admin/ResourceEditModal';
import { UsersTab } from '../components/admin/UsersTab';
import { InvitesTab } from '../components/admin/InvitesTab';
import { useAuth } from '../context/AuthContext';
import {
  ADMIN_TAG_POOLS,
  type AdminResource,
  type AdminResourceForm,
  type AdminTagCategory,
  EMPTY_ADMIN_RESOURCE_FORM,
} from '../types/admin';

const TABS = [
  { id: 'resources' as const, label: 'Resources', icon: Package },
  { id: 'users' as const, label: 'Users', icon: Users },
  { id: 'invites' as const, label: 'Invites', icon: Mail },
];

// ---- useReducer form state -----------------------------------------------

// Exported so ResourceEditModal can type its `setFormData` prop against
// the real dispatch signature instead of `(action: any) => void`.
export type FormAction =
  | { type: 'reset' }
  | { type: 'load'; resource: AdminResource }
  | { type: 'patch'; patch: Partial<AdminResourceForm> }
  | { type: 'toggleTag'; category: AdminTagCategory; tag: string };

export function formReducer(state: AdminResourceForm, action: FormAction): AdminResourceForm {
  switch (action.type) {
    case 'reset':
      return EMPTY_ADMIN_RESOURCE_FORM;
    case 'load': {
      const tg = action.resource.tagGroups;
      return {
        title: action.resource.title,
        description: action.resource.description,
        category: action.resource.category,
        tags: parseTagsString(action.resource.tags),
        imageUrl: action.resource.imageUrl,
        fileUrl: action.resource.fileUrl ?? '',
        panCode: action.resource.panCode ?? '',
        renderEngine: tg?.renderEngine ?? '',
        resType: action.resource.resType ?? '',
        license: action.resource.license ?? '',
        language: action.resource.language ?? '',
        isFree: action.resource.isFree !== 0,
        tagGroups: {
          software: tg?.software ?? [],
          element: tg?.element ?? [],
          technique: tg?.technique ?? [],
        },
      };
    }
    case 'patch':
      return { ...state, ...action.patch };
    case 'toggleTag': {
      const arr = state.tagGroups[action.category];
      const next = arr.includes(action.tag)
        ? arr.filter((t) => t !== action.tag)
        : [...arr, action.tag];
      return {
        ...state,
        tagGroups: { ...state.tagGroups, [action.category]: next },
      };
    }
  }
}

function parseTagsString(s: string): string {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.join(', ') : s;
  } catch {
    return s;
  }
}

// The server returns tagGroups as a raw JSON string from SQLite. Parse it
// into the object the form reducer + tag UI expect (mirrors ResourceDetail).
function parseTagGroups(tg: unknown): AdminResource['tagGroups'] {
  if (!tg) return null;
  if (typeof tg === 'string') {
    try {
      return JSON.parse(tg);
    } catch {
      return null;
    }
  }
  return tg as AdminResource['tagGroups'];
}

// Compact date for the admin "Added" column (SQLite datetime or ISO).
function formatDate(s: string): string {
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

// ---- Admin entry ---------------------------------------------------------

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<'resources' | 'users' | 'invites'>('resources');

  if (authLoading) {
    return (
      <div
        className="p-8 text-center text-sm"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') {
    return (
      <div
        className="p-8 text-center text-sm"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        Access denied — admin only.
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-10 pb-6 gap-4">
        <div>
          <p
            className="text-[10px] uppercase tracking-[0.3em] mb-3"
            style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
          >
            / Admin / Dashboard
          </p>
          <h1
            className="text-3xl md:text-4xl"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              color: 'var(--color-fg)',
            }}
          >
            <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>Control</span> room
          </h1>
        </div>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === 'resources' && <ResourcesTab />}
      {tab === 'users' && <UsersTab currentUserId={user.id} />}
      {tab === 'invites' && <InvitesTab />}
    </div>
  );
}

function TabBar({
  active,
  onChange,
}: {
  active: 'resources' | 'users' | 'invites';
  onChange: (id: 'resources' | 'users' | 'invites') => void;
}) {
  return (
    <div
      className="flex items-center gap-1 mb-8 p-1 rounded-full"
      style={{
        background: 'rgba(251, 250, 246, 0.6)',
        border: '1px solid rgba(26, 24, 20, 0.06)',
        width: 'fit-content',
      }}
      role="tablist"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] px-5 py-2 rounded-full transition-all"
            style={{
              background: isActive ? 'var(--color-fg)' : 'transparent',
              color: isActive ? 'var(--color-elevated)' : 'var(--color-fg-soft)',
            }}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Resources tab -------------------------------------------------------

function ResourcesTab() {
  const [resources, setResources] = useState<AdminResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AdminResource | null>(null);
  const [formData, dispatchForm] = useReducer(formReducer, EMPTY_ADMIN_RESOURCE_FORM);
  const toast = useToast();

  useEffect(() => {
    fetchResources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResources = async () => {
    setLoading(true);
    const r = await apiFetch<AdminResource[]>('/api/resources');
    setResources(
      r.ok && Array.isArray(r.data)
        ? r.data.map((x) => ({ ...x, tagGroups: parseTagGroups(x.tagGroups) }))
        : []
    );
    setLoading(false);
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    // Optimistic: remove the row immediately, roll back on failure.
    const previous = resources;
    setResources((rs) => rs.filter((r) => r.id !== target.id));
    const r = await apiFetch(`/api/admin/resources/${target.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const f = failureOf(r);
      setResources(previous); // roll back
      toast.error(f.error || `Delete failed (${f.status})`);
      return;
    }
    toast.success(`Deleted "${target.title}"`);
  };

  const openCreate = () => {
    setEditingId(null);
    dispatchForm({ type: 'reset' });
    setIsModalOpen(true);
  };

  const openEdit = (r: AdminResource) => {
    setEditingId(r.id);
    dispatchForm({ type: 'load', resource: r });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const tagsArray = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    // Write routes are under /api/admin/* (requireAuth + requireAdmin) —
    // /api/resources is GET-only. tagGroups must be a JSON string: the
    // backend JSON.parses it when renderEngine is present and stores it
    // as text either way (an object would bind-fail / wipe the groups).
    const url = editingId ? `/api/admin/resources/${editingId}` : '/api/admin/resources';
    const method = editingId ? 'PUT' : 'POST';
    const r = await apiFetch(url, {
      method,
      body: {
        title: formData.title,
        description: formData.description,
        category: formData.category,
        tags: JSON.stringify(tagsArray),
        imageUrl: formData.imageUrl,
        fileUrl: formData.fileUrl,
        panCode: formData.panCode,
        renderEngine: formData.renderEngine || null,
        tagGroups: JSON.stringify(formData.tagGroups),
        resType: formData.resType,
        license: formData.license,
        language: formData.language || null,
        isFree: formData.isFree ? 1 : 0,
      },
    });
    if (!r.ok) {
      const f = failureOf(r);
      toast.error(f.error || 'Save failed');
      return;
    }
    setIsModalOpen(false);
    toast.success(editingId ? 'Resource updated' : 'Resource added');
    fetchResources();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p
          className="text-[10px] uppercase tracking-[0.25em]"
          style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {resources.length} {resources.length === 1 ? 'resource' : 'resources'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={fetchResources}
            aria-label="Refresh"
            className="p-2 rounded-full transition-colors"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
            style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add resource
          </button>
        </div>
      </div>

      <div
        className="rounded-3xl overflow-hidden"
        style={{
          background: 'rgba(251, 250, 246, 0.6)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead
              style={{
                background: 'rgba(232, 226, 213, 0.4)',
                borderBottom: '1px solid rgba(26, 24, 20, 0.06)',
              }}
            >
              <tr
                style={{
                  color: 'var(--color-fg-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.2em',
                }}
              >
                <th className="px-6 py-4 font-medium">Title</th>
                <th className="px-6 py-4 font-medium">Category</th>
                <th className="px-6 py-4 font-medium">Added</th>
                <th className="px-6 py-4 font-medium">Tags</th>
                <th className="px-6 py-4 font-medium">Downloads</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center" style={{ color: 'var(--color-fg-muted)' }}>
                    Loading…
                  </td>
                </tr>
              ) : resources.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center" style={{ color: 'var(--color-fg-muted)' }}>
                    No resources yet.
                  </td>
                </tr>
              ) : (
                resources.map((r) => (
                  <ResourceRow
                    key={r.id}
                    resource={r}
                    onEdit={() => openEdit(r)}
                    onDelete={() => setConfirmDelete(r)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <ResourceEditModal
          formData={formData}
          setFormData={dispatchForm}
          editingId={editingId}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSave}
          onToggleTag={(cat, tag) => dispatchForm({ type: 'toggleTag', category: cat, tag })}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete "${confirmDelete?.title ?? ''}"?`}
        message="This removes the resource and any cached thumbnails. Existing downloads still work."
        destructive
        confirmLabel="Delete"
        onConfirm={performDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function ResourceRow({
  resource,
  onEdit,
  onDelete,
}: {
  resource: AdminResource;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr
      style={{ borderTop: '1px solid rgba(26, 24, 20, 0.04)' }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = 'rgba(232, 226, 213, 0.3)')
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="px-6 py-4" style={{ color: 'var(--color-fg)', fontWeight: 500 }}>
        {resource.title}
      </td>
      <td className="px-6 py-4" style={{ color: 'var(--color-fg-soft)' }}>
        {resource.category}
      </td>
      <td className="px-6 py-4 text-[11px]" style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}>
        {formatDate(resource.createdAt)}
      </td>
      <td
        className="px-6 py-4 text-[11px]"
        style={{
          color: 'var(--color-fg-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {[
          ...(resource.tagGroups?.software ?? []),
          ...(resource.tagGroups?.element ?? []),
          ...(resource.tagGroups?.technique ?? []),
        ]
          .slice(0, 4)
          .join(' · ') || '—'}
      </td>
      <td className="px-6 py-4" style={{ color: 'var(--color-fg-soft)' }}>
        {resource.downloadCount}
      </td>
      <td className="px-6 py-4 text-right">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${resource.title}`}
            className="p-2 rounded-full transition-colors"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${resource.title}`}
            className="p-2 rounded-full transition-colors"
            style={{ color: 'var(--color-fg-muted)' }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
