import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Layers, Box, Triangle, Cpu, Image as ImageIcon, CheckCircle2, AlertTriangle, Key, Copy, Check } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';

interface BlendAssetItem {
  id: string;
  name: string;
  type: string;
  parentCollection: string | null;
  instanceCount: number;
  vertCount: number;
  triCount: number;
  materialCount: number;
  textureCount: number;
  hasArmature: boolean;
}

interface BlendAssetTagGroups {
  status: 'ready' | 'processing' | string;
  schema: 'blend-asset-v1';
  blenderVersion: string | null;
  thumbnailReady?: boolean;
  resourceId?: number;
  // Scene spec (added 2026-08-24; may be null on older resources that
  // were processed before the manifest extractor was extended)
  frameStart?: number | null;
  frameEnd?: number | null;
  fps?: number | null;
  resolutionX?: number | null;
  resolutionY?: number | null;
  aspectRatio?: string | null;
  renderEngine?: string | null;
  lightSetup?: {
    sun?: number;
    point?: number;
    spot?: number;
    area?: number;
    hemi?: number;
    hdriWorld?: boolean;
  } | null;
  summary: {
    assets: BlendAssetItem[];
    assetCount: number;
    actionCount: number;
    actions?: { name: string; frames: [number, number]; durationSeconds: number }[];
    textureCount: number;
    missingTextures: number;
  };
}

interface Resource {
  id: number;
  title: string;
  description: string;
  category: string;
  tags: string;
  imageUrl: string;
  fileUrl: string;
  // 百度网盘分享链接的提取码(可空, 整包下载按钮用)
  panCode?: string | null;
  downloadCount: number;
  createdAt: string;
  // Taxonomy (资源分类体系) — optional, absent on legacy rows pre-backfill
  resType?: string | null;
  license?: string | null;
  language?: string | null;
  isFree?: number | null;
  // Future content fields (optional; placeholders used when absent)
  videoUrl?: string;
  screenshots?: string[];
  highlights?: string[];
  tagGroups?:
    | { software?: string[]; element?: string[]; technique?: string[] }
    | BlendAssetTagGroups
    | null;
}

const PLACEHOLDER_HIGHLIGHTS = [
  'Fully procedural with seed-controllable variation',
  'GPU-accelerated real-time preview',
  'Drop-in compatible with industry-standard pipelines',
];

function isBlendAsset(tg: Resource['tagGroups']): tg is BlendAssetTagGroups {
  return !!tg && (tg as BlendAssetTagGroups).schema === 'blend-asset-v1';
}

// ---- dynamic highlight generator (added 2026-08-24) -----------------
// Replaces the static PLACEHOLDER_HIGHLIGHTS for blend assets. Reads
// real numbers out of the manifest so the bullets actually describe
// THIS resource instead of every resource the same way.
function buildHighlights(tg: BlendAssetTagGroups): string[] {
  const out: string[] = [];
  const s = tg.summary;

  // 1) asset shape
  const colCount = new Set(s.assets.map(a => a.parentCollection).filter(Boolean)).size;
  const instTotal = s.assets.reduce((acc, a) => acc + (a.instanceCount ?? 1), 0);
  const triTotal = s.assets.reduce(
    (acc, a) => acc + (a.triCount ?? 0) * Math.max(1, a.instanceCount ?? 1),
    0,
  );
  const matTotal = s.assets.reduce((acc, a) => acc + (a.materialCount ?? 0), 0);

  if (s.assetCount > 0) {
    const triStr = triTotal >= 1000
      ? `${(triTotal / 1000).toFixed(0)}K tri`
      : `${triTotal} tri`;
    // Note: instance count = how many copies are placed in the scene
    // (e.g. 79 copies of one Tree mesh). Asset count = unique meshes.
    const instNote = instTotal > s.assetCount
      ? `  (${s.assetCount} unique, ${instTotal} placed in scene)`
      : '';
    out.push(
      `${s.assetCount} unique ${s.assetCount === 1 ? 'asset' : 'assets'} across ${colCount || 1} ` +
      `Blender ${colCount === 1 ? 'collection' : 'collections'}${instNote}, ` +
      `${triStr} total, ${matTotal} ${matTotal === 1 ? 'material' : 'materials'}`
    );
  }

  // 2) animation
  const animActions = (s.actions || []).filter(
    (a: any) => a.name && !/^Camera/i.test(a.name)
  );
  const camActions = (s.actions || []).filter(
    (a: any) => a.name && /^Camera/i.test(a.name)
  );
  if (s.actionCount > 0) {
    const parts: string[] = [];
    if (animActions.length > 0) parts.push(`${animActions.length} object animation${animActions.length === 1 ? '' : 's'}`);
    if (camActions.length > 0) parts.push(`${camActions.length} camera move${camActions.length === 1 ? '' : 's'}`);
    if (parts.length > 0) {
      out.push(`${s.actionCount} animation actions: ${parts.join(' + ')}`);
    } else {
      out.push(`${s.actionCount} animation actions included`);
    }
  } else {
    out.push('Fully static — no animation actions (drag freely in viewport)');
  }

  // 3) texture health
  if (s.missingTextures === 0 && s.textureCount > 0) {
    out.push(`${s.textureCount} texture dep${s.textureCount === 1 ? '' : 's'} bundled, all paths resolved`);
  } else if (s.missingTextures > 0) {
    out.push(`⚠ ${s.missingTextures} of ${s.textureCount} texture${s.textureCount === 1 ? '' : 's'} missing on disk — see Spec`);
  } else if (s.textureCount === 0) {
    out.push('Procedural materials — zero external texture dependencies');
  }

  // 4) light setup
  const ls = tg.lightSetup;
  if (ls) {
    const types: string[] = [];
    if ((ls.sun ?? 0) > 0) types.push(`${ls.sun} sun`);
    if ((ls.area ?? 0) > 0) types.push(`${ls.area} area`);
    if ((ls.point ?? 0) > 0) types.push(`${ls.point} point`);
    if ((ls.spot ?? 0) > 0) types.push(`${ls.spot} spot`);
    if (ls.hdriWorld) types.push('HDRI world background');
    if (types.length > 0) {
      out.push(`Lighting setup: ${types.join(' + ')}`);
    }
  }

  // 5) render engine
  if (tg.renderEngine) {
    const engine = tg.renderEngine.toLowerCase()
      .replace('blender_eevee_next', 'Eevee (Next)')
      .replace('cycles', 'Cycles')
      .replace('blender_workbench', 'Workbench');
    out.push(`Designed for ${engine}`);
  }

  return out;
}

// ---- Spec section (added 2026-08-24) -------------------------------
// Renders the manifest's render/timing spec as a 2-column monospace
// key:value grid. Shows "N/A" for fields the parser didn't extract
// (older manifests pre-2026-08-24 don't have these).
//
// For older manifests we FALL BACK to the camera actions to recover
// frame range + FPS: the longest camera animation in the scene is
// treated as the canonical "render length" (it's almost always the
// case that the camera animates over the whole renderable range).
function SpecSection({ tg, t }: { tg: BlendAssetTagGroups; t: (k: string) => string }) {
  const cell = (label: string, value: string | number | null | undefined, hint?: string | null) => {
    const missing = value == null || value === '';
    return (
      <div className="flex flex-col">
        <span
          className="text-[9px] uppercase tracking-[0.2em] mb-1"
          style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
        >
          {label}
        </span>
        <span
          className="text-sm font-medium"
          style={{
            color: missing ? 'var(--color-fg-faint)' : 'var(--color-fg)',
            fontFamily: 'var(--font-mono)',
            fontStyle: missing ? 'italic' : 'normal',
          }}
        >
          {missing ? 'N/A' : value}
        </span>
        {hint != null && (
          <span
            className="text-[9px] mt-0.5"
            style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
          >
            {hint}
          </span>
        )}
      </div>
    );
  };

  // Primary values from the new parser fields
  let frameRange: string | null = null;
  let fps: number | null = tg.fps ?? null;
  if (tg.frameStart != null && tg.frameEnd != null) {
    frameRange = `${tg.frameStart} – ${tg.frameEnd}  (${tg.frameEnd - tg.frameStart + 1} frames)`;
  }
  const engine = tg.renderEngine
    ? tg.renderEngine.toLowerCase()
        .replace('blender_eevee_next', 'Eevee (Next)')
        .replace('cycles', 'Cycles')
        .replace('blender_workbench', 'Workbench')
    : null;

  // Fallback: if the new parser fields are missing, try to recover
  // frame range + FPS from the longest camera action in summary.actions.
  // This covers resources whose manifest was generated before the
  // parser was extended.
  let usedFallback = false;
  if (!frameRange || fps == null) {
    const actions = tg.summary.actions || [];
    let best: { span: number; fps: number; frames: [number, number] } | null = null;
    for (const a of actions) {
      const frames = (a as any).frames as [number, number] | undefined;
      const dur = (a as any).durationSeconds as number | undefined;
      if (!frames || !dur || dur <= 0) continue;
      const span = frames[1] - frames[0] + 1;
      if (span <= 0) continue;
      if (best === null || span > best.span) {
        best = { span, fps: Math.round(span / dur), frames };
      }
    }
    if (best) {
      if (!frameRange) {
        frameRange = `${best.frames[0]} – ${best.frames[1]}  (${best.span} frames, inferred from camera action)`;
      }
      if (fps == null) {
        fps = best.fps;
      }
      usedFallback = true;
    }
  }

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between mb-6">
        <p
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          {t('detail.spec')}
        </p>
        {usedFallback && (
          <span
            className="text-[9px] uppercase tracking-[0.2em]"
            style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
            title="Re-run blend_asset_parser.py with Blender installed to fill in remaining fields."
          >
            partially inferred
          </span>
        )}
      </div>
      <div
        className="rounded-2xl p-6 grid grid-cols-2 md:grid-cols-2 gap-y-5 gap-x-6"
        style={{
          background: 'rgba(251, 250, 246, 0.5)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
        }}
      >
        {cell(t('spec.blenderVersion'), tg.blenderVersion ?? null)}
        {cell(t('spec.renderer'), engine ?? null,
          engine ? null : 'run manage.py reparse <id>')}
        {cell(t('spec.frameRange'), frameRange)}
        {cell(t('spec.fps'), fps)}
      </div>
      {tg.summary.missingTextures > 0 && (
        <p
          className="mt-4 text-xs flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            color: '#a05a2c',
            background: 'rgba(160, 90, 44, 0.08)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {tg.summary.missingTextures} texture{tg.summary.missingTextures === 1 ? '' : 's'} missing on disk — see <code>data/blend_assets/{tg.resourceId}/manifest.json</code>
        </p>
      )}
    </section>
  );
}

function formatNum(n: number): string {
  return n.toLocaleString('en-US');
}

// Tiny stat pill (icon + count) for inline use in cards.
function StatChip({
  icon: Icon,
  label,
}: {
  icon: typeof Box;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
      style={{
        background: 'rgba(26, 24, 20, 0.04)',
        color: 'var(--color-fg-soft)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <Icon className="w-3 h-3" style={{ color: 'var(--color-fg-muted)' }} />
      {label}
    </span>
  );
}

// Baidu-pan extraction code pill — click to copy. Shown next to every
// download button that opens a baidu-pan share link, so visitors (who
// are NOT the file owner) can copy the code and paste it into baidu's
// "请输入提取码" prompt. The file owner sees no prompt so the pill is
// only useful for everyone else, but we show it unconditionally to
// keep the UI consistent.
function PanCodePill({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable; user can still read the code */ }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title="点击复制提取码"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] rounded-full transition-colors"
      style={{
        background: copied ? 'rgba(74,124,89,0.12)' : 'rgba(26,24,20,0.04)',
        color: 'var(--color-fg-muted)',
        fontFamily: 'var(--font-mono)',
        border: '1px solid rgba(26,24,20,0.08)',
      }}
    >
      <Key className="w-3 h-3" />
      <span>提取码</span>
      <span
        style={{
          fontWeight: 600,
          color: 'var(--color-fg)',
          letterSpacing: '0.06em',
          textTransform: 'none',
        }}
      >
        {code}
      </span>
      {copied
        ? <Check className="w-3 h-3" style={{ color: '#4a7c59' }} />
        : <Copy className="w-3 h-3" style={{ opacity: 0.5 }} />}
    </button>
  );
}

// Top-level grid wrapper for the blend asset panel. Header shows
// the blender version + asset count + texture status; list renders
// one row per Blender collection.
function BlendAssetPanel({
  tg, t, panLink,
}: {
  tg: BlendAssetTagGroups;
  t: (key: string, vars?: Record<string, string | number>) => string;
  panLink?: { url: string; code?: string | null };
}) {
  const s = tg.summary;

  return (
    <section className="mb-16">
      {/* Header card: badge + status chips + full-pack CTA */}
      <div
        className="rounded-2xl p-5 mb-4"
        style={{
          background: 'rgba(251, 250, 246, 0.5)',
          border: '1px solid rgba(26, 24, 20, 0.06)',
        }}
      >
        {/* Row 1: badge + info chips */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <p
            className="text-[10px] uppercase tracking-[0.3em] mr-1"
            style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
          >
            {t('detail.bl.blendBadge')}
          </p>
          <span
            className="text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
            style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
              background: 'rgba(26, 24, 20, 0.04)' }}
          >
            {s.assetCount === 1
              ? t('detail.bl.assetSingle')
              : t('detail.bl.assetCount', { count: s.assetCount })}
          </span>
          {tg.blenderVersion && (
            <span
              className="text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                background: 'rgba(26, 24, 20, 0.04)' }}
            >
              Blender {tg.blenderVersion}
            </span>
          )}
          {s.missingTextures === 0 ? (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{
                color: '#4a7c59',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(74, 124, 89, 0.10)',
              }}
            >
              <CheckCircle2 className="w-3 h-3" />
              {t('detail.bl.allResolved')}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full"
              style={{
                color: '#a86a4a',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(160, 90, 44, 0.10)',
              }}
            >
              <AlertTriangle className="w-3 h-3" />
              {t('detail.bl.someMissing', { count: s.missingTextures })}
            </span>
          )}
        </div>

        {/* Row 2: full-pack download CTA + extraction code */}
        {panLink?.url && (
          <div className="flex items-center gap-3 flex-wrap">
            <a
              href={panLink.url}
              target="_blank"
              rel="noopener,noreferrer"
              onClick={() => {
                fetch(`/api/resources/${tg.resourceId}/download`, { method: 'POST' });
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[10px] uppercase tracking-[0.25em] rounded-full transition-colors"
              style={{
                background: 'var(--color-fg)',
                color: 'var(--color-elevated)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Download className="w-3.5 h-3.5" />
              {t('detail.bl.fullDownload')}
            </a>
            {panLink?.code && (
              <span className="text-[9px] uppercase tracking-[0.18em]"
                style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}>
                整包 提取码:
              </span>
            )}
            {panLink?.code && <PanCodePill code={panLink.code} />}
          </div>
        )}
      </div>

      <p
        className="text-[10px] uppercase tracking-[0.18em] mt-5"
        style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
      >
        {t('detail.bl.assetFirstBuild')}
      </p>
    </section>
  );
}

// Renders section — one image per scene camera, straight from the
// server's per-camera render job. Click opens a lightbox modal
// with the full-resolution PNG (no more "new tab" redirect).
function CameraRenders({
  resourceId,
  fallback,
  t,
}: {
  resourceId: number;
  fallback?: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [renders, setRenders] = useState<{ url: string; camera: string }[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/blend-assets/${resourceId}/renders`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.renders?.length) setRenders(d.renders);
      })
      .catch(() => {});
  }, [resourceId]);

  // Keyboard: ESC to close, ←/→ to navigate
  useEffect(() => {
    if (lightboxIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowLeft' && lightboxIdx > 0) setLightboxIdx(lightboxIdx - 1);
      else if (e.key === 'ArrowRight' && lightboxIdx < renders.length - 1) setLightboxIdx(lightboxIdx + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxIdx, renders.length]);

  if (!renders.length) return null;

  return (
    <section className="mb-16">
      <div className="flex items-baseline justify-between mb-6">
        <p
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          {t('detail.screenshots')}
        </p>
        <p
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
        >
          {renders.length} {renders.length === 1 ? 'camera' : 'cameras'} · click to expand
        </p>
      </div>

      {/* 2-column grid on md+, single column on mobile. Click opens
          the lightbox (no more new-tab redirect). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renders.map((r, i) => (
          <button
            key={r.url}
            type="button"
            onClick={() => setLightboxIdx(i)}
            className="block relative overflow-hidden rounded-2xl group cursor-zoom-in text-left p-0 border-0"
            style={{
              border: '1px solid rgba(26, 24, 20, 0.06)',
              boxShadow:
                '0 1px 0 rgba(26, 24, 20, 0.03), 0 16px 40px -22px rgba(26, 24, 20, 0.14)',
            }}
          >
            <img
              src={r.url}
              alt={`Render from ${r.camera}`}
              className="w-full h-auto transition-transform duration-700 group-hover:scale-[1.02]"
            />
            <span
              className="absolute top-3 left-3 px-2.5 py-1 text-[10px] font-medium rounded-full uppercase tracking-[0.15em]"
              style={{
                background: 'rgba(251, 250, 246, 0.92)',
                color: 'var(--color-fg)',
                backdropFilter: 'blur(8px)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {r.camera === 'default'
                ? t('detail.screenshot')
                : r.camera}
            </span>
            <span
              className="absolute bottom-3 right-3 px-2 py-0.5 text-[9px] font-medium rounded-full uppercase tracking-[0.15em] opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                background: 'rgba(26, 24, 20, 0.85)',
                color: 'var(--color-elevated)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              + click to expand
            </span>
          </button>
        ))}
      </div>

      {/* Lightbox modal — full-screen overlay with the full-res PNG. */}
      {lightboxIdx !== null && (
        <ScreenshotsLightbox
          renders={renders}
          index={lightboxIdx}
          onIndexChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </section>
  );
}

// Full-screen lightbox for screenshot viewing. Renders the current
// image at full resolution with dim backdrop, prev/next arrows, and
// ESC/click-outside-to-close.  Added 2026-08-24 (replaces the
// "open in new tab" behavior — that was jarring and broke the page
// flow).
function ScreenshotsLightbox({
  renders,
  index,
  onIndexChange,
  onClose,
}: {
  renders: { url: string; camera: string }[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const cur = renders[index];
  if (!cur) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10"
      style={{ background: 'rgba(15, 14, 12, 0.92)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white text-xl"
        style={{ background: 'rgba(255, 255, 255, 0.12)' }}
      >
        ✕
      </button>

      {/* Prev / Next */}
      {renders.length > 1 && (
        <>
          {index > 0 && (
            <button
              type="button"
              aria-label="Previous"
              onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }}
              className="absolute left-2 md:left-6 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white text-lg"
              style={{ background: 'rgba(255, 255, 255, 0.12)' }}
            >
              ‹
            </button>
          )}
          {index < renders.length - 1 && (
            <button
              type="button"
              aria-label="Next"
              onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }}
              className="absolute right-2 md:right-6 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white text-lg"
              style={{ background: 'rgba(255, 255, 255, 0.12)' }}
            >
              ›
            </button>
          )}
        </>
      )}

      {/* Image + caption */}
      <figure
        className="relative max-w-full max-h-full flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={cur.url}
          alt={`Render from ${cur.camera}`}
          className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
        />
        <figcaption
          className="mt-4 text-[10px] uppercase tracking-[0.25em] text-white/70 font-mono"
        >
          {cur.camera === 'default' ? 'Screenshot' : cur.camera}
          <span className="mx-2 text-white/30">·</span>
          {index + 1} / {renders.length}
        </figcaption>
      </figure>
    </div>
  );
}

export default function ResourceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [resource, setResource] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    // Guard against stale responses: if the user navigates from
    // /resource/1 to /resource/2 while request 1 is still in flight, the
    // cleanup flips `active` and request 1's handlers no-op. Without this
    // the old resource could overwrite the new one (or its finally could
    // clear loading for the wrong request).
    let active = true;
    fetch(`/api/resources/${id}`)
      .then((r) => {
        if (!active) return null;
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!active) return;
        if (data) {
          // tagGroups is stored as a JSON string in SQLite and the
          // server returns it raw — parse it so type guards like
          // isBlendAsset() can read the .schema field.
          if (typeof data.tagGroups === 'string') {
            try { data.tagGroups = JSON.parse(data.tagGroups); }
            catch { data.tagGroups = null; }
          }
          setResource(data);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error(err);
        setNotFound(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const handleDownload = (e?: React.MouseEvent) => {
    e?.preventDefault();
    if (!resource) return;
    // 1. count +1
    fetch(`/api/resources/${resource.id}/download`, { method: 'POST' });
    // 2. open file URL in new tab (skip the '#' placeholder)
    if (resource.fileUrl && resource.fileUrl !== '#') {
      window.open(resource.fileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <div
          className="w-8 h-8 border-2 rounded-full animate-spin"
          style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
        />
      </div>
    );
  }

  if (notFound || !resource) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Layers className="w-10 h-10 mb-4" style={{ color: 'var(--color-fg-faint)' }} />
        <h1
          className="text-2xl mb-2"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--color-fg)',
          }}
        >
          {t('detail.resourceNotFound')}
        </h1>
        <p
          className="text-xs mb-8"
          style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {t('detail.resourceNotFoundHint')}
        </p>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
          style={{
            color: 'var(--color-fg-soft)',
            border: '1px solid rgba(26, 24, 20, 0.12)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-deep)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t('detail.backToLibrary')}
        </button>
      </div>
    );
  }

  // Parse tags (JSON string or comma-separated fallback)
  let parsedTags: string[] = [];
  try {
    const parsed = JSON.parse(resource.tags);
    // Valid JSON that isn't an array (null, object) would crash the
    // .map()/.slice() below — treat it as "no tags".
    parsedTags = Array.isArray(parsed) ? parsed : [];
  } catch {
    parsedTags = resource.tags ? resource.tags.split(',') : [];
  }

  // Content data with fallbacks. For blend assets, generate
  // data-driven highlights from the manifest (asset count, tri count,
  // animation actions, textures, lights, render engine). For
  // non-blend resources, fall back to the static placeholder.
  const highlights = isBlendAsset(resource.tagGroups)
    ? buildHighlights(resource.tagGroups)
    : (resource.highlights ?? PLACEHOLDER_HIGHLIGHTS);

  return (
    <article>
      {/* ===== Top bar: back + breadcrumb ===== */}
      <div className="flex items-center justify-between mb-8">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] transition-colors"
          style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t('detail.backToLibrary')}
        </button>
        <p
          className="text-[10px] uppercase tracking-[0.3em] hidden sm:block"
          style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
        >
          {t('detail.breadcrumb', { category: resource.category === 'UE' ? 'UE5' : resource.category })}
        </p>
      </div>

      {/* ===== Hero image (21:9) ===== */}
      <div
        className="relative w-full overflow-hidden rounded-3xl mb-12"
        style={{
          aspectRatio: '21 / 9',
          background: 'var(--color-deep)',
          boxShadow:
            '0 1px 0 rgba(26, 24, 20, 0.03), 0 30px 80px -30px rgba(26, 24, 20, 0.20)',
        }}
      >
        <span
          className="absolute top-6 left-6 px-4 py-1.5 text-[10px] font-medium rounded-full z-10 uppercase tracking-[0.15em]"
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
            className="h-full w-full object-cover"
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

      {/* ===== Body ===== */}
      <div className="max-w-3xl mx-auto pb-16">
        {/* Title block */}
        <h1
          className="text-2xl md:text-3xl mb-4"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 500,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            color: 'var(--color-fg)',
          }}
        >
          {resource.title}
        </h1>

        <p
          className="text-sm italic mb-6"
          style={{
            color: 'var(--color-fg-muted)',
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
          }}
        >
          {resource.category === 'UE'
            ? t('detail.categoryUnreal')
            : t('detail.categoryResource', { category: resource.category })}
        </p>

        {/* Taxonomy chips: 免费/付费 + 类型 + 许可 + 语言 (hidden when unset) */}
        {(resource.isFree !== undefined && resource.isFree !== null) ||
        resource.resType ||
        resource.license ||
        resource.language ? (
          <div className="flex items-center gap-2 flex-wrap mb-10">
            {resource.isFree !== undefined && resource.isFree !== null && (
              <span
                className="text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                style={{
                  color: resource.isFree ? '#4a7c59' : 'var(--color-fg)',
                  fontFamily: 'var(--font-mono)',
                  background: resource.isFree ? 'rgba(74, 124, 89, 0.10)' : 'rgba(168, 128, 107, 0.12)',
                }}
              >
                {resource.isFree ? t('home.badgeFree') : t('home.badgePaid')}
              </span>
            )}
            {resource.resType && (
              <span
                className="text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                style={{
                  color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                  background: 'rgba(26, 24, 20, 0.04)',
                }}
              >
                {t(`resourceType.${resource.resType}`)}
              </span>
            )}
            {resource.license && (
              <span
                className="text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                style={{
                  color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                  background: 'rgba(26, 24, 20, 0.04)',
                }}
              >
                {t(`license.${resource.license}`)}
              </span>
            )}
            {resource.language && (
              <span
                className="text-[10px] uppercase tracking-[0.18em] px-3 py-1 rounded-full"
                style={{
                  color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)',
                  background: 'rgba(26, 24, 20, 0.04)',
                }}
              >
                {t(`language.${resource.language}`)}
              </span>
            )}
          </div>
        ) : null}

        <hr className="my-10" style={{ borderColor: 'rgba(26, 24, 20, 0.08)' }} />

        {/* Description */}
        <p
          className="text-sm leading-relaxed mb-14 whitespace-pre-line"
          style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
        >
          {resource.description}
        </p>

        {/* ===== Technical highlights ===== */}
        <section className="mb-16">
          <p
            className="text-[10px] uppercase tracking-[0.3em] mb-6"
            style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
          >
            {t('detail.technicalHighlights')}
          </p>
          <ul className="space-y-5">
            {highlights.map((point, i) => (
              <li key={i} className="flex items-start gap-5">
                <span
                  className="text-[10px] tracking-[0.2em] mt-1 shrink-0"
                  style={{
                    color: 'var(--color-accent)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className="text-base leading-relaxed"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontStyle: 'italic',
                    fontWeight: 300,
                    color: 'var(--color-fg)',
                  }}
                >
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* ===== Spec (render / timing / lighting) — blend assets only ===== */}
        {isBlendAsset(resource.tagGroups) && (
          <SpecSection tg={resource.tagGroups} t={t} />
        )}

        {/* ===== Renders — one image per scene camera ===== */}
        <CameraRenders resourceId={resource.id} fallback={resource.imageUrl} t={t} />

        {/* ===== Screenshots & results (custom uploads, if any) ===== */}
        {resource.screenshots?.some(Boolean) && (
          <section className="mb-16">
            <div className="flex items-baseline justify-between mb-6">
              <p
                className="text-[10px] uppercase tracking-[0.3em]"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
              >
                {t('detail.screenshots')}
              </p>
              <p
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-fg-faint)', fontFamily: 'var(--font-mono)' }}
              >
                {t('detail.frames')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {resource.screenshots!.filter(Boolean).map((src, i) => (
                <div
                  key={i}
                  className="relative overflow-hidden rounded-2xl"
                  style={{
                    aspectRatio: '4 / 3',
                    background: 'var(--color-deep)',
                    border: '1px solid rgba(26, 24, 20, 0.06)',
                    boxShadow:
                      '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(26, 24, 20, 0.10)',
                  }}
                >
                  <img
                    src={src}
                    alt={`${resource.title} screenshot ${i + 1}`}
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ===== Blend asset panel (downloadable assets — after the
             user has seen the tech and the visuals) ===== */}
        {isBlendAsset(resource.tagGroups) && (
          <BlendAssetPanel
            tg={resource.tagGroups}
            t={t}
            panLink={resource.fileUrl && resource.fileUrl !== '#'
              ? { url: resource.fileUrl, code: resource.panCode }
              : undefined}
          />
        )}

        {/* ===== Multi-dimensional tags ===== */}
        {!isBlendAsset(resource.tagGroups) && resource.tagGroups &&
          (resource.tagGroups.software?.length ||
            resource.tagGroups.element?.length ||
            resource.tagGroups.technique?.length) && (
            <section className="mb-12">
              <p
                className="text-[10px] uppercase tracking-[0.3em] mb-5"
                style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
              >
                {t('detail.categorized')}
              </p>
              <div className="space-y-4">
                {([
                  ['software', t('detail.tagSoftware')],
                  ['element', t('detail.tagElement')],
                  ['technique', t('detail.tagTechnique')],
                ] as const).map(([key, label]) => {
                  const tg = resource.tagGroups as
                    | { software?: string[]; element?: string[]; technique?: string[] }
                    | null
                    | undefined;
                  const list = tg?.[key];
                  if (!list || list.length === 0) return null;
                  return (
                    <div key={key}>
                      <p
                        className="text-[9px] uppercase tracking-[0.25em] mb-2"
                        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                      >
                        {label}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {list.map((tagName: string, idx: number) => (
                          <span
                            key={idx}
                            className="text-xs px-3 py-1.5 rounded-full"
                            style={{
                              background: 'rgba(168, 128, 107, 0.08)',
                              color: 'var(--color-accent)',
                            }}
                          >
                            {tagName}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

        {/* ===== Tags (free-form) ===== */}
        {parsedTags.length > 0 && (
          <section className="mb-12">
            <p
              className="text-[10px] uppercase tracking-[0.25em] mb-4"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {t('detail.tags')}
            </p>
            <div className="flex flex-wrap gap-2">
              {parsedTags.map((t, i) => (
                <span
                  key={i}
                  className="text-xs px-3 py-1.5 rounded-full"
                  style={{
                    background: 'rgba(168, 128, 107, 0.08)',
                    color: 'var(--color-accent)',
                  }}
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ===== Download CTA (bottom) — only for non-blend resources ===== */}
        {!isBlendAsset(resource.tagGroups) && resource.fileUrl && (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center justify-center gap-2 w-full py-4 text-[11px] uppercase tracking-[0.25em] rounded-full transition-colors"
              style={{
                background: 'var(--color-fg)',
                color: 'var(--color-elevated)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-fg)')}
            >
              <Download className="w-3.5 h-3.5" />
              {t('detail.getAsset')}
            </button>
            {resource.panCode && <PanCodePill code={resource.panCode} />}
          </div>
        )}
      </div>
    </article>
  );
}
