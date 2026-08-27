import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Box,
  CheckCircle2,
  Download,
  Layers,
  Loader2,
  Package,
  PackageOpen,
  PencilRuler,
  Upload,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useToolRun } from '../hooks/useToolRun';

// Three groups of supported source formats. Each group's `exts` are the
// accepted file extensions; the page uses these both to render the format
// gallery and to validate the user's drop.
const FORMAT_GROUPS: {
  id: 'mesh' | 'cad' | '2d';
  icon: any;
  nameKey: string;
  exts: { ext: string; nameKey: string }[];
}[] = [
  {
    id: 'mesh',
    icon: Layers,
    nameKey: 'bridge.groupMesh',
    exts: [
      { ext: '3ds', nameKey: 'bridge.fmt3ds' },
      { ext: '3mf', nameKey: 'bridge.fmt3mf' },
      { ext: 'dae', nameKey: 'bridge.fmtdae' },
      { ext: 'ply', nameKey: 'bridge.fmtply' },
      { ext: 'stl', nameKey: 'bridge.fmtstl' },
      { ext: 'off', nameKey: 'bridge.fmtoff' },
    ],
  },
  {
    id: 'cad',
    icon: Package,
    nameKey: 'bridge.groupCad',
    exts: [
      { ext: 'step', nameKey: 'bridge.fmtstep' },
      { ext: 'stp', nameKey: 'bridge.fmtstp' },
      { ext: 'iges', nameKey: 'bridge.fmtiges' },
      { ext: 'igs', nameKey: 'bridge.fmtigs' },
      { ext: 'sat', nameKey: 'bridge.fmtsat' },
      { ext: 'sab', nameKey: 'bridge.fmtsab' },
      { ext: 'brep', nameKey: 'bridge.fmtbrep' },
    ],
  },
  {
    id: '2d',
    icon: PencilRuler,
    nameKey: 'bridge.group2d',
    exts: [
      { ext: 'dxf', nameKey: 'bridge.fmtdxf' },
    ],
  },
];

const ALL_EXTS = FORMAT_GROUPS.flatMap((g) => g.exts.map((e) => e.ext));
const ACCEPT_ATTR = ALL_EXTS.map((e) => '.' + e).join(',');

export default function ToolHipFormatBridge() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t, locale } = useI18n();

  const [detectedExt, setDetectedExt] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const tool = useToolRun({
    endpoint: '/api/tools/hip-format-bridge/run',
    headers: {
      summary: 'X-Format-Bridge-Summary',
      result: 'X-Format-Bridge-Result',
      credits: 'X-Format-Bridge-Credits',
    },
    buildFormData: (file, extras) => {
      const fd = new FormData();
      fd.append('file', file);
      if (extras) {
        for (const [k, v] of Object.entries(extras)) {
          if (v !== undefined && v !== '') fd.append(k, v);
        }
      }
      return fd;
    },
    defaultMessage: t('bridge.resultDone'),
  });

  useEffect(() => {
    tool.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.file]);

  const detectExt = (f: File | null): string | null => {
    if (!f) return null;
    const m = f.name.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!m || !m[1]) return null;
    const ext: string = m[1];
    return ALL_EXTS.includes(ext) ? ext : null;
  };

  const acceptFile = (f: File | null) => {
    if (!f) return;
    const ext = detectExt(f);
    if (!ext) {
      tool.setError(t('bridge.errorOnly3d'));
      return;
    }
    if (f.size > 200 * 1024 * 1024) {
      tool.setError(t('bridge.errorTooLarge'));
      return;
    }
    tool.setError(null);
    tool.setFile(f);
    setDetectedExt(ext);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  const run = async () => {
    if (!tool.file || !detectedExt) {
      tool.setError(t('bridge.errorDropFirst'));
      return;
    }
    await tool.run({ source_ext: detectedExt });
  };

  const downloadResult = tool.downloadResult;

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <div
          className="rounded-3xl p-12"
          style={{
            background: 'rgba(251, 250, 246, 0.7)',
            border: '1px solid rgba(26, 24, 20, 0.06)',
            boxShadow: '0 1px 0 rgba(26, 24, 20, 0.03), 0 20px 50px -25px rgba(26, 24, 20, 0.12)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <PackageOpen className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--color-accent)' }} />
          <h1
            className="text-2xl mb-3"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--color-fg)' }}
          >
            {t('bridge.title')}
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}>
            {t('bridge.signInPrompt')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/login"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
            >
              {t('bridge.signInCta')}
            </Link>
            <Link
              to="/register"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{
                border: '1px solid rgba(26, 24, 20, 0.12)',
                color: 'var(--color-fg-soft)',
              }}
            >
              {t('bridge.registerCta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 mt-2">
      {/* ===== 1. Title + description ===== */}
      <section>
        <button
          onClick={() => navigate('/')}
          className="text-[11px] uppercase tracking-[0.2em] mb-6 inline-flex items-center gap-1.5 transition-colors"
          style={{ color: 'var(--color-fg-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
        >
          <ArrowLeft className="w-3 h-3" />
          {t('bridge.backToResources')}
        </button>
        <div className="flex items-center gap-3 mb-3">
          <span
            className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] px-3 py-1 rounded-full"
            style={{
              background: 'rgba(168, 128, 107, 0.12)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--color-accent)' }}
            />
            {t('bridge.liveService')}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.25em]"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {t('bridge.houdiniVersion')}
          </span>
        </div>
        <h1
          className="text-2xl md:text-3xl leading-tight mb-3"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--color-fg)' }}
        >
          {locale === 'zh' ? (
            <>
              HIP <span style={{ color: 'var(--color-accent)' }}>格式桥接器</span>
            </>
          ) : (
            <>
              HIP Format{' '}
              <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>Bridge</span>
            </>
          )}
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed"
          style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
        >
          {t('bridge.lede')}
        </p>
        <div
          aria-hidden
          className="mt-6 h-px w-16"
          style={{ background: 'var(--color-accent)' }}
        />
      </section>

      {/* ===== 2. Supported formats gallery ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('bridge.sectionFormats')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FORMAT_GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <div
                key={g.id}
                className="rounded-2xl p-5"
                style={{
                  background: 'rgba(251, 250, 246, 0.6)',
                  border: '1px solid rgba(26, 24, 20, 0.06)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                  <h3
                    className="text-[10px] uppercase tracking-[0.2em]"
                    style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    {t(g.nameKey)}
                  </h3>
                </div>
                <div className="flex flex-col gap-1.5">
                  {g.exts.map((e) => {
                    const active = detectedExt === e.ext;
                    return (
                      <div
                        key={e.ext}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
                        style={{
                          background: active
                            ? 'rgba(168, 128, 107, 0.12)'
                            : 'rgba(247, 244, 236, 0.4)',
                          border: active
                            ? '1px solid rgba(168, 128, 107, 0.30)'
                            : '1px solid transparent',
                        }}
                      >
                        <span
                          className="text-[10px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
                          style={{
                            background: 'var(--color-fg)',
                            color: 'var(--color-elevated)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          .{e.ext}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-fg-soft)' }}>
                          {t(e.nameKey)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ===== 3. Upload + Run ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('bridge.sectionUpload')}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Drop zone */}
          <div className="lg:col-span-3">
            <div
              className="rounded-3xl p-6"
              style={{
                background: 'rgba(251, 250, 246, 0.6)',
                border: '1px solid rgba(26, 24, 20, 0.06)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <h3
                className="text-[10px] uppercase tracking-[0.25em] mb-4"
                style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {t('bridge.uploadTitle')}
              </h3>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className="block rounded-2xl p-8 text-center cursor-pointer transition-colors"
                style={{
                  background: dragging
                    ? 'rgba(168, 128, 107, 0.10)'
                    : tool.file
                      ? 'rgba(168, 128, 107, 0.06)'
                      : 'rgba(247, 244, 236, 0.5)',
                  border: dragging
                    ? '2px dashed var(--color-accent)'
                    : '2px dashed rgba(26, 24, 20, 0.10)',
                }}
              >
                <input
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
                />
                {tool.file ? (
                  <div className="flex items-center justify-center gap-3">
                    <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                    <div className="text-left">
                      <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{tool.file.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                        {(tool.file.size / 1024 / 1024).toFixed(2)} MB
                        {detectedExt && (
                          <span style={{ color: 'var(--color-accent)' }}>
                            {' '}· .{(detectedExt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-7 h-7 mx-auto mb-3" style={{ color: 'var(--color-fg-faint)' }} />
                    <p className="text-sm" style={{ color: 'var(--color-fg-soft)' }}>
                      {t('bridge.dropPrompt')}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-fg-faint)' }}>
                      {t('bridge.dropHint')}
                    </p>
                  </>
                )}
              </label>
            </div>
          </div>

          {/* Run + Result */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div
              className="rounded-3xl p-6"
              style={{
                background: 'rgba(251, 250, 246, 0.6)',
                border: '1px solid rgba(26, 24, 20, 0.06)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div
                className="flex items-center justify-between mb-3 text-[10px] uppercase tracking-[0.2em]"
                style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
              >
                <span>
                  {tool.isSubscribed
                    ? '∞ unlimited'
                    : `${tool.credits ?? '–'} / 3 free this month`}
                </span>
                <Link to="/pricing" style={{ color: 'var(--color-accent)' }}>
                  Get more →
                </Link>
              </div>
              <button
                onClick={run}
                disabled={!tool.file || tool.running || (!tool.isSubscribed && (tool.credits ?? 0) <= 0)}
                className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm uppercase tracking-[0.2em] transition-colors"
                style={{
                  background: !tool.file || tool.running
                    ? 'var(--color-fg-faint)'
                    : 'var(--color-fg)',
                  color: 'var(--color-elevated)',
                  cursor: !tool.file || tool.running ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!(!tool.file || tool.running)) e.currentTarget.style.background = 'var(--color-accent)';
                }}
                onMouseLeave={(e) => {
                  if (!(!tool.file || tool.running)) e.currentTarget.style.background = 'var(--color-fg)';
                }}
              >
                {tool.running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('bridge.processingCta')}
                  </>
                ) : !tool.file ? (
                  <>{t('bridge.runCta')}</>
                ) : !tool.isSubscribed && (tool.credits ?? 0) <= 0 ? (
                  <>Buy credits to run</>
                ) : (
                  <>
                    {t('bridge.runCta')}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              {tool.error && (
                <p
                  className="text-xs mt-3 px-3 py-2 rounded-lg"
                  style={{
                    background: 'rgba(180, 60, 60, 0.08)',
                    color: 'rgba(180, 60, 60, 0.95)',
                  }}
                >
                  {tool.error}
                </p>
              )}
            </div>

            {tool.result && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-3xl p-6"
                style={{
                  background: 'rgba(168, 128, 107, 0.08)',
                  border: '1px solid rgba(168, 128, 107, 0.20)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
                  <h3
                    className="text-[10px] uppercase tracking-[0.25em]"
                    style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
                  >
                    {t('bridge.resultDone')}
                  </h3>
                </div>
                <p
                  className="text-[11px] mb-3"
                  style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
                >
                  {t('bridge.resultSavedAs', { filename: tool.result.filename })}
                </p>
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  {t('bridge.resultAuditHint', {
                    mdPath: (tool.result.summary as any)?.audit_md
                      ? String((tool.result.summary as any).audit_md ?? '').split(/[\\/]/).pop() ?? ''
                      : '',
                  })}
                </p>
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap"
                  style={{
                    color: 'var(--color-fg-soft)',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: 240,
                    overflow: 'auto',
                  }}
                >
                  {tool.result.resultText}
                </pre>
                <button
                  onClick={downloadResult}
                  className="mt-3 text-[10px] uppercase tracking-[0.2em] transition-colors inline-flex items-center gap-1.5"
                  style={{ color: 'var(--color-fg-muted)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
                >
                  <Download className="w-3 h-3" />
                  {t('tool.resultRedownload')}
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// Legacy buildResultText helper removed — the server now always emits
// a clean RESULT block via the X-Format-Bridge-Result header, so the
// client never needs to fabricate a fallback string.
