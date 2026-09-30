/* eslint-disable no-console */
/**
 * Movie-type backfill + Japanese native-name backfill (extra.titleNative).
 *
 *   npm run fix:meta            dry run
 *   npm run fix:meta -- --go    apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { looksLikeMovie } from '../src/lib/scraper/providers/csv-import';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nativeOf(anilistId: number): Promise<string | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ($id: Int) { Media(id: $id, type: ANIME) { title { native } } }',
        variables: { id: anilistId },
      }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    return j?.data?.Media?.title?.native ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, type: true, originalTitle: true, extra: true, sources: { select: { url: true } } },
  });

  // 1) أفلام مصنفة مسلسل
  const movies = titles.filter(
    (t) => t.type !== 'MOVIE' && looksLikeMovie(t.originalTitle, t.sources[0]?.url ?? ''),
  );
  console.log(`movie candidates: ${movies.length}`);
  movies.forEach((t) => console.log(`  🎬 ${t.originalTitle.slice(0, 50)}`));
  if (go && movies.length) {
    await prisma.title.updateMany({ where: { id: { in: movies.map((t) => t.id) } }, data: { type: 'MOVIE' } });
    console.log('marked MOVIE');
  }

  // 2) الاسم الياباني
  let filled = 0;
  let skipped = 0;
  for (const t of titles) {
    let ex: any = {};
    try {
      ex = JSON.parse(t.extra ?? '{}');
    } catch { /* keep */ }
    if (ex.titleNative || typeof ex.anilistId !== 'number') {
      skipped += 1;
      continue;
    }
    const native = await nativeOf(ex.anilistId);
    if (native) {
      if (go) {
        await prisma.title.update({
          where: { id: t.id },
          data: { extra: JSON.stringify({ ...ex, titleNative: native }) },
        });
      }
      filled += 1;
      if (filled <= 5) console.log(`  🇯🇵 ${t.originalTitle.slice(0, 40)} ← ${native}`);
    } else skipped += 1;
    await sleep(300);
  }
  console.log(go ? `native filled: ${filled} skipped: ${skipped}` : `would fill ~${filled} (dry run)`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('meta failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
