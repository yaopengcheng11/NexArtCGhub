import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Plus, Edit2, Trash2, X, RefreshCw } from 'lucide-react';

interface Resource {
  id: number;
  title: string;
  description: string;
  category: string;
  tags: string;
  imageUrl: string;
  fileUrl: string;
  downloadCount: number;
  createdAt: string;
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'Houdini',
    tags: '',
    imageUrl: '',
    fileUrl: '',
  });

  useEffect(() => {
    if (user) fetchResources();
  }, [user]);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/resources');
      const data = await res.json();
      setResources(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this resource?')) return;
    try {
      await fetch(`/api/resources/${id}`, { method: 'DELETE' });
      fetchResources();
    } catch (e) {
      console.error(e);
    }
  };

  const openModal = (resource?: Resource) => {
    if (resource) {
      setEditingId(resource.id);
      let tagsStr = resource.tags;
      try {
        const parsed = JSON.parse(resource.tags);
        if (Array.isArray(parsed)) tagsStr = parsed.join(', ');
      } catch (e) {}

      setFormData({
        title: resource.title,
        description: resource.description,
        category: resource.category,
        tags: tagsStr,
        imageUrl: resource.imageUrl,
        fileUrl: resource.fileUrl,
      });
    } else {
      setEditingId(null);
      setFormData({
        title: '',
        description: '',
        category: 'Houdini',
        tags: '',
        imageUrl: '',
        fileUrl: '',
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const tagsArray = formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = { ...formData, tags: JSON.stringify(tagsArray) };

    try {
      const url = editingId ? `/api/resources/${editingId}` : '/api/resources';
      const method = editingId ? 'PUT' : 'POST';
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setIsModalOpen(false);
      fetchResources();
    } catch (e) {
      console.error(e);
    }
  };

  if (authLoading)
    return (
      <div
        className="p-8 text-center text-sm"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        Loading…
      </div>
    );
  if (!user) return <Navigate to="/login" />;

  return (
    <div>
      {/* ===== Header ===== */}
      <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between mb-10 pb-6 gap-4">
        <div>
          <p
            className="text-[10px] uppercase tracking-[0.3em] mb-3"
            style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
          >
            / Admin / Dashboard
          </p>
          <h1
            className="text-5xl md:text-6xl"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 300,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              color: 'var(--color-fg)',
            }}
          >
            Resource <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>management</span>
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchResources}
            className="p-2.5 rounded-full transition-colors"
            style={{
              background: 'rgba(251, 250, 246, 0.7)',
              border: '1px solid rgba(26, 24, 20, 0.08)',
              color: 'var(--color-fg-soft)',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--color-deep)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'rgba(251, 250, 246, 0.7)')
            }
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => openModal()}
            className="flex items-center gap-2 px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
            style={{
              background: 'var(--color-fg)',
              color: 'var(--color-elevated)',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'var(--color-accent)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'var(--color-fg)')
            }
          >
            <Plus className="w-3.5 h-3.5" />
            New asset
          </button>
        </div>
      </div>

      {/* ===== Table ===== */}
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
                <th className="px-6 py-4 font-medium text-center">Downloads</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center"
                    style={{ color: 'var(--color-fg-muted)' }}
                  >
                    Loading resources…
                  </td>
                </tr>
              ) : resources.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-12 text-center"
                    style={{ color: 'var(--color-fg-muted)' }}
                  >
                    No resources yet. Add your first asset.
                  </td>
                </tr>
              ) : (
                resources.map((resource) => (
                  <tr
                    key={resource.id}
                    className="transition-colors"
                    style={{ borderTop: '1px solid rgba(26, 24, 20, 0.04)' }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(232, 226, 213, 0.3)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <td className="px-6 py-5">
                      <div
                        className="text-sm mb-1"
                        style={{ color: 'var(--color-fg)', fontWeight: 500 }}
                      >
                        {resource.title}
                      </div>
                      <div
                        className="text-xs truncate max-w-[280px]"
                        style={{ color: 'var(--color-fg-muted)' }}
                      >
                        {resource.description}
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className="text-[10px] px-3 py-1 rounded-full uppercase tracking-[0.15em]"
                        style={{
                          background: 'rgba(168, 128, 107, 0.08)',
                          color: 'var(--color-accent)',
                        }}
                      >
                        {resource.category}
                      </span>
                    </td>
                    <td
                      className="px-6 py-5 text-center"
                      style={{
                        color: 'var(--color-fg-soft)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                      }}
                    >
                      {resource.downloadCount}
                    </td>
                    <td className="px-6 py-5 text-right">
                      <button
                        onClick={() => openModal(resource)}
                        className="p-2 rounded-full transition-colors inline-block mr-1"
                        style={{ color: 'var(--color-fg-muted)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--color-deep)';
                          e.currentTarget.style.color = 'var(--color-accent)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--color-fg-muted)';
                        }}
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(resource.id)}
                        className="p-2 rounded-full transition-colors inline-block"
                        style={{ color: 'var(--color-fg-muted)' }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(180, 90, 80, 0.08)';
                          e.currentTarget.style.color = 'rgb(160, 80, 70)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--color-fg-muted)';
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Modal ===== */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(26, 24, 20, 0.32)', backdropFilter: 'blur(8px)' }}
        >
          <div
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
                  className="text-2xl"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 400,
                    color: 'var(--color-fg)',
                  }}
                >
                  {editingId ? 'Edit resource' : 'Add a resource'}
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-full transition-colors"
                style={{ color: 'var(--color-fg-muted)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-deep)';
                  e.currentTarget.style.color = 'var(--color-fg)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-fg-muted)';
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSave}
              className="p-6 overflow-y-auto flex-1 space-y-5"
            >
              <div>
                <label
                  className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  Title
                </label>
                <input
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-3 text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    borderRadius: '12px',
                    color: 'var(--color-fg)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  Description
                </label>
                <textarea
                  required
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-3 text-sm outline-none transition-colors resize-none"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    borderRadius: '12px',
                    color: 'var(--color-fg)',
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                    style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    Category
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-3 text-sm outline-none transition-colors appearance-none"
                    style={{
                      background: 'var(--color-input)',
                      border: '1px solid rgba(26, 24, 20, 0.08)',
                      borderRadius: '12px',
                      color: 'var(--color-fg)',
                    }}
                  >
                    <option value="Houdini">Houdini</option>
                    <option value="UE">Unreal Engine</option>
                    <option value="Blender">Blender</option>
                  </select>
                </div>

                <div>
                  <label
                    className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                    style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    Tags (comma separated)
                  </label>
                  <input
                    placeholder="shader, procedural, nanite"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    className="w-full px-4 py-3 text-sm outline-none transition-colors"
                    style={{
                      background: 'var(--color-input)',
                      border: '1px solid rgba(26, 24, 20, 0.08)',
                      borderRadius: '12px',
                      color: 'var(--color-fg)',
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  Cover image URL
                </label>
                <input
                  required
                  placeholder="https://..."
                  value={formData.imageUrl}
                  onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
                  className="w-full px-4 py-3 text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    borderRadius: '12px',
                    color: 'var(--color-fg)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-[10px] uppercase tracking-[0.2em] mb-2"
                  style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  Download file URL
                </label>
                <input
                  required
                  placeholder="Google Drive, Dropbox, or direct link"
                  value={formData.fileUrl}
                  onChange={(e) => setFormData({ ...formData, fileUrl: e.target.value })}
                  className="w-full px-4 py-3 text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    borderRadius: '12px',
                    color: 'var(--color-fg)',
                  }}
                />
              </div>

              <div
                className="pt-5 flex justify-end gap-2 mt-2"
                style={{ borderTop: '1px solid rgba(26, 24, 20, 0.06)' }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
                  style={{
                    color: 'var(--color-fg-soft)',
                    border: '1px solid rgba(26, 24, 20, 0.12)',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--color-deep)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'transparent')
                  }
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 text-[11px] uppercase tracking-[0.2em] rounded-full transition-colors"
                  style={{
                    background: 'var(--color-fg)',
                    color: 'var(--color-elevated)',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--color-accent)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'var(--color-fg)')
                  }
                >
                  {editingId ? 'Save changes' : 'Add resource'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
