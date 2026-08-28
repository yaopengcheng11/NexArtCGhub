import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiFetch, failureOf } from '../../lib/api';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';
import type { AdminUser } from '../../types/admin';

interface UsersTabProps {
  currentUserId: number;
}

export function UsersTab({ currentUserId }: UsersTabProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<AdminUser | null>(null);
  const toast = useToast();

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const r = await apiFetch<{ users: AdminUser[] }>('/api/admin/users');
    setUsers(r.ok ? (r.data.users ?? []) : []);
    setLoading(false);
  };

  const handleDelete = async (u: AdminUser) => {
    if (u.id === currentUserId) {
      toast.error('You cannot delete your own account');
      return;
    }
    setConfirmDelete(u);
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    // Optimistic: remove the row immediately, roll back on failure.
    const previous = users;
    setUsers((cur) => cur.filter((u) => u.id !== target.id));
    const r = await apiFetch(`/api/admin/users/${target.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const f = failureOf(r);
      setUsers(previous); // roll back
      toast.error(f.error || `Delete failed (${f.status})`);
      return;
    }
    toast.success(`Deleted ${target.username}`);
  };

  return (
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
              <th className="px-6 py-4 font-medium">Username</th>
              <th className="px-6 py-4 font-medium">Email</th>
              <th className="px-6 py-4 font-medium">Role</th>
              <th className="px-6 py-4 font-medium">Joined</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--color-fg-muted)' }}>
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--color-fg-muted)' }}>
                  No users.
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const isMe = u.id === currentUserId;
                return (
                  <tr
                    key={u.id}
                    style={{ borderTop: '1px solid rgba(26, 24, 20, 0.04)' }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(232, 226, 213, 0.3)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <td className="px-6 py-4" style={{ color: 'var(--color-fg)', fontWeight: 500 }}>
                      {u.username}
                      {isMe && <YouBadge />}
                    </td>
                    <td className="px-6 py-4" style={{ color: 'var(--color-fg-soft)' }}>
                      {u.email || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={u.role} />
                    </td>
                    <td
                      className="px-6 py-4"
                      style={{
                        color: 'var(--color-fg-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                      }}
                    >
                      {u.createdAt ? u.createdAt.split(' ')[0] : '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(u)}
                        disabled={isMe}
                        aria-label={`Delete ${u.username}`}
                        className="p-2 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: 'var(--color-fg-muted)' }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.username ?? 'user'}?`}
        message="This permanently removes the account and any owned content. This action cannot be undone."
        destructive
        confirmLabel="Delete"
        onConfirm={performDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function YouBadge() {
  return (
    <span
      className="ml-2 text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full"
      style={{
        background: 'rgba(168, 128, 107, 0.08)',
        color: 'var(--color-accent)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 400,
      }}
    >
      You
    </span>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'admin';
  return (
    <span
      className="text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-[0.15em]"
      style={{
        background: isAdmin ? 'rgba(168, 128, 107, 0.12)' : 'rgba(26, 24, 20, 0.05)',
        color: isAdmin ? 'var(--color-accent)' : 'var(--color-fg-muted)',
      }}
    >
      {role}
    </span>
  );
}
