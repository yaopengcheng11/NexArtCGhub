import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Package, Sparkles, Stethoscope } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useI18n } from '../i18n/I18nContext';
import { ADMIN_CATEGORIES, ADMIN_RESOURCE_TYPES } from '../types/admin';

// Per-tool card config. The card is generic; each tool only needs to supply
// its icon, route, title/lede keys, and tag keys.
type ToolMeta = {
  to: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: any;
  titleKey: string;
  ledeKey: string;
  tags: string[];
  bannerStyle: string;
};

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
  resType?: string | null;
  license?: string | null;
  isFree?: number | null;
}

// Taxonomy filter state. Empty string = "all".
interface Filters {
  category: string;
  type: string;
  free: string; // '' | '1' | '0'
  sort: 'new' | 'downloads';
}

const EMPTY_FILTERS: Filters = { category: '', type: '', free: '', sort: 'new' };

const selectStyle: CSSProperties = {
  background: 'rgba(251, 250, 246, 0.7)',
  border: '1px solid rgba(26, 24, 20, 0.08)',
  borderRadius: '9999px',
  color: 'var(--color-fg-soft)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  padding: '8px 32px 8px 16px',
  outline: 'none',
  appearance: 'none' as const,
  backgroundImage:
    "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='6' viewBox='0 0 8 6'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%231a1814' stroke-opacity='0.4' fill='none' stroke-width='1.2'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
  cursor: 'pointer',
  transition: 'border-color 0.3s ease',
};

export default function Home() {
  const { t } = useI18n();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  useEffect(() => {
    let active = true;
    fetchResources(active);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchResources = async (active: boolean) => {
    setLoading(true);
    try {
      const res = await fetch('/api/resources');
      if (!active) return;
      const data = await res.json();
      setResources(Array.isArray(data) ? data : []);
    } catch (e) {
      if (active) console.error(e);
    } finally {
      if (active) setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let list = resources;
    if (filters.category) list = list.filter((r) => r.category === filters.category);
    if (filters.type) list = list.filter((r) => r.resType === filters.type);
    if (filters.free === '1') list = list.filter((r) => r.isFree !== 0);
    if (filters.free === '0') list = list.filter((r) => r.isFree === 0);
    if (filters.sort === 'downloads') {
      list = [...list].sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
    }
    return list;
  }, [resources, filters]);

  const filtersActive =
    filters.category !== '' || filters.type !== '' || filters.free !== '' ||
    filters.sort !== EMPTY_FILTERS.sort;

  return (
    <div className="mt-2">
      {/* ─── Taxonomy filter bar ─── */}
      {!loading && resources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 mb-8">
          <select
            aria-label={t('home.filterCategory')}
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            style={selectStyle}
          >
            <option value="">{t('home.filterCategory')}</option>
            {ADMIN_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label={t('home.filterType')}
            value={filters.type}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
            style={selectStyle}
          >
            <option value="">{t('home.filterType')}</option>
            {ADMIN_RESOURCE_TYPES.map((tp) => (
              <option key={tp} value={tp}>{t(`resourceType.${tp}`)}</option>
            ))}
          </select>
          <select
            aria-label={t('home.filterPrice')}
            value={filters.free}
            onChange={(e) => setFilters((f) => ({ ...f, free: e.target.value }))}
            style={selectStyle}
          >
            <option value="">{t('home.filterPrice')}</option>
            <option value="1">{t('home.badgeFree')}</option>
            <option value="0">{t('home.badgePaid')}</option>
          </select>
          <select
            aria-label={t('home.filterSort')}
            value={filters.sort}
            onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as Filters['sort'] }))}
            style={selectStyle}
          >
            <option value="new">{t('home.sortNew')}</option>
            <option value="downloads">{t('home.sortDownloads')}</option>
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="text-[10px] uppercase tracking-[0.18em] px-3 py-2 rounded-full transition-colors"
              style={{
                color: 'var(--color-accent)', fontFamily: 'var(--font-mono)',
                border: '1px solid rgba(168, 128, 107, 0.3)',
              }}
            >
              {t('home.filterClear')}
            </button>
          )}
          <span
            className="ml-auto text-[10px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
          >
            {filtered.length} / {resources.length}
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
          />
        </div>
      ) : filtered.length === 0 && filtersActive ? (
        <div
          className="flex flex-col items-center justify-center h-48 rounded-3xl"
          style={{ border: '1px dashed rgba(26, 24, 20, 0.12)' }}
        >
          <p className="text-sm mb-3" style={{ color: 'var(--color-fg-muted)' }}>
            {t('home.filterEmpty')}
          </p>
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-[10px] uppercase tracking-[0.2em] px-4 py-2 rounded-full transition-colors"
            style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
          >
            {t('home.filterClear')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {!filtersActive && (
            <>
              <ToolFeatureCard kind="path-doctor" index={0} />
              <ToolFeatureCard kind="format-bridge" index={1} />
              <ToolFeatureCard kind="gsplats-trainer" index={2} />
            </>
          )}
          {filtered.map((resource, i) => (
            <ResourceCard key={resource.id} resource={resource} index={i + 1} />
          ))}
        </div>
      )}
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
  const navigate = useNavigate();
  const { t } = useI18n();

  let parsedTags: string[] = [];
  try {
    const parsed = JSON.parse(resource.tags);
    // Valid JSON that isn't an array (null, object, number) would crash
    // the .slice()/.map() below — treat it as "no tags".
    parsedTags = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    parsedTags = resource.tags ? resource.tags.split(',') : [];
  }

  const openDetail = () => {
    navigate(`/resource/${resource.id}`);
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
      onClick={openDetail}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail();
        }
      }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-3xl cursor-pointer',
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
        {/* Free / Paid badge */}
        {resource.isFree !== undefined && resource.isFree !== null && (
          <span
            className="absolute top-4 left-4 px-3 py-1 text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em]"
            style={{
              background: 'rgba(251, 250, 246, 0.92)',
              color: resource.isFree ? '#4a7c59' : 'var(--color-accent)',
              backdropFilter: 'blur(8px)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {resource.isFree ? t('home.badgeFree') : t('home.badgePaid')}
          </span>
        )}
      </div>

      <div className="p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          {resource.resType && (
            <span
              className="text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-full"
              style={{
                color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                background: 'rgba(26, 24, 20, 0.04)',
              }}
            >
              {t(`resourceType.${resource.resType}`)}
            </span>
          )}
          <h3
            className="text-base leading-snug line-clamp-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--color-fg)',
            }}
          >
            {resource.title}
          </h3>
        </div>
        <p
          className="text-xs leading-relaxed mb-5 line-clamp-2 flex-1"
          style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}
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

        <div
          className="flex items-center justify-end pt-4"
          style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}
        >
          <span
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors group-hover:text-[color:var(--color-accent)]"
            style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
          >
            {t('home.view')}
            <ArrowUpRight
              className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
              strokeWidth={1.5}
            />
          </span>
        </div>
      </div>
    </motion.article>
  );
}

function ToolFeatureCard({
  index,
  kind,
}: {
  index: number;
  kind: 'path-doctor' | 'format-bridge' | 'gsplats-trainer';
}) {
  const { t } = useI18n();
  const cfg = TOOL_META[kind];
  const Icon = cfg.icon;
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
      className="group relative flex flex-col overflow-hidden rounded-3xl cursor-pointer"
      style={{
        background: 'rgba(251, 250, 246, 0.7)',
        border: '1px solid rgba(168, 128, 107, 0.18)',
        boxShadow:
          '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(168, 128, 107, 0.20)',
        backdropFilter: 'blur(8px)',
        transition: 'box-shadow 0.4s ease, background 0.4s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow =
          '0 1px 0 rgba(26, 24, 20, 0.04), 0 30px 70px -25px rgba(168, 128, 107, 0.30)';
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.85)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow =
          '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(168, 128, 107, 0.20)';
        e.currentTarget.style.background = 'rgba(251, 250, 246, 0.7)';
      }}
    >
      <Link
        to={cfg.to}
        className="flex flex-col flex-1"
        aria-label={t(cfg.titleKey)}
      >
        {/* Top banner with icon */}
        <div
          className="relative h-44 overflow-hidden flex items-center justify-center"
          style={{
            background: cfg.bannerStyle,
          }}
        >
          {/* Live badge */}
          <span
            className="absolute top-4 left-4 px-3 py-1 text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em] inline-flex items-center gap-1.5"
            style={{
              background: 'rgba(251, 250, 246, 0.92)',
              color: 'var(--color-accent)',
              backdropFilter: 'blur(8px)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: 'var(--color-accent)',
                animation: 'live-pulse 1.8s ease-in-out infinite',
              }}
              aria-hidden
            />
            {t('home.toolTagLiveService')}
          </span>
          <Icon
            className="w-16 h-16 transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-3"
            style={{ color: 'var(--color-accent)', strokeWidth: 1.2 }}
            aria-hidden
          />
        </div>

        <div className="p-6 flex flex-col flex-1">
          <h3
            className="text-base leading-snug mb-2"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--color-fg)',
            }}
          >
            {t(cfg.titleKey)}
          </h3>
          <p
            className="text-xs leading-relaxed mb-5 line-clamp-2 flex-1"
            style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}
          >
            {t(cfg.ledeKey)}
          </p>

          <div className="flex flex-wrap gap-1.5 mb-5">
            {cfg.tags.map((tagKey) => (
              <span
                key={tagKey}
                className="text-[10px] px-2.5 py-1 rounded-full"
                style={{
                  background: 'rgba(168, 128, 107, 0.08)',
                  color: 'var(--color-accent)',
                }}
              >
                {t(tagKey)}
              </span>
            ))}
          </div>

          <div
            className="flex justify-between items-center pt-4"
            style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}
          >
            <span
              className="text-[10px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('home.toolRunServerSide')}
            </span>
            <span
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] transition-colors group-hover:text-[color:var(--color-accent)]"
              style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
            >
              {t('home.openTool')}
              <ArrowUpRight
                className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                strokeWidth={1.5}
              />
            </span>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}

import type { LucideIcon } from 'lucide-react';

// Per-tool card config. The card is generic; each tool only needs to supply
// its icon, route, title/lede keys, and tag keys.
const TOOL_META: Record<
  'path-doctor' | 'format-bridge' | 'gsplats-trainer',
  ToolMeta
> = {
  'path-doctor': {
    to: '/tools/hip-path-doctor',
    icon: Stethoscope,
    titleKey: 'tool.title',
    ledeKey: 'tool.lede',
    tags: [
      'home.toolTagHoudini',
      'home.toolTagLiveService',
      'home.toolTagHipRepair',
      'home.toolTagFree',
    ],
    bannerStyle:
      'linear-gradient(135deg, rgba(168,128,107,0.18), rgba(212,184,150,0.10) 50%, rgba(220,204,228,0.18))',
  },
  'format-bridge': {
    to: '/tools/hip-format-bridge',
    icon: Package,
    titleKey: 'bridge.title',
    ledeKey: 'bridge.lede',
    tags: [
      'home.toolTagHoudini',
      'home.toolTagLiveService',
      'home.toolTagFormatBridge',
      'home.toolTagFree',
    ],
    bannerStyle:
      'linear-gradient(135deg, rgba(176,196,212,0.18), rgba(220,204,228,0.10) 50%, rgba(168,128,107,0.14))',
  },
  'gsplats-trainer': {
    to: '/tools/gsplats-trainer',
    icon: Sparkles,
    titleKey: 'gsplats.title',
    ledeKey: 'gsplats.lede',
    tags: [
      'home.toolTagHoudini',
      'home.toolTagLiveService',
      'home.toolTagGsplats',
      'home.toolTagFree',
    ],
    bannerStyle:
      'linear-gradient(135deg, rgba(220,204,228,0.18), rgba(168,128,107,0.10) 50%, rgba(176,196,212,0.16))',
  },
};
