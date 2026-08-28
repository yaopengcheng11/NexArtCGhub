import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSearch,
  Loader2,
  Repeat2,
  Replace,
  Stethoscope,
  Upload,
  Workflow,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useToolRun } from '../hooks/useToolRun';

type Feature = 0 | 1 | 2 | 3;
type Direction = 0 | 1;       // 0 = to absolute, 1 = to relative
type Base = 0 | 1 | 2;         // 0 = $HIP, 1 = $JOB, 2 = Custom

const FEATURE_META: {
  id: Feature;
  nameKey: string;
  descKey: string;
  stepKey: string;
  icon: any;
}[] = [
  { id: 0, nameKey: 'tool.featureSwitchSlash', descKey: 'tool.featureSwitchSlashDesc', stepKey: 'tool.stepSwitchSlash', icon: Repeat2 },
  { id: 1, nameKey: 'tool.featureReplace',      descKey: 'tool.featureReplaceDesc',      stepKey: 'tool.stepReplace',      icon: Replace },
  { id: 2, nameKey: 'tool.featureFindMissing',  descKey: 'tool.featureFindMissingDesc',  stepKey: 'tool.stepFindMissing',  icon: FileSearch },
  { id: 3, nameKey: 'tool.featureAbsRel',       descKey: 'tool.featureAbsRelDesc',       stepKey: 'tool.stepAbsRel',       icon: Workflow },
];

export default function ToolHipPathDoctor() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t, locale } = useI18n();

  const [feature, setFeature] = useState<Feature>(0);
  const [oldPath, setOldPath] = useState('');
  const [newPath, setNewPath] = useState('');
  const [direction, setDirection] = useState<Direction>(0);
  const [base, setBase] = useState<Base>(0);
  const [customBase, setCustomBase] = useState('');
  const [dragging, setDragging] = useState(false);

  // Shared credit + run lifecycle (see hooks/useToolRun.ts). This replaces
  // ~80 lines of state + fetch + header parsing + blob download that used
  // to be hand-rolled in this file and ToolHipFormatBridge.tsx and
  // ToolGsplatsTrainer.tsx.
  const tool = useToolRun({
    endpoint: '/api/tools/hip-path-doctor/run',
    headers: {
      summary: 'X-Path-Doctor-Summary',
      result: 'X-Path-Doctor-Result',
      credits: 'X-Path-Doctor-Credits',
    },
    defaultMessage: t('tool.resultDone'),
  });

  useEffect(() => {
    tool.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, tool.file]);

  const acceptHip = (f: File | null) => {
    if (!f) return;
    const name = f.name.toLowerCase();
    if (!name.endsWith('.hip') && !name.endsWith('.hipnc')) {
      tool.setError(t('tool.errorOnlyHip'));
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      tool.setError(t('tool.errorTooLarge'));
      return;
    }
    tool.setError(null);
    tool.setFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptHip(f);
  };

  const run = async () => {
    if (!tool.file) {
      tool.setError(t('tool.errorDropFirst'));
      return;
    }
    if (feature === 1 && !oldPath) {
      tool.setError(t('tool.errorNeedOld'));
      return;
    }
    if (feature === 3 && base === 2 && !customBase) {
      tool.setError(t('tool.errorNeedCustomBase'));
      return;
    }
    const extras: Record<string, string> = { feature: String(feature) };
    if (feature === 1) {
      extras.old = oldPath;
      extras.new = newPath;
    } else if (feature === 3) {
      extras.direction = String(direction);
      extras.base = String(base);
      if (base === 2) extras.customBase = customBase;
    }
    await tool.run(extras);
  };

  // Redownload handler lives on the hook (triggerDownload) so the blob
  // URL is tracked + revoked in one place.
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
          <Stethoscope className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--color-accent)' }} />
          <h1
            className="text-2xl mb-3"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 400, color: 'var(--color-fg)' }}
          >
            {t('tool.title')}
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-fg-muted)' }}>
            {t('tool.signInPrompt')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/login"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
            >
              {t('tool.signInCta')}
            </Link>
            <Link
              to="/register"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{
                border: '1px solid rgba(26, 24, 20, 0.12)',
                color: 'var(--color-fg-soft)',
              }}
            >
              {t('tool.registerCta')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ===== Authed layout (reordered) =====
  // 1. Card name (title)
  // 2. Card feature description
  // 3. After user selects a feature, the steps for that feature
  // 4. Upload + Run (at the very bottom)
  // Result panel appears below the Run button when available.
  return (
    <div className="flex flex-col gap-8 mt-2">
      {/* ===== 1. Card name + description ===== */}
      <section>
        <button
          onClick={() => navigate('/')}
          className="text-[11px] uppercase tracking-[0.2em] mb-6 inline-flex items-center gap-1.5 transition-colors"
          style={{ color: 'var(--color-fg-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-fg)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-fg-muted)')}
        >
          <ArrowLeft className="w-3 h-3" />
          {t('tool.backToResources')}
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
            {t('tool.liveService')}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.25em]"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {t('tool.houdiniVersion')}
          </span>
        </div>
        <h1
          className="text-2xl md:text-3xl leading-tight mb-3"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--color-fg)' }}
        >
          {locale === 'zh' ? (
            <>
              HIP <span style={{ color: 'var(--color-accent)' }}>文件路径在线助手</span>
            </>
          ) : (
            <>
              HIP Path{' '}
              <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>Doctor</span>
            </>
          )}
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed"
          style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
        >
          {t('tool.lede')}
        </p>
        <div
          aria-hidden
          className="mt-6 h-px w-16"
          style={{ background: 'var(--color-accent)' }}
        />
      </section>

      {/* ===== 2. Pick a feature (4 cards) ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('tool.sectionFeatures')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURE_META.map((f) => {
            const Icon = f.icon;
            const active = feature === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setFeature(f.id)}
                className="text-left rounded-2xl p-5 transition-all"
                style={{
                  background: active
                    ? 'rgba(168, 128, 107, 0.10)'
                    : 'rgba(251, 250, 246, 0.6)',
                  border: active
                    ? '1px solid rgba(168, 128, 107, 0.30)'
                    : '1px solid rgba(26, 24, 20, 0.06)',
                  backdropFilter: 'blur(8px)',
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <Icon
                    className="w-4 h-4"
                    style={{ color: active ? 'var(--color-accent)' : 'var(--color-fg-muted)' }}
                  />
                  <span
                    className="text-[10px] tracking-[0.2em] uppercase"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: active ? 'var(--color-accent)' : 'var(--color-fg-faint)',
                    }}
                  >
                    {String(f.id + 1).padStart(2, '0')}
                  </span>
                </div>
                <h3
                  className="text-sm mb-1.5"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 400,
                    color: 'var(--color-fg)',
                  }}
                >
                  {t(f.nameKey)}
                </h3>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--color-fg-muted)' }}>
                  {t(f.descKey)}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== 3. Steps for the selected feature ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('tool.sectionSteps')}
        </h2>
        <div
          className="rounded-3xl p-6"
          style={{
            background: 'rgba(251, 250, 246, 0.6)',
            border: '1px solid rgba(26, 24, 20, 0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <p
            className="text-sm leading-relaxed mb-5"
            style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
          >
            {renderStep(t(FEATURE_META[feature]?.stepKey ?? ''))}
          </p>

          {feature === 1 && (
            <div className="flex flex-col gap-4">
              <ParmRow label={t('tool.labelOld')}>
                <input
                  type="text"
                  value={oldPath}
                  onChange={(e) => setOldPath(e.target.value)}
                  placeholder={t('tool.placeholderOld')}
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    color: 'var(--color-fg)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </ParmRow>
              <ParmRow label={t('tool.labelNew')}>
                <input
                  type="text"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder={t('tool.placeholderNew')}
                  className="w-full px-4 py-2.5 rounded-xl text-sm"
                  style={{
                    background: 'var(--color-input)',
                    border: '1px solid rgba(26, 24, 20, 0.08)',
                    color: 'var(--color-fg)',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </ParmRow>
            </div>
          )}

          {feature === 3 && (
            <div className="flex flex-col gap-4">
              <ParmRow label={t('tool.labelDirection')}>
                <Segmented
                  value={direction}
                  options={[
                    { value: 0, label: t('tool.dirToAbs') },
                    { value: 1, label: t('tool.dirToRel') },
                  ]}
                  onChange={(v) => setDirection(v as Direction)}
                />
              </ParmRow>
              <ParmRow label={t('tool.labelBase')}>
                <Segmented
                  value={base}
                  options={[
                    { value: 0, label: t('tool.baseHip') },
                    { value: 1, label: t('tool.baseJob') },
                    { value: 2, label: t('tool.baseCustom') },
                  ]}
                  onChange={(v) => setBase(v as Base)}
                />
              </ParmRow>
              {base === 2 && (
                <ParmRow label={t('tool.labelCustomBase')}>
                  <input
                    type="text"
                    value={customBase}
                    onChange={(e) => setCustomBase(e.target.value)}
                    placeholder={t('tool.placeholderCustomBase')}
                    className="w-full px-4 py-2.5 rounded-xl text-sm"
                    style={{
                      background: 'var(--color-input)',
                      border: '1px solid rgba(26, 24, 20, 0.08)',
                      color: 'var(--color-fg)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </ParmRow>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ===== 4. Upload + Run (bottom) ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('tool.sectionUpload')}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Upload */}
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
                {t('tool.uploadTitle')}
              </h3>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
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
                  accept=".hip,.hipnc"
                  className="hidden"
                  onChange={(e) => acceptHip(e.target.files?.[0] ?? null)}
                />
                {tool.file ? (
                  <div className="flex items-center justify-center gap-3">
                    <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--color-accent)' }} />
                    <div className="text-left">
                      <p className="text-sm" style={{ color: 'var(--color-fg)' }}>{tool.file.name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--color-fg-muted)' }}>
                        {(tool.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <Upload className="w-7 h-7 mx-auto mb-3" style={{ color: 'var(--color-fg-faint)' }} />
                    <p className="text-sm" style={{ color: 'var(--color-fg-soft)' }}>
                      {t('tool.dropPrompt')}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-fg-faint)' }}>
                      {t('tool.dropHint')}
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
                    : `${tool.credits ?? '–'} / ${3} free this month`}
                </span>
                <Link
                  to="/pricing"
                  style={{ color: 'var(--color-accent)' }}
                >
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
                    {t('tool.processingCta')}
                  </>
                ) : !tool.file ? (
                  <>{t('tool.runCta')}</>
                ) : !tool.isSubscribed && (tool.credits ?? 0) <= 0 ? (
                  <>Buy credits to run</>
                ) : (
                  <>
                    {t('tool.runCta')}
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
                    {t('tool.resultDone')}
                  </h3>
                </div>
                <p
                  className="text-[11px] mb-3"
                  style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
                >
                  {t('tool.resultSavedAs', { filename: tool.result.filename })}
                </p>
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  {t('tool.resultAuditHint', {
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

// Render a step line with backslash / slash tokens highlighted as inline code.
function renderStep(text: string) {
  // tokens like {bs} and {fs} are already in source — we replace them inline
  // with monospaced <code> spans.
  const parts = text.split(/(\{bs\}|\{fs\})/g);
  return parts.map((p, i) => {
    if (p === '{bs}') {
      return (
        <code key={i} style={{ fontFamily: 'var(--font-mono)' }}>\</code>
      );
    }
    if (p === '{fs}') {
      return (
        <code key={i} style={{ fontFamily: 'var(--font-mono)' }}>/</code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function ParmRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-[0.2em] mb-2"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented<V extends number>({
  value,
  options,
  onChange,
}: {
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full p-1 gap-1"
      style={{ background: 'var(--color-input)', border: '1px solid rgba(26, 24, 20, 0.06)' }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className="px-4 py-1.5 rounded-full text-[11px] uppercase tracking-[0.15em] transition-colors"
            style={{
              background: active ? 'var(--color-fg)' : 'transparent',
              color: active ? 'var(--color-elevated)' : 'var(--color-fg-soft)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// buildResultText removed — the server always emits a clean RESULT
// block via the X-Path-Doctor-Result header (see useToolRun), so the
// client never needs a fabricated fallback string. (Mirrors the same
// cleanup done in ToolHipFormatBridge earlier.)
