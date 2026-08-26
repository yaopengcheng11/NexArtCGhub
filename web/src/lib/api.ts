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
}

/**
 * Type-safe fetch that always sends cookies, parses JSON, and never throws
 * on HTTP errors. Use this instead of `fetch` for everything that hits /api.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiOptions = {}
): Promise<ApiResult<T>> {
  const { body, headers, timeoutMs = 30_000, ...rest } = options;

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
  init.signal = controller.signal;

  try {
    const res = await fetch(url, init);
    clearTimeout(timer);
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
      return {
        ok: false,
        status: res.status,
        error: (data && typeof data === 'object' && data.error) || res.statusText || 'request_failed',
        data,
      };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (e: any) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
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
