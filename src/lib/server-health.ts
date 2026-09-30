import { prisma } from '@/lib/db';

const STRIKES_TO_DIE = 3;

/**
 * فحص حي لهدف واحد (GET range قصير). 200/206 = يعمل؛ 403 = المضيف حي
 * (قد يعمل داخل iframe)؛ غير ذلك = فشل مؤهل.
 */
export async function probeTarget(target: string, timeoutMs = 8000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
        Range: 'bytes=0-0',
      },
    });
    // consume nothing — status is the signal
    try {
      await r.arrayBuffer();
    } catch {
      /* body unreadable — status already known */
    }
    if (r.status === 200 || r.status === 206 || r.status === 403) return true;
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function readFails(headers: string | null): number {
  if (!headers) return 0;
  try {
    const j = JSON.parse(headers) as { v?: number; fails?: number };
    return j?.v === 1 && typeof j.fails === 'number' ? j.fails : 0;
  } catch {
    return 0;
  }
}

/** يطبق نتيجة الفحص بدورة الـ 3 ضربات، ويرجع الحالة الجديدة. */
export async function applyProbe(
  id: string,
  reachable: boolean,
): Promise<{ fails: number; isDead: boolean }> {
  const src = await prisma.episodeSource.findUnique({
    where: { id },
    select: { headers: true, isDead: true },
  });
  if (!src) return { fails: 0, isDead: false };
  const fails = reachable ? 0 : readFails(src.headers) + 1;
  const isDead = reachable ? false : fails >= STRIKES_TO_DIE ? true : src.isDead;
  const headers =
    fails <= 0
      ? null
      : JSON.stringify({ v: 1, fails, ...(reachable ? {} : keepReports(src.headers)) });
  await prisma.episodeSource.update({
    where: { id },
    data: { isDead, headers, lastSyncedAt: new Date() },
  });
  return { fails, isDead };
}

function keepReports(headers: string | null): { reports: { cat: string; at: string }[] } {
  try {
    const j = JSON.parse(headers ?? '{}') as { v?: number; reports?: { cat: string; at: string }[] };
    if (j?.v === 1 && Array.isArray(j.reports)) return { reports: j.reports };
  } catch {
    /* ignore */
  }
  return { reports: [] };
}
