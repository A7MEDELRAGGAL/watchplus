import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

/**
 * Image proxy for scraped artwork.
 *
 * Every poster comes from whatever CDN the source used, so instead of
 * whitelisting hosts in next.config.js the URL is fetched here. That makes this
 * endpoint an open proxy unless it is fenced in, hence:
 *
 *   1. only http/https
 *   2. never a private, loopback or link-local address (SSRF)
 *   3. optional host allowlist via IMAGE_PROXY_ALLOWLIST ("*" disables it)
 *   4. the response is size-capped, so a huge file cannot be used to fill memory
 */

const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const WIDTHS = [64, 96, 128, 160, 200, 256, 320, 384, 448, 512, 640, 750, 828, 1080, 1200, 1600];

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  // Cloud metadata endpoint — the classic reason to fence an open proxy.
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  return false;
}

function allowedByList(hostname: string): boolean {
  const raw = process.env.IMAGE_PROXY_ALLOWLIST?.trim();
  if (!raw || raw === '*') return true;
  const host = hostname.toLowerCase();
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern));
}

function pickWidth(requested: number | null): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) return 640;
  // Snap to a known bucket so a hostile client cannot mint unlimited cache keys.
  return WIDTHS.reduce((best, w) => (Math.abs(w - requested) < Math.abs(best - requested) ? w : best), WIDTHS[0]);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const raw = params.get('url');

  if (!raw) return error('missing url', 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return error('malformed url', 400);
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return error('unsupported protocol', 400);
  }
  if (isBlockedHost(target.hostname)) return error('blocked host', 403);
  if (!allowedByList(target.hostname)) return error('host not allowed', 403);

  const width = pickWidth(Number(params.get('w')));
  const quality = Math.min(95, Math.max(40, Number(params.get('q')) || 75));
  const ttl = Math.min(60 * 60 * 24 * 30, Number(process.env.IMAGE_PROXY_TTL) || 60 * 60 * 24);

  const upstream = new URL(target.toString());
  upstream.searchParams.set('w', String(width));
  upstream.searchParams.set('q', String(quality));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(upstream, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
    });

    if (!res.ok) return error(`upstream ${res.status}`, 502);

    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return error('not an image', 415);

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared && declared > MAX_BYTES) return error('image too large', 413);

    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return error('image too large', 413);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(body.byteLength),
        // Immutable-ish: the key includes w/q, and the TTL controls revalidation.
        'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=86400`,
        Vary: 'Accept',
      },
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return error(aborted ? 'upstream timeout' : 'upstream unreachable', aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}
