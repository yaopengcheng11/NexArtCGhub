import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Package, Sparkles, Stethoscope, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { AnimatePresence, motion } from 'motion/react';
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
      {/* ─── Taxonomy filter rail ─── */}
      {!loading && resources.length > 0 && (
        <FilterRail
          filters={filters}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
          total={resources.length}
          shown={filtered.length}
        />
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
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-6">
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

// ─── Filter rail ─────────────────────────────────────────────────────────
// Editorial "spec sheet" rail: each taxonomy dimension gets a micro-label
// and a row of pills. Category + segmented controls carry a shared-layout
// glider so the active state slides between options instead of snapping.

function FilterRail({
  filters,
  onChange,
  onClear,
  total,
  shown,
}: {
  filters: Filters;
  // Functional updater so rapid clicks on different dimensions can't
  // overwrite each other with a stale closure snapshot.
  onChange: (update: (prev: Filters) => Filters) => void;
  onClear: () => void;
  total: number;
  shown: number;
}) {
  const { t } = useI18n();
  const filtersActive =
    filters.category !== '' ||
    filters.type !== '' ||
    filters.free !== '' ||
    filters.sort !== EMPTY_FILTERS.sort;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mb-6 sm:mb-10 rounded-3xl px-4 py-4 sm:px-7 sm:py-6"
      style={{
        background: 'rgba(251, 250, 246, 0.65)',
        border: '1px solid rgba(26, 24, 20, 0.06)',
        boxShadow:
          '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(26, 24, 20, 0.10)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* Category */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-6">
        <RailLabel text={t('home.filterCategory')} />
        <div
          role="group"
          aria-label={t('home.filterCategory')}
          className="flex flex-wrap items-center gap-1.5"
        >
          <CategoryChip
            active={filters.category === ''}
            onClick={() => onChange((f) => ({ ...f, category: '' }))}
          >
            {t('home.filterAll')}
          </CategoryChip>
          {ADMIN_CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              active={filters.category === c}
              onClick={() => onChange((f) => ({ ...f, category: c }))}
            >
              {c}
            </CategoryChip>
          ))}
        </div>
      </div>

      <div className="my-4 h-px bg-[rgba(26,24,20,0.06)]" />

      {/* Type */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-6">
        <RailLabel text={t('home.filterType')} active={filters.type !== ''} />
        <div
          role="group"
          aria-label={t('home.filterType')}
          className="flex flex-wrap items-center gap-1.5"
        >
          <TypeChip
            active={filters.type === ''}
            onClick={() => onChange((f) => ({ ...f, type: '' }))}
          >
            {t('home.filterAll')}
          </TypeChip>
          {ADMIN_RESOURCE_TYPES.map((tp) => (
            <TypeChip
              key={tp}
              active={filters.type === tp}
              onClick={() => onChange((f) => ({ ...f, type: tp }))}
            >
              {t(`resourceType.${tp}`)}
            </TypeChip>
          ))}
        </div>
      </div>

      <div className="my-4 h-px bg-[rgba(26,24,20,0.06)]" />

      {/* Price + sort + counter */}
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
        <div className="flex items-center gap-3">
          <RailLabel text={t('home.filterPrice')} active={filters.free !== ''} />
          <Segmented
            layoutId="rail-price-glider"
            ariaLabel={t('home.filterPrice')}
            value={filters.free}
            onChange={(v) => onChange((f) => ({ ...f, free: v as Filters['free'] }))}
            options={[
              { value: '', label: t('home.filterAll') },
              { value: '1', label: t('home.badgeFree') },
              { value: '0', label: t('home.badgePaid') },
            ]}
          />
        </div>
        <div className="flex items-center gap-3">
          <RailLabel text={t('home.filterSort')} active={filters.sort !== EMPTY_FILTERS.sort} />
          <Segmented
            layoutId="rail-sort-glider"
            ariaLabel={t('home.filterSort')}
            value={filters.sort}
            onChange={(v) => onChange((f) => ({ ...f, sort: v as Filters['sort'] }))}
            options={[
              { value: 'new', label: t('home.sortNew') },
              { value: 'downloads', label: t('home.sortDownloads') },
            ]}
          />
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span
            className="text-[10px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
          >
            {shown} / {total}
          </span>
          <AnimatePresence initial={false}>
            {filtersActive && (
              <motion.button
                key="clear"
                type="button"
                onClick={onClear}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-1.5 rounded-full px-3 py-[6px] text-[10px] uppercase tracking-[0.16em] cursor-pointer transition-colors duration-300 hover:bg-[rgba(168,128,107,0.08)]"
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-accent)',
                  border: '1px solid rgba(168, 128, 107, 0.30)',
                }}
              >
                <X className="w-3 h-3" strokeWidth={1.5} />
                {t('home.filterClear')}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
}

function RailLabel({ text, active = false }: { text: string; active?: boolean }) {
  return (
    <span
      className="flex items-center gap-2 sm:w-24 shrink-0 text-[10px] uppercase tracking-[0.22em] transition-colors duration-300"
      style={{
        fontFamily: 'var(--font-mono)',
        color: active ? 'var(--color-accent)' : 'var(--color-fg-faint)',
      }}
    >
      <span
        className="h-1 w-1 rounded-full transition-colors duration-300"
        style={{ background: active ? 'var(--color-accent)' : 'transparent' }}
        aria-hidden
      />
      {text}
    </span>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'relative rounded-full px-4 py-[7px] text-[11px] font-medium uppercase tracking-[0.14em]',
        'cursor-pointer transition-colors duration-300',
        active ? 'text-[color:var(--color-elevated)]' : 'text-[color:var(--color-fg-soft)]'
      )}
    >
      {active ? (
        <motion.span
          layoutId="rail-category-glider"
          className="absolute inset-0 rounded-full"
          style={{
            background: 'var(--color-fg)',
            boxShadow: '0 10px 24px -12px rgba(26, 24, 20, 0.55)',
          }}
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      ) : (
        <span className="absolute inset-0 rounded-full bg-[rgba(26,24,20,0.05)] opacity-0 transition-opacity duration-300 hover:opacity-100" />
      )}
      <span className="relative z-10 whitespace-nowrap">{children}</span>
    </button>
  );
}

function TypeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-[5px] text-[10px] font-medium uppercase tracking-[0.12em]',
        'border cursor-pointer transition-all duration-300 whitespace-nowrap',
        active
          ? 'text-[color:var(--color-accent)] bg-[rgba(168,128,107,0.10)] border-[rgba(168,128,107,0.32)]'
          : 'text-[color:var(--color-fg-muted)] bg-transparent border-[rgba(26,24,20,0.10)] hover:text-[color:var(--color-fg-soft)] hover:border-[rgba(26,24,20,0.24)] hover:bg-[rgba(26,24,20,0.03)]'
      )}
    >
      {children}
    </button>
  );
}

function Segmented({
  layoutId,
  value,
  onChange,
  options,
  ariaLabel,
}: {
  layoutId: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-full p-[3px]"
      style={{
        background: 'rgba(26, 24, 20, 0.05)',
        border: '1px solid rgba(26, 24, 20, 0.04)',
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative rounded-full px-3.5 py-[5px] text-[10px] font-medium uppercase tracking-[0.14em]',
              'cursor-pointer transition-colors duration-300',
              active ? 'text-[color:var(--color-fg)]' : 'text-[color:var(--color-fg-muted)] hover:text-[color:var(--color-fg-soft)]'
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'var(--color-elevated)',
                  boxShadow:
                    '0 1px 0 rgba(26, 24, 20, 0.04), 0 2px 10px -2px rgba(26, 24, 20, 0.18)',
                }}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative z-10 whitespace-nowrap">{opt.label}</span>
          </button>
        );
      })}
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
        'group relative flex flex-col overflow-hidden rounded-2xl sm:rounded-3xl cursor-pointer',
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
      <div className="relative h-28 sm:h-44 overflow-hidden" style={{ background: 'var(--color-deep)' }}>
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
            className="absolute top-2 left-2 sm:top-4 sm:left-4 px-2 py-0.5 sm:px-3 sm:py-1 text-[9px] sm:text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em]"
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

      <div className="p-3 sm:p-6 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-1 sm:mb-2">
          {resource.resType && (
            <span
              className="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] px-1.5 py-0.5 sm:px-2 rounded-full"
              style={{
                color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                background: 'rgba(26, 24, 20, 0.04)',
              }}
            >
              {t(`resourceType.${resource.resType}`)}
            </span>
          )}
          <h3
            className="text-[13px] sm:text-base leading-snug line-clamp-2"
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
          className="hidden sm:block text-xs leading-relaxed mb-5 line-clamp-2 flex-1"
          style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}
        >
          {resource.description}
        </p>

        {parsedTags.length > 0 && (
          <div className="hidden sm:flex flex-wrap gap-1.5 mb-5">
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
          className="flex items-center justify-end pt-2.5 sm:pt-4 mt-auto"
          style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}
        >
          <span
            className="flex items-center gap-1.5 text-[9px] sm:text-[10px] uppercase tracking-[0.2em] transition-colors group-hover:text-[color:var(--color-accent)]"
            style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
          >
            {t('home.view')}
            <ArrowUpRight
              className="w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
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
      className="group relative flex flex-col overflow-hidden rounded-2xl sm:rounded-3xl cursor-pointer"
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
          className="relative h-28 sm:h-44 overflow-hidden flex items-center justify-center"
          style={{
            background: cfg.bannerStyle,
          }}
        >
          {/* Live badge */}
          <span
            className="absolute top-2 left-2 sm:top-4 sm:left-4 px-2 py-0.5 sm:px-3 sm:py-1 text-[9px] sm:text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em] inline-flex items-center gap-1.5"
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
            className="w-10 h-10 sm:w-16 sm:h-16 transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-3"
            style={{ color: 'var(--color-accent)', strokeWidth: 1.2 }}
            aria-hidden
          />
        </div>

        <div className="p-3 sm:p-6 flex flex-col flex-1">
          <h3
            className="text-[13px] sm:text-base leading-snug mb-1 sm:mb-2"
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
            className="hidden sm:block text-xs leading-relaxed mb-5 line-clamp-2 flex-1"
            style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}
          >
            {t(cfg.ledeKey)}
          </p>

          <div className="hidden sm:flex flex-wrap gap-1.5 mb-5">
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
            className="flex items-center justify-end sm:justify-between pt-2.5 sm:pt-4 mt-auto"
            style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}
          >
            <span
              className="hidden sm:inline text-[10px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('home.toolRunServerSide')}
            </span>
            <span
              className="flex items-center gap-1.5 text-[9px] sm:text-[10px] uppercase tracking-[0.2em] transition-colors group-hover:text-[color:var(--color-accent)]"
              style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
            >
              {t('home.openTool')}
              <ArrowUpRight
                className="w-3 h-3 sm:w-3.5 sm:h-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
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
