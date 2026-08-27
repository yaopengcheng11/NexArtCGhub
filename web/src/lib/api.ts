/**
 * Centralized fetch wrapper. Always sends cookies (the API uses httpOnly
 * session cookies, so without `credentials: 'include'` the browser
 * drops them and every authenticated request fails as anonymous).
 *
 * Also normalizes error handling: returns `{ ok, data, error }` instead
 * of throwing, so callers don't need their own try/catch + res.ok check.
 */

export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}
export interface ApiFailure {
  ok: false;
  status: number;
  error: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any; // raw error body if JSON-parsable
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

// Helper: narrow an ApiResult<T> to its error side, so callers can
// safely access .error / .status without TS complaining.
export function failureOf<T>(r: ApiResult<T>): ApiFailure {
  return r as ApiFailure;
}

export class FetchError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body?: any) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: BodyInit | object | null;
  /** ms before the request is aborted. Default 30s; tool uploads 5min. */
  timeoutMs?: number;
  /**
   * How to read the response body. 'json' (default) tries JSON.parse and
   * falls back to the raw string; 'blob' returns the raw Blob (use this
   * for binary endpoints like /api/tools/[slash]/run or /api/hda/download:
   * reading a zip through res.text() would decode it as UTF-8, corrupting
   * the bytes and ballooning memory 3-4x).
   */
  responseType?: 'json' | 'blob';
  /**
   * Callers can pass their own AbortController signal (e.g. to cancel a
   * long upload from the UI). It is combined with the internal timeout
   * signal — whichever fires first wins.
   */
  signal?: AbortSignal | null;
}

/**
 * Type-safe fetch that always sends cookies, parses JSON, and never throws
 * on HTTP errors. Use this instead of `fetch` for everything that hits /api.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiOptions = {}
): Promise<ApiResult<T>> {
  const {
    body,
    headers,
    timeoutMs = 30_000,
    responseType = 'json',
    signal: callerSignal,
    ...rest
  } = options;

  const init: RequestInit = {
    credentials: 'include',
    ...rest,
    headers: {
      ...(body && typeof body === 'object' && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body:
      body == null
        ? undefined
        : body instanceof FormData || typeof body === 'string'
          ? body
          : JSON.stringify(body),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Combine the internal timeout with any caller-provided signal —
  // previously a caller signal was silently overwritten by ours.
  init.signal = callerSignal
    ? (AbortSignal as any).any
      ? (AbortSignal as any).any([controller.signal, callerSignal])
      : controller.signal
    : controller.signal;

  try {
    const res = await fetch(url, init);
    clearTimeout(timer);

    // Binary response type: return the Blob untouched. Error responses
    // still go through the JSON error path below (the server always
    // returns JSON errors even for binary endpoints).
    if (responseType === 'blob' && res.ok) {
      const blob = await res.blob();
      return { ok: true, status: res.status, data: blob as T };
    }

    // Never read an HTML error page as JSON — if the content-type is
    // not JSON (proxy 502 pages, SPA fallback, etc.), surface a clean
    // error instead of trying to parse it.
    const contentType = res.headers.get('Content-Type') ?? '';
    const isJson = contentType.includes('application/json');

    if (!isJson) {
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error:
            res.status === 502 || res.status === 504
              ? 'bad_gateway'
              : `http_${res.status}`,
        };
      }
      // 2xx but not JSON (rare) — return null data rather than garbage.
      return { ok: true, status: res.status, data: null as T };
    }

    const text = await res.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      // Prefer body.error, then body.message (FastAPI convention), then
      // statusText. Matches what useToolRun.ts does for its raw-fetch path.
      const errMsg =
        (data && typeof data === 'object' && (data.error || data.message)) ||
        res.statusText ||
        'request_failed';
      return {
        ok: false,
        status: res.status,
        error: String(errMsg),
        data,
      };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      return { ok: false, status: 0, error: 'timeout' };
    }
    if (e?.name === 'TimeoutError') {
      return { ok: false, status: 0, error: 'timeout' };
    }
    return { ok: false, status: 0, error: e?.message || 'network_error' };
  }
}

/** Throwing variant — useful when you actually want a try/catch style. */
export async function apiFetchOrThrow<T = unknown>(
  url: string,
  options: ApiOptions = {}
): Promise<T> {
  const result = await apiFetch<T>(url, options);
  if (!result.ok) {
    const failure = result as ApiFailure;
    throw new FetchError(failure.status, failure.error, failure.data);
  }
  return result.data;
}
