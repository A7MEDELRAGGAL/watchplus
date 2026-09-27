import { RateLimiter, sleep, AbortError } from './rate-limiter';

/**
 * Small in-memory response cache.
 *
 * Purpose is to keep a single scraper run from re-fetching the same page, and to
 * soften the burst a crawl causes. Not a substitute for Redis — on serverless
 * each cold start simply begins empty.
 */
const store = new Map<string, { body: string; expires: number }>();

export function cacheGet(key: string): string | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.body;
}

export function cacheSet(key: string, body: string, ttlMs: number) {
  if (store.size > 500) {
    // cheap eviction: drop the oldest quarter
    const entries = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires);
    entries.slice(0, Math.ceil(entries.length / 4)).forEach(([k]) => store.delete(k));
  }
  store.set(key, { body, expires: Date.now() + ttlMs });
}

export function cacheClear() {
  store.clear();
}

const BROWSER_UA = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

export interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** extra headers merged over the defaults */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** disables the cache lookup/insert for this request */
  noCache?: boolean;
  cacheTtlMs?: number;
  limiter?: RateLimiter;
  /** delay applied after a failed attempt */
  backoffBaseMs?: number;
}

/**
 * Baseline headers for talking to an API.
 *
 * Deliberately *not* a browser navigation fingerprint. `Sec-Fetch-Dest:
 * document`, `Sec-Fetch-Mode: navigate` and `Upgrade-Insecure-Requests` describe
 * a person typing a URL into the address bar; a real `fetch()` never sends them.
 * Jikan answers a 504 to every request wearing that set and a 200 without it, so
 * pretending to be a navigation is not just cosmetic - it breaks real origins.
 */
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_UA[0],
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
};

/**
 * For `html` providers only, where the point is to look like a normal visit to a
 * page. Merged over DEFAULT_HEADERS by the caller.
 */
export const NAVIGATION_HEADERS: Record<string, string> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
};

let uaCursor = 0;
function nextUserAgent() {
  uaCursor = (uaCursor + 1) % BROWSER_UA.length;
  return BROWSER_UA[uaCursor];
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Perform a request and return text, with retry + backoff + polite pacing. */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const {
    method = 'GET',
    body,
    timeoutMs = 20_000,
    retries = 3,
    signal,
    noCache = method === 'POST',
    cacheTtlMs = 10 * 60_000,
    limiter,
    backoffBaseMs = 800,
    headers: extra,
  } = opts;

  const key = `${method} ${url}`;
  if (!noCache) {
    const cached = cacheGet(key);
    if (cached !== undefined) return cached;
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new AbortError();
    if (limiter) await limiter.acquire();

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        headers: {
          ...DEFAULT_HEADERS,
          'User-Agent': nextUserAgent(),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...extra,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new HttpError(`HTTP ${res.status} for ${url}`, res.status, url);
      }

      const text = await res.text();
      if (!noCache) cacheSet(key, text, cacheTtlMs);
      return text;
    } catch (err) {
      lastError = err;
      if (err instanceof AbortError || signal?.aborted) throw new AbortError();
      if (attempt === retries) break;
      const isClientError = err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (isClientError) break;
      // 429 means we are going too fast — wait longer than the backoff
      const retryAfter = err instanceof HttpError && err.status === 429 ? 5_000 : 0;
      const backoff = backoffBaseMs * 2 ** attempt + Math.random() * 400;
      await sleep(backoff + retryAfter, signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** GET or POST and parse JSON. */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    noCache: opts.noCache,
    signal: opts.signal,
    retries: opts.retries,
    timeoutMs: opts.timeoutMs,
    limiter: opts.limiter,
    method: opts.method,
    body: opts.body,
    headers: { Accept: 'application/json', ...(opts.headers ?? {}) },
    cacheTtlMs: opts.cacheTtlMs ?? 30 * 60_000,
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Response from ${url} was not valid JSON`);
  }
}

/** GET a binary buffer — used by the image proxy. */
export async function fetchBinary(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number } = {},
): Promise<{ buffer: Buffer; contentType: string }> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA[0], Accept: 'image/*,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, url);
    const buf = Buffer.from(await res.arrayBuffer());
    const max = opts.maxBytes ?? 8 * 1024 * 1024;
    return { buffer: buf.byteLength > max ? buf.subarray(0, max) : buf, contentType: res.headers.get('content-type') ?? 'image/jpeg' };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** Run `worker` over `items` with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await worker(items[i], i);
      }
    }),
  );

  return results;
}
