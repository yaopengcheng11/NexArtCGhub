import { useEffect, useState } from 'react';
import { Check, Copy, Database, Plus, Trash2 } from 'lucide-react';
import { apiFetch, failureOf } from '../../lib/api';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';
import type { AdminInvite } from '../../types/admin';

export function InvitesTab() {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<AdminInvite | null>(null);
  const toast = useToast();

  useEffect(() => {
    fetchInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchInvites = async () => {
    setLoading(true);
    const r = await apiFetch<{ invites: AdminInvite[] }>('/api/admin/invites');
    setInvites(r.ok ? (r.data.invites ?? []) : []);
    setLoading(false);
  };

  const handleGenerate = async () => {
    const r = await apiFetch('/api/admin/invites', { method: 'POST' });
    if (!r.ok) {
      const f = failureOf(r);
      toast.error(f.error || 'Generate failed');
      return;
    }
    toast.success('New invite generated');
    fetchInvites();
  };

  const performRevoke = async () => {
    if (!confirmRevoke) return;
    const target = confirmRevoke;
    setConfirmRevoke(null);
    const r = await apiFetch(`/api/admin/invites/${target.id}`, { method: 'DELETE' });
    if (!r.ok) {
      toast.error(failureOf(r).error || `Revoke failed (${failureOf(r).status})`);
      fetchInvites(); // refresh so the row reappears in the table
      return;
    }
    toast.success('Invite revoked');
    fetchInvites();
  };

  const copyLink = async (code: string, id: number) => {
    const link = `${window.location.origin}/register?code=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
      toast.info('Invite link copied');
    } catch {
      // Fallback for older browsers / insecure contexts.
      const input = document.createElement('input');
      input.value = link;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 2000);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p
          className="text-[10px] uppercase tracking-[0.25em]"
          style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {invites.length} {invites.length === 1 ? 'invite' : 'invites'}
        </p>
        <button
          type="button"
          onClick={handleGenerate}
          className="flex items-center gap-2 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
          style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Generate invite
        </button>
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
                <th className="px-6 py-4 font-medium">Code</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Created by</th>
                <th className="px-6 py-4 font-medium">Created</th>
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
              ) : invites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--color-fg-muted)' }}>
                    No invites yet. Generate one to share with a new collaborator.
                  </td>
                </tr>
              ) : (
                invites.map((inv) => {
                  const used = !!inv.usedAt;
                  return (
                    <tr
                      key={inv.id}
                      style={{ borderTop: '1px solid rgba(26, 24, 20, 0.04)' }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = 'rgba(232, 226, 213, 0.3)')
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = 'transparent')
                      }
                    >
                      <td className="px-6 py-4">
                        <code
                          className="text-[12px] px-2.5 py-1 rounded-md"
                          style={{
                            background: 'var(--color-deep)',
                            color: 'var(--color-fg)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {inv.code}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <InviteStatusBadge used={used} usedByName={inv.usedByName} />
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--color-fg-soft)' }}>
                        {inv.createdByName || '—'}
                      </td>
                      <td
                        className="px-6 py-4"
                        style={{
                          color: 'var(--color-fg-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '11px',
                        }}
                      >
                        {inv.createdAt ? inv.createdAt.split(' ')[0] : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {!used && (
                          <button
                            type="button"
                            onClick={() => copyLink(inv.code, inv.id)}
                            aria-label="Copy invite link"
                            title="Copy invite link"
                            className="p-2 rounded-full transition-colors inline-block mr-1"
                            style={{ color: 'var(--color-fg-muted)' }}
                          >
                            {copiedId === inv.id ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmRevoke(inv)}
                          aria-label={`Revoke ${inv.code}`}
                          className="p-2 rounded-full transition-colors inline-block"
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
      </div>

      <div
        className="mt-4 px-5 py-3 rounded-2xl text-[11px] flex items-start gap-2"
        style={{
          background: 'rgba(168, 128, 107, 0.06)',
          color: 'var(--color-fg-soft)',
        }}
      >
        <Database className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: 'var(--color-accent)' }} />
        <span>
          Each invite is a one-time code that can be used once. Active invites can be
          shared via the copy link. Used invites stay in the list for audit but are no
          longer valid.
        </span>
      </div>

      <ConfirmDialog
        open={!!confirmRevoke}
        title={`Revoke invite ${confirmRevoke?.code ?? ''}?`}
        message="The code will no longer be redeemable. Existing accounts are not affected."
        destructive
        confirmLabel="Revoke"
        onConfirm={performRevoke}
        onCancel={() => setConfirmRevoke(null)}
      />
    </div>
  );
}

function InviteStatusBadge({
  used,
  usedByName,
}: {
  used: boolean;
  usedByName: string | null | undefined;
}) {
  if (used) {
    return (
      <span
        className="text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-[0.15em]"
        style={{ background: 'rgba(26, 24, 20, 0.05)', color: 'var(--color-fg-muted)' }}
      >
        Used · {usedByName || '—'}
      </span>
    );
  }
  return (
    <span
      className="text-[10px] px-2.5 py-0.5 rounded-full uppercase tracking-[0.15em]"
      style={{ background: 'rgba(168, 128, 107, 0.08)', color: 'var(--color-accent)' }}
    >
      Active
    </span>
  );
}
