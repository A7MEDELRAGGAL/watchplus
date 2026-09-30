/* eslint-disable no-console */
/**
 * Backdrop backfill: AniList `bannerImage` → Title.backdropUrl (when missing).
 * يملأ خلفيات السلايدر وصفحة التفاصيل من MAL/AniList.
 *
 *   npm run fix:backdrops            dry run (first 10 shown)
 *   npm run fix:backdrops -- --go    apply
 *   npm run fix:backdrops -- --go --limit 100
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function banner(anilistId: number): Promise<string | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ($id: Int) { Media(id: $id, type: ANIME) { bannerImage } }',
        variables: { id: anilistId },
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    return j?.data?.Media?.bannerImage ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const go = process.argv.includes('--go');
  const limitArg = process.argv.find((a) => a === '--limit');
  const limit = limitArg ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0 : 0;
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED', backdropUrl: null },
    select: { id: true, originalTitle: true, extra: true },
    orderBy: { popularity: 'desc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`titles without backdrop: ${titles.length}`);

  let filled = 0;
  let skipped = 0;
  for (const t of titles) {
    let anilistId: number | null = null;
    try {
      const ex = JSON.parse(t.extra ?? '{}');
      if (typeof ex.anilistId === 'number') anilistId = ex.anilistId;
    } catch { /* no extra */ }
    if (!anilistId) {
      skipped += 1;
      continue;
    }
    const url = await banner(anilistId);
    if (url) {
      if (go) {
        await prisma.title.update({ where: { id: t.id }, data: { backdropUrl: url } });
      }
      filled += 1;
      if (filled <= 10) console.log(`  ✅ ${t.originalTitle.slice(0, 45)}`);
    } else {
      skipped += 1;
    }
    await sleep(350);
  }
  console.log(go ? `filled: ${filled} skipped(no banner/id): ${skipped}` : `would fill ~${filled}, dry run`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('backdrops failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
