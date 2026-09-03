import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/**
 * Shared credit balance + tool-run state machine for the three tool
 * pages (hip-path-doctor / hip-format-bridge / gsplats-trainer). Each
 * page used to maintain its own near-identical copies of this logic
 * (~80 lines of duplicated fetch + FormData + header parsing + zip
 * blob download). They now import this hook instead.
 */

export interface RunHeaders {
  /** Custom HTTP header name carrying the JSON summary. */
  summary: string;
  /** Custom HTTP header name carrying the human-readable result text. */
  result: string;
  /** Custom HTTP header name carrying the remaining-credit count. */
  credits: string;
}

export interface RunResult<S = unknown> {
  /** Parsed summary JSON from the response header. */
  summary: S | null;
  /** Plain-text result block from the response header. */
  resultText: string;
  /** Response body as Blob (the zip download). */
  blob: Blob;
  /** Server-suggested filename (from Content-Disposition). */
  filename: string;
  /** Remaining credits after the run, or null if subscribed. */
  creditsRemaining: number | null;
  /** Mirror of the run text — used to render in the UI. */
  message: string;
}

export interface UseToolRunOptions<E extends Record<string, string> = Record<string, string>> {
  endpoint: string;
  /** Custom header names (different per tool). */
  headers: RunHeaders;
  /**
   * Build the FormData. Optional — the default appends the file under
   * the key "file" plus every non-empty entry in `extras`. Override only
   * if a tool needs custom field names or extra blobs.
   */
  buildFormData?: (file: File, extras?: E) => FormData;
  /** Long-running tool uploads deserve a bigger timeout. */
  timeoutMs?: number;
  /** Fallback message shown if the server doesn't return one. */
  defaultMessage: string;
}

export function useToolRun<E extends Record<string, string> = Record<string, string>>(
  opts: UseToolRunOptions<E>
) {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Track the last created blob URL so we can revoke it — without this,
  // every run + every "redownload" click leaks one Blob (and its full
  // bytes) in memory until the tab closes. Two fixes:
  //   1. revoke the previous URL before creating a new one
  //   2. revoke on unmount (effect cleanup below)
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  // Shared download helper — triggers a browser download for the given
  // blob. Used both by the auto-download in run() and the manual
  // "redownload" button on the result panel (which used to be three
  // copies of the same code on the three tool pages).
  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Keep the URL alive for 5s so slow browsers can start the
    // download, then free it (if it's still the active URL).
    setTimeout(() => {
      if (urlRef.current === url) {
        URL.revokeObjectURL(url);
        urlRef.current = null;
      }
    }, 5000);
  }, []);

  // Pull the user's credit balance + subscription flag whenever the
  // auth context changes (login / refresh). The endpoint is public-ish
  // but actually requires auth; apiFetch sends the cookie.
  useEffect(() => {
    if (!user) {
      setCredits(null);
      setIsSubscribed(false);
      return;
    }
    let cancelled = false;
    apiFetch<{ credits: number | null; isSubscribed: boolean }>(
      '/api/credits/balance'
    ).then((r) => {
      if (cancelled || !r.ok) return;
      setCredits(r.data.credits ?? 0);
      setIsSubscribed(!!r.data.isSubscribed);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  // Client-side credit gate (mirrors the server's). The server
  // enforces it atomically anyway — this just avoids a wasted upload
  // when the balance is already zero. Subscribed users skip.
  const gate = useCallback((): string | null => {
    if (isSubscribed) return null;
    if ((credits ?? 0) <= 0) {
      return 'You have used all your free runs for this month. Visit /pricing to get more.';
    }
    return null;
  }, [isSubscribed, credits]);

  const run = useCallback(
    async (extras?: E) => {
      if (!file) {
        setError('No file selected');
        return;
      }
      // Client-side gate before the (possibly large) upload.
      const blocked = gate();
      if (blocked) {
        setError(blocked);
        return;
      }
      setError(null);
      setResult(null);
      setRunning(true);
      try {
        // Default builder: file + every non-empty extras entry. Only
        // tools with custom field names override buildFormData.
        const build = opts.buildFormData ?? ((f: File, ex?: E) => {
          const fd = new FormData();
          fd.append('file', f);
          if (ex) {
            for (const [k, v] of Object.entries(ex)) {
              if (v !== undefined && v !== '') fd.append(k, v);
            }
          }
          return fd;
        });
        const form = build(file, extras);
        // Manual timeout controller — AbortSignal.timeout() isn't
        // available in every browser/WebView, and on abort we want a
        // consistent AbortError we can map to the "took too long" text.
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          opts.timeoutMs ?? 5 * 60_000
        );
        let r: Response;
        try {
          r = await fetch(opts.endpoint, {
            method: 'POST',
            body: form,
            credentials: 'include',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!r.ok) {
          let msg = `HTTP ${r.status}`;
          try {
            const body = await r.json();
            msg = body.error || body.message || msg;
          } catch {
            /* not JSON */
          }
          setError(msg);
          setRunning(false);
          return;
        }
        // Pull tool-specific headers before we consume the body.
        const summaryHdr = r.headers.get(opts.headers.summary);
        const resultHdr = r.headers.get(opts.headers.result);
        const creditsHdr = r.headers.get(opts.headers.credits);
        const disp = r.headers.get('Content-Disposition') ?? '';
        const filenameMatch = disp.match(/filename="?([^";]+)"?/);
        const filename = filenameMatch?.[1] ?? 'download.zip';

        const blob = await r.blob();
        const summary = summaryHdr
          ? safeJsonParse(safeDecode(summaryHdr))
          : null;
        const resultText = resultHdr ? safeDecode(resultHdr) : '';

        // Auto-trigger browser download (uses the shared triggerDownload
        // so the blob URL is tracked + revoked correctly).
        triggerDownload(blob, filename);

        const creditsRemaining =
          creditsHdr === 'unlimited'
            ? null
            : creditsHdr
              ? Number(creditsHdr)
              : credits;
        if (creditsRemaining !== null && Number.isFinite(creditsRemaining)) {
          setCredits(creditsRemaining);
        }
        setResult({
          summary,
          resultText,
          blob,
          filename,
          creditsRemaining,
          message: opts.defaultMessage,
        });
      } catch (e: any) {
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
          setError('Tool took too long — try again or use a smaller file.');
        } else if (e instanceof TypeError) {
          // fetch() network failure (offline, CORS, DNS, refused)
          setError('Network error — check your connection and try again.');
        } else {
          setError(e?.message || 'Network error');
        }
      } finally {
        setRunning(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [file, opts, credits, isSubscribed, triggerDownload]
  );

  // Manual "redownload" — exposed to pages so they can re-trigger the
  // download from the result panel without duplicating the blob-URL
  // handling a third time.
  const downloadResult = useCallback(() => {
    if (!result) return;
    triggerDownload(result.blob, result.filename);
  }, [result, triggerDownload]);

  return {
    user,
    file,
    setFile,
    credits,
    isSubscribed,
    running,
    result,
    error,
    setError,
    run,
    reset,
    downloadResult,
  };
}

function safeJsonParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * decodeURIComponent throws URIError on malformed percent sequences
 * (e.g. "%ZZ" in a summary header). The server always encodeURIComponent's
 * these values, but a proxy could mangle them — fall back to the raw
 * string instead of crashing the run.
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
