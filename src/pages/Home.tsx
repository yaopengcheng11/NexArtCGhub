import { useEffect, useState } from 'react';
import { Download, Layers } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

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

export default function Home() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  useEffect(() => {
    fetchResources();
  }, [categoryFilter]);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const url = categoryFilter ? `/api/resources?category=${categoryFilter}` : '/api/resources';
      const res = await fetch(url);
      const data = await res.json();
      setResources(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: '', label: 'All' },
    { id: 'Houdini', label: 'Houdini' },
    { id: 'UE', label: 'Unreal Engine' },
    { id: 'Blender', label: 'Blender' },
  ];

  return (
    <div className="flex flex-col md:flex-row gap-10 mt-6">
      {/* ===== Sidebar Filters ===== */}
      <aside className="w-full md:w-60 shrink-0">
        <div
          className="rounded-3xl p-7"
          style={{
            background: 'rgba(251, 250, 246, 0.6)',
            border: '1px solid rgba(26, 24, 20, 0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <h3
            className="text-[10px] uppercase tracking-[0.25em] mb-5"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            Filter by software
          </h3>
          <ul className="flex flex-col gap-1.5">
            {categories.map((c) => {
              const active = categoryFilter === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(c.id)}
                    className="w-full flex items-center gap-3 text-sm py-2 px-3 rounded-xl transition-colors"
                    style={{
                      color: active ? 'var(--color-fg)' : 'var(--color-fg-soft)',
                      background: active ? 'rgba(168, 128, 107, 0.08)' : 'transparent',
                      fontWeight: active ? 500 : 300,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'rgba(26, 24, 20, 0.04)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full transition-colors"
                      style={{
                        background: active ? 'var(--color-accent)' : 'var(--color-fg-faint)',
                      }}
                      aria-hidden
                    />
                    {c.label}
                  </button>
                </li>
              );
            })}
          </ul>

          <div
            className="mt-10 pt-6"
            style={{ borderTop: '1px solid rgba(26, 24, 20, 0.06)' }}
          >
            <p
              className="text-[10px] uppercase tracking-[0.25em] mb-2"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              Pro membership
            </p>
            <p
              className="text-xs leading-relaxed"
              style={{ color: 'var(--color-fg-soft)' }}
            >
              Early access to new assets and full archive downloads.
            </p>
          </div>
        </div>
      </aside>

      {/* ===== Main Content ===== */}
      <section className="flex-1 min-w-0">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p
              className="text-[10px] uppercase tracking-[0.3em] mb-3"
              style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
            >
              / Library / Assets
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
              Latest <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>resources</span>
            </h1>
          </div>
          <div
            className="text-[11px] uppercase tracking-[0.2em] hidden sm:block"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {resources.length} {resources.length === 1 ? 'asset' : 'assets'}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div
              className="w-8 h-8 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : resources.length === 0 ? (
          <div
            className="text-center py-28 rounded-3xl"
            style={{
              background: 'rgba(251, 250, 246, 0.5)',
              border: '1px solid rgba(26, 24, 20, 0.06)',
            }}
          >
            <Layers className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--color-fg-faint)' }} />
            <h3
              className="text-sm uppercase tracking-[0.25em] mb-2"
              style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
            >
              Nothing here yet
            </h3>
            <p className="text-xs" style={{ color: 'var(--color-fg-muted)' }}>
              Try a different filter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {resources.map((resource, i) => (
              <ResourceCard key={resource.id} resource={resource} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ResourceCard({
  resource,
  index,
  className,
}: {
  resource: Resource;
  index: number;
  className?: string;
}) {
  let parsedTags: string[] = [];
  try {
    parsedTags = JSON.parse(resource.tags);
  } catch (e) {
    parsedTags = resource.tags ? resource.tags.split(',') : [];
  }

  const handleDownload = async () => {
    fetch(`/api/resources/${resource.id}/download`, { method: 'POST' });
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.7,
        delay: index * 0.06,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ y: -4 }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-3xl',
        className
      )}
      style={{
        background: 'rgba(251, 250, 246, 0.7)',
        border: '1px solid rgba(26, 24, 20, 0.06)',
        boxShadow:
          '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(26, 24, 20, 0.12)',
        backdropFilter: 'blur(8px)',
        transition: 'box-shadow 0.4s ease, background 0.4s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow =
          '0 1px 0 rgba(26, 24, 20, 0.04), 0 30px 70px -25px rgba(26, 24, 20, 0.18)';
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow =
          '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(26, 24, 20, 0.12)';
        e.currentTarget.style.background = 'rgba(251, 250, 246, 0.7)';
      }}
    >
      <div className="relative h-44 overflow-hidden" style={{ background: 'var(--color-deep)' }}>
        <span
          className="absolute top-4 left-4 px-3 py-1 text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em]"
          style={{
            background: 'rgba(251, 250, 246, 0.92)',
            color: 'var(--color-fg)',
            backdropFilter: 'blur(8px)',
          }}
        >
          {resource.category === 'UE' ? 'UE5' : resource.category}
        </span>
        {resource.imageUrl ? (
          <img
            src={resource.imageUrl}
            alt={resource.title}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div
            className="h-full w-full"
            style={{
              background:
                'linear-gradient(135deg, rgba(168,128,107,0.12), rgba(176,196,212,0.12))',
            }}
          />
        )}
      </div>

      <div className="p-6 flex flex-col flex-1">
        <h3
          className="text-lg leading-snug mb-2 line-clamp-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            color: 'var(--color-fg)',
          }}
        >
          {resource.title}
        </h3>
        <p
          className="text-xs leading-relaxed mb-5 line-clamp-2 flex-1"
          style={{ color: 'var(--color-fg-muted)' }}
        >
          {resource.description}
        </p>

        {parsedTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {parsedTags.slice(0, 3).map((t, i) => (
              <span
                key={i}
                className="text-[10px] px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(168, 128, 107, 0.08)',
                  color: 'var(--color-accent)',
                }}
              >
                {t.trim()}
              </span>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-4" style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}>
          <span
            className="text-[10px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {resource.downloadCount.toString().padStart(2, '0')} downloads
          </span>
          <a
            href={resource.fileUrl}
            target="_blank"
            rel="noreferrer"
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-[11px] px-4 py-2 rounded-full transition-colors uppercase tracking-[0.15em]"
            style={{
              background: 'var(--color-fg)',
              color: 'var(--color-elevated)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-fg)')}
          >
            <Download className="w-3 h-3" />
            Get
          </a>
        </div>
      </div>
    </motion.article>
  );
}
