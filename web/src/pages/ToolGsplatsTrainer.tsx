import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircuitBoard,
  Download,
  Image as ImageIcon,
  Loader2,
  Settings2,
  Sparkles,
  Upload,
  Workflow,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { useToolRun } from '../hooks/useToolRun';

type Downscale = 1 | 2 | 4;

interface RunResult {
  blob: Blob;
  filename: string;
  summary: {
    ok: boolean;
    project: string;
    output_dir: string;
    hip_path: string;
    dataset_dir: string;
    images_count: number;
    node_paths: { top: string; geo: string };
    cooked_top: string | null;
    dry_run: boolean;
    audit_md: string | null;
  };
  resultText: string;
}

export default function ToolGsplatsTrainer() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { t, locale } = useI18n();

  const [projectName, setProjectName] = useState('');
  const [downscale, setDownscale] = useState<Downscale>(1);
  const [maxBatchSize, setMaxBatchSize] = useState(6);
  const [bboxHalfSize, setBboxHalfSize] = useState(5.0);
  const [dryRun, setDryRun] = useState(true); // default to safe dry-run
  const [dragging, setDragging] = useState(false);

  const tool = useToolRun({
    endpoint: '/api/tools/gsplats-trainer/run',
    headers: {
      summary: 'X-Gsplats-Trainer-Summary',
      result: 'X-Gsplats-Trainer-Result',
      credits: 'X-Gsplats-Trainer-Credits',
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
    defaultMessage: t('gsplats.resultDone'),
  });

  useEffect(() => {
    tool.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, downscale, maxBatchSize, bboxHalfSize, dryRun, tool.file]);

  const acceptZip = (f: File | null) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.zip')) {
      tool.setError(t('gsplats.errorOnlyZip'));
      return;
    }
    if (f.size > 500 * 1024 * 1024) {
      tool.setError(t('gsplats.errorTooLarge'));
      return;
    }
    tool.setError(null);
    tool.setFile(f);
    // Suggest a project_name derived from the zip stem, if the user hasn't
    // typed one yet.
    if (!projectName) {
      const stem = f.name.replace(/\.zip$/i, '').replace(/[^A-Za-z0-9_]/g, '_');
      setProjectName(stem.slice(0, 32) || 'project');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptZip(f);
  };

  const run = async () => {
    if (!tool.file) {
      tool.setError(t('gsplats.errorDropFirst'));
      return;
    }
    if (!projectName || !/^[A-Za-z0-9_]+$/.test(projectName)) {
      tool.setError(t('gsplats.errorNeedProjectName'));
      return;
    }
    await tool.run({
      project_name: projectName,
      downscale: String(downscale),
      max_batch_size: String(maxBatchSize),
      bbox_half_size: String(bboxHalfSize),
      dry_run: dryRun ? '1' : '0',
    });
  };

  const downloadResult = () => {
    if (!tool.result) return;
    const url = URL.createObjectURL(tool.result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = tool.result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

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
          <Sparkles className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--color-accent)' }} />
          <h1
            className="text-2xl mb-3"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 500, color: 'var(--color-fg)' }}
          >
            {t('gsplats.title')}
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-fg-muted)', fontWeight: 300 }}>
            {t('gsplats.signInPrompt')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/login"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{ background: 'var(--color-fg)', color: 'var(--color-elevated)' }}
            >
              {t('gsplats.signInCta')}
            </Link>
            <Link
              to="/register"
              className="text-[11px] uppercase tracking-[0.2em] px-5 py-2.5 rounded-full transition-colors"
              style={{ border: '1px solid rgba(26, 24, 20, 0.12)', color: 'var(--color-fg-soft)' }}
            >
              {t('gsplats.registerCta')}
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
          {t('gsplats.backToResources')}
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
            {t('gsplats.liveService')}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.25em]"
            style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {t('gsplats.houdiniVersion')}
          </span>
        </div>
        <h1
          className="text-2xl md:text-3xl leading-tight mb-3"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--color-fg)' }}
        >
          {locale === 'zh' ? (
            <>
              3DGS <span style={{ color: 'var(--color-accent)' }}>自动训练器</span>
            </>
          ) : (
            <>
              3DGS Auto{' '}
              <span style={{ fontStyle: 'italic', color: 'var(--color-accent)' }}>Trainer</span>
            </>
          )}
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed"
          style={{ color: 'var(--color-fg-soft)', fontWeight: 300 }}
        >
          {t('gsplats.lede')}
        </p>
        <div
          aria-hidden
          className="mt-6 h-px w-16"
          style={{ background: 'var(--color-accent)' }}
        />
      </section>

      {/* ===== 2. Pipeline explainer ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('gsplats.sectionPipeline')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PipelineStep icon={CircuitBoard} text={t('gsplats.pipelineColmap')} />
          <PipelineStep icon={Workflow}    text={t('gsplats.pipelineTop')} />
          <PipelineStep icon={Boxes}       text={t('gsplats.pipelineSop')} />
        </div>
      </section>

      {/* ===== 3. Config panel ===== */}
      <section>
        <h2
          className="text-[10px] uppercase tracking-[0.3em] mb-4"
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}
        >
          / {t('gsplats.sectionUpload')}
        </h2>
        <div className="rounded-3xl p-6 mb-6"
          style={{
            background: 'rgba(251, 250, 246, 0.6)',
            border: '1px solid rgba(26, 24, 20, 0.06)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Settings2 className="w-3.5 h-3.5" style={{ color: 'var(--color-accent)' }} />
            <h3
              className="text-[10px] uppercase tracking-[0.25em]"
              style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
            >
              knobs
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <ParmRow label={t('gsplats.labelProjectName')} help={t('gsplats.helpProjectName')}>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={t('gsplats.placeholderProjectName')}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{
                  background: 'var(--color-input)',
                  border: '1px solid rgba(26, 24, 20, 0.08)',
                  color: 'var(--color-fg)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </ParmRow>
            <ParmRow label={t('gsplats.labelDownscale')}>
              <Segmented
                value={downscale}
                options={[
                  { value: 1, label: t('gsplats.downscaleFull') },
                  { value: 2, label: t('gsplats.downscaleHalf') },
                  { value: 4, label: t('gsplats.downscaleQuarter') },
                ]}
                onChange={(v) => setDownscale(v as Downscale)}
              />
            </ParmRow>
            <ParmRow label={t('gsplats.labelMaxBatch')} help={t('gsplats.helpMaxBatch')}>
              <input
                type="number"
                min={1}
                max={32}
                value={maxBatchSize}
                onChange={(e) => setMaxBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{
                  background: 'var(--color-input)',
                  border: '1px solid rgba(26, 24, 20, 0.08)',
                  color: 'var(--color-fg)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </ParmRow>
            <ParmRow label={t('gsplats.labelBbox')} help={t('gsplats.helpBbox')}>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={bboxHalfSize}
                onChange={(e) => setBboxHalfSize(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                className="w-full px-4 py-2.5 rounded-xl text-sm"
                style={{
                  background: 'var(--color-input)',
                  border: '1px solid rgba(26, 24, 20, 0.08)',
                  color: 'var(--color-fg)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </ParmRow>
            <ParmRow label={t('gsplats.labelDryRun')} help={t('gsplats.helpDryRun')} colSpan={2}>
              <button
                type="button"
                onClick={() => setDryRun(!dryRun)}
                className="inline-flex items-center gap-3 transition-colors"
              >
                <span
                  className="inline-flex items-center h-5 w-9 rounded-full transition-colors"
                  style={{
                    background: dryRun ? 'var(--color-accent)' : 'rgba(26, 24, 20, 0.10)',
                  }}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full transition-transform"
                    style={{
                      background: 'var(--color-elevated)',
                      transform: dryRun ? 'translateX(18px)' : 'translateX(2px)',
                    }}
                  />
                </span>
                <span
                  className="text-[11px] uppercase tracking-[0.15em]"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: dryRun ? 'var(--color-accent)' : 'var(--color-fg-muted)',
                  }}
                >
                  {dryRun ? 'ON' : 'OFF'}
                </span>
              </button>
            </ParmRow>
          </div>
        </div>

        {/* ===== 4. Upload + Run ===== */}
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
                {t('gsplats.uploadTitle')}
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
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => acceptZip(e.target.files?.[0] ?? null)}
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
                      {t('gsplats.dropPrompt')}
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--color-fg-faint)' }}>
                      {t('gsplats.dropHint')}
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
                  {tool.isSubscribed ? '∞ unlimited' : `${tool.credits ?? '–'} / 3 free this month`}
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
                    {t('gsplats.processingCta')}
                  </>
                ) : !tool.file ? (
                  <>{t('gsplats.runCta')}</>
                ) : !tool.isSubscribed && (tool.credits ?? 0) <= 0 ? (
                  <>Buy credits to run</>
                ) : (
                  <>
                    {t('gsplats.runCta')}
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
                    {t('gsplats.resultDone')}
                  </h3>
                </div>
                <p
                  className="text-[11px] mb-3"
                  style={{ color: 'var(--color-fg-soft)', fontFamily: 'var(--font-mono)' }}
                >
                  {t('gsplats.resultSavedAs', { filename: tool.result.filename })}
                </p>
                <p
                  className="text-[10px] mb-3"
                  style={{ color: 'var(--color-fg-muted)' }}
                >
                  {t('gsplats.resultAuditHint', {
                    mdPath: (tool.result.summary as any)?.audit_md
                      ? String((tool.result.summary as any).audit_md ?? '').split(/[\\/]/).pop() ?? ''
                      : '',
                  })}
                </p>
                {(tool.result.summary as any)?.dry_run && (
                  <p
                    className="text-[10px] mb-3 px-3 py-2 rounded-lg"
                    style={{
                      background: 'rgba(176, 196, 212, 0.15)',
                      color: 'var(--color-fg-soft)',
                    }}
                  >
                    ℹ {t('gsplats.resultDryRunNote')}
                  </p>
                )}
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap"
                  style={{
                    color: 'var(--color-fg-soft)',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: 200,
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
                  {t('gsplats.resultRedownload')}
                </button>
              </motion.div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// Local components
// ============================================================================

function PipelineStep({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'rgba(251, 250, 246, 0.6)',
        border: '1px solid rgba(26, 24, 20, 0.06)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" style={{ color: 'var(--color-accent)' }} />
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-fg-soft)' }}>
        {text}
      </p>
    </div>
  );
}

function ParmRow({
  label,
  help,
  colSpan,
  children,
}: {
  label: string;
  help?: string;
  colSpan?: number;
  children: React.ReactNode;
}) {
  return (
    <div style={colSpan === 2 ? { gridColumn: 'span 2 / span 2' } : undefined}>
      <p
        className="text-[10px] uppercase tracking-[0.2em] mb-1"
        style={{ color: 'var(--color-fg-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </p>
      {help && (
        <p className="text-[10px] mb-2" style={{ color: 'var(--color-fg-faint)' }}>
          {help}
        </p>
      )}
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

function buildResultText(summary: RunResult['summary']): string {
  return [
    `Project            : ${summary.project}`,
    `Output ($HIP)      : ${summary.output_dir || '(unknown)'}`,
    `Dataset            : ${summary.dataset_dir || '(unknown)'}`,
    `Houdini .hip       : ${summary.hip_path || '(unknown)'}`,
    `Images copied      : ${summary.images_count}`,
    `COLMAP             : ${summary.dry_run ? 'dry-run' : 'executed'}`,
    `TOP cook triggered : ${summary.cooked_top || 'no'}`,
    `Top node           : ${summary.node_paths.top || '?'}`,
    `Sop node           : ${summary.node_paths.geo || '?'}`,
  ].join('\n');
}
