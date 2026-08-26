import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Package, Sparkles, Stethoscope } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { useI18n } from '../i18n/I18nContext';

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
}

export default function Home() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchResources();
  }, []);

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

  return (
    <div className="mt-2">
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <ToolFeatureCard kind="path-doctor" index={0} />
          <ToolFeatureCard kind="format-bridge" index={1} />
          <ToolFeatureCard kind="gsplats-trainer" index={2} />
          {resources.map((resource, i) => (
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
    parsedTags = JSON.parse(resource.tags);
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
          className="text-base leading-snug mb-2 line-clamp-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--color-fg)',
          }}
        >
          {resource.title}
        </h3>
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
          className="flex justify-between items-center pt-4"
          style={{ borderTop: '1px solid rgba(26, 24, 20, 0.05)' }}
        >
          <span
            className="text-[10px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {t('home.downloadsCount', { count: resource.downloadCount.toString().padStart(2, '0') })}
          </span>
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
