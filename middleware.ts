import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * حماية معقولة ضد الكشط: حد معدل بسيط على /api (60 طلب/دقيقة لكل IP).
 * best-effort على السيرفرلس (الذاكرة لكل instance) — الحماية الحقيقية
 * الأعمق تكون عبر Vercel Firewall/الـ edge، وهذا يوقف الكشط العشوائي.
 *
 * ملاحظة صراحة: لا شيء يمنع فتح DevTools في الويب — أي حيلة JS تُتجاوز
 * بضغطة زر. ما نحميه فعلًا: إغراق الـ API (هنا)، وعدم كشف روابط الستريم
 * الخام في الـ API العام، وعدم وجود تفريغ شامل (كل القوائم مرقّمة).
 */
const WINDOW_MS = 60_000;
const MAX_HITS = 60;
const hits = new Map<string, number[]>();

export function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    const first = hits.keys().next();
    if (!first.done) hits.delete(first.value);
  }

  if (arr.length > MAX_HITS) {
    return NextResponse.json(
      { ok: false, error: 'too many requests — slow down' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: ['/api/:path*'] };
