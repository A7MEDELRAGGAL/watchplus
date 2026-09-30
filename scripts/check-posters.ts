/* eslint-disable no-console */
/**
 * Poster health: HEAD-checks non-AniList posters (source CDN images rot),
 * nulls the dead so `enrich:mal` refills them from MAL/AniList.
 *
 *   npm run fix:posters            dry run
 *   npm run fix:posters -- --go    apply (then run enrich:mal)
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const CONCURRENCY = 8;
const TIMEOUT_MS = 12000;

async function alive(url: string): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
        Range: 'bytes=0-0',
      },
    });
    // drain nothing — abort right away; status is what matters
    ctrl.abort();
    return r.status === 200 || r.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const rows = await prisma.title.findMany({
    where: { posterUrl: { not: null }, NOT: { posterUrl: { contains: 'anilist.co' } } },
    select: { id: true, originalTitle: true, posterUrl: true },
  });
  const uniq = new Map<string, typeof rows>();
  for (const r of rows) {
    const l = uniq.get(r.posterUrl!) ?? [];
    l.push(r);
    uniq.set(r.posterUrl!, l);
  }
  console.log(`checking ${uniq.size} distinct source posters…`);

  const dead: string[] = [];
  const urls = [...uniq.keys()];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(async (u) => ({ u, ok: await alive(u) })));
    for (const r of res) if (!r.ok) dead.push(r.u);
    if ((i + CONCURRENCY) % 40 === 0 || i + CONCURRENCY >= urls.length) {
      console.log(`  …${Math.min(i + CONCURRENCY, urls.length)}/${urls.length} dead=${dead.length}`);
    }
  }

  console.log(`\ndead posters: ${dead.length}/${uniq.size}`);
  for (const u of dead.slice(0, 15)) {
    const owners = uniq.get(u)!.map((r) => r.originalTitle.slice(0, 30));
    console.log(`  ✂ ${u.slice(0, 80)} (${owners.length}: ${owners.slice(0, 2).join('، ')})`);
  }
  if (dead.length > 15) console.log(`  …and ${dead.length - 15} more`);

  if (go && dead.length) {
    const r = await prisma.title.updateMany({
      where: { posterUrl: { in: dead } },
      data: { posterUrl: null },
    });
    console.log(`nulled on ${r.count} title(s) — run npm run enrich:mal to refill from MAL/AniList`);
  } else console.log('dry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('posters failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
