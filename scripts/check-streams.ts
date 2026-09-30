/* eslint-disable no-console */
/**
 * Stream health check: marks dead mirrors so the player never shows them.
 *
 *   npm run check:streams            check all live sources
 *   npm run check:streams -- --limit 300
 *
 * Rules:
 * - time-bound URLs (expires=/token=/signature=) are SKIPPED, never marked:
 *   they fail by age, not by death, and re-resolve on the next scrape.
 * - a source is dead on: network error, HTTP != 200, or a "deleted/removed"
 *   marker in the page (dood/voe/mp4upload wording).
 * - concurrency 8 + short timeouts to avoid hammering hosts.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const CONCURRENCY = 8;
const TIMEOUT_MS = 15000;

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

async function main() {
  const limitArg = process.argv.find((a) => a === '--limit');
  const limit = limitArg ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0 : 0;

  const sources = await prisma.episodeSource.findMany({
    where: { isDead: false },
    select: { id: true, url: true, streamUrl: true, provider: true },
    orderBy: { lastSyncedAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`checking ${sources.length} live sources…`);

  let dead = 0;
  let skipped = 0;
  let alive = 0;
  for (let i = 0; i < sources.length; i += CONCURRENCY) {
    const batch = sources.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (s) => {
        const target = s.streamUrl || s.url;
        if (!target || !/^https?:\/\//i.test(target)) return { s, skip: true as const };
        if (isSkippable(target)) return { s, skip: true as const };
        return { s, dead: isDeadResult(await fetchText(target)) };
      }),
    );
    for (const r of results) {
      if ('skip' in r) {
        skipped += 1;
        continue;
      }
      if (r.dead) {
        dead += 1;
        await prisma.episodeSource.update({
          where: { id: r.s.id },
          data: { isDead: true, lastSyncedAt: new Date() },
        });
      } else {
        alive += 1;
      }
    }
    if ((i + CONCURRENCY) % 80 === 0 || i + CONCURRENCY >= sources.length) {
      console.log(`  …${Math.min(i + CONCURRENCY, sources.length)}/${sources.length} (dead=${dead} alive=${alive} skipped=${skipped})`);
    }
  }
  console.log(`done: dead=${dead} alive=${alive} skipped(time-bound)=${skipped}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('check failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
