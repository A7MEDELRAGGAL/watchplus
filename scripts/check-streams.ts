/* eslint-disable no-console */
/**
 * Stream health check with a 3-strike lifecycle (per data contract):
 * unknown → active/suspect → dead. A single failure, a 403, or a lone HEAD
 * never kills a mirror — only 3 consecutive qualified failures mark it dead,
 * and the record is kept (never deleted). Success resurrects (active).
 * Time-bound URLs (expires=/token=) are SKIPPED, never marked.
 *
 *   npm run check:streams                  live sources only
 *   npm run check:streams -- --limit 300
 *   npm run check:streams -- --include-dead   + weekly recheck of stale dead
 *
 * The strike counter lives in EpisodeSource.headers as {"v":1,"fails":n}
 * (that column is otherwise unused) — no schema change needed.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const CONCURRENCY = 8;
const TIMEOUT_MS = 15000;
const STRIKES_TO_DIE = 3;
const RECHECK_DEAD_AFTER_DAYS = 7;

const SKIP_PATTERNS = [/expires=/i, /[?&]token=/i, /signature=/i, /exp=\d{9,}/];
const DEAD_MARKERS = [
  'file was deleted',
  'file deleted',
  'has been deleted',
  'has been removed',
  'no longer available',
  'not found',
  'video not found',
  'this video does not exist',
  'removed for',
  'copyright',
  'dmca',
];

function isSkippable(url: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(url));
}

async function fetchText(url: string): Promise<{ status: number; text: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
    });
    const text = (await r.text()).slice(0, 20000).toLowerCase();
    return { status: r.status, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isDeadResult(res: { status: number; text: string } | null): boolean {
  if (!res) return true;
  if (res.status === 404 || res.status === 410) return true;
  if (res.status !== 200) return true;
  return DEAD_MARKERS.some((m) => res.text.includes(m));
}

/** strike counter stored in the unused headers column. */
function readFails(headers: string | null): number {
  if (!headers) return 0;
  try {
    const j = JSON.parse(headers) as { v?: number; fails?: number };
    return j?.v === 1 && typeof j.fails === 'number' ? j.fails : 0;
  } catch {
    return 0; // real headers data — never touch, treat as 0 strikes
  }
}

function writeFails(headers: string | null, fails: number): string | null {
  if (fails <= 0) {
    if (!headers) return null;
    try {
      const j = JSON.parse(headers) as { v?: number };
      if (j?.v === 1) return null; // ours — clear on success
    } catch { /* real data below */ }
    return headers; // someone else's headers — leave them
  }
  return JSON.stringify({ v: 1, fails });
}

async function main() {
  const limitArg = process.argv.find((a) => a === '--limit');
  const limit = limitArg ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0 : 0;
  const includeDead = process.argv.includes('--include-dead');
  const newestFirst = process.argv.includes('--newest');
  const staleBefore = new Date(Date.now() - RECHECK_DEAD_AFTER_DAYS * 86400 * 1000);

  const where = includeDead
    ? { OR: [{ isDead: false }, { isDead: true, lastSyncedAt: { lt: staleBefore } }] }
    : { isDead: false };
  const select = { id: true, url: true, streamUrl: true, provider: true, headers: true, isDead: true } as const;
  // البلاغات أولًا (المستخدمون يساعدون التنظيف) ثم الأقدم فحصًا
  const reported = await prisma.episodeSource.findMany({
    where: { ...where, headers: { contains: '"reports"' } },
    select,
    orderBy: { lastSyncedAt: 'asc' },
    take: 200,
  });
  const rest = await prisma.episodeSource.findMany({
    where: { ...where, NOT: { id: { in: reported.map((r) => r.id) } } },
    select,
    orderBy: newestFirst ? { lastSyncedAt: 'desc' } : { lastSyncedAt: 'asc' },
    ...(limit ? { take: Math.max(0, limit - reported.length) } : {}),
  });
  const sources = [...reported, ...rest];
  console.log(`checking ${sources.length} sources (${reported.length} reported first, include-dead=${includeDead})…`);

  let dead = 0;
  let resurrected = 0;
  let skipped = 0;
  let alive = 0;
  let suspects = 0;
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (s) => {
        const target = s.streamUrl || s.url;
        if (!target || !/^https?:\/\//i.test(target)) return { s, skip: true as const };
        if (isSkippable(target)) return { s, skip: true as const };
        return { s, failed: isDeadResult(await fetchText(target)) };
      }),
    );
    for (const r of results) {
      if ('skip' in r) {
        skipped += 1;
        continue;
      }
      const fails = readFails(r.s.headers);
      if (!r.failed) {
        alive += 1;
        // النجاح يعيده active دائمًا (إحياء) ويصفّر الضربات
        if (r.s.isDead || fails > 0) {
          resurrected += r.s.isDead ? 1 : 0;
          await prisma.episodeSource.update({
            where: { id: r.s.id },
            data: { isDead: false, headers: writeFails(r.s.headers, 0), lastSyncedAt: new Date() },
          });
        }
        continue;
      }
      const next = fails + 1;
      if (next >= STRIKES_TO_DIE) {
        if (!r.s.isDead) dead += 1;
        await prisma.episodeSource.update({
          where: { id: r.s.id },
          data: { isDead: true, headers: writeFails(r.s.headers, next), lastSyncedAt: new Date() },
        });
      } else {
        suspects += 1; // مشتبه (1-2 ضربات) — يبقى ظاهرًا حتى الضربة الثالثة
        await prisma.episodeSource.update({
          where: { id: r.s.id },
          data: { headers: writeFails(r.s.headers, next), lastSyncedAt: new Date() },
        });
      }
    }
    if ((i + CONCURRENCY) % 80 === 0 || i + CONCURRENCY >= sources.length) {
      console.log(`  …${Math.min(i + CONCURRENCY, sources.length)}/${sources.length} (dead=${dead} suspects=${suspects} alive=${alive} resurrected=${resurrected} skipped=${skipped})`);
    }
  }
  console.log(`done: dead=${dead} suspects(1-2 strikes)=${suspects} alive=${alive} resurrected=${resurrected} skipped(time-bound)=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
