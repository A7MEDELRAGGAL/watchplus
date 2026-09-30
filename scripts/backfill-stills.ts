/* eslint-disable no-console */
/**
 * Stills backfill: episodes without a still image inherit the title poster,
 * so no grey empty boxes remain. MAL has no per-episode image API — the
 * poster is the honest fallback (see enrich-episodes.ts for MAL names).
 *
 *   npm run fix:stills            dry run
 *   npm run fix:stills -- --go    apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const total = await prisma.episode.count({ where: { stillUrl: null } });
  console.log(`episodes without still: ${total}`);
  if (!go) {
    console.log('dry run, nothing written');
    await prisma.$disconnect();
    return;
  }

  const titles = await prisma.title.findMany({
    where: { posterUrl: { not: null }, seasons: { some: { episodes: { some: { stillUrl: null } } } } },
    select: { id: true, posterUrl: true },
  });
  let n = 0;
  for (const t of titles) {
    const r = await prisma.episode.updateMany({
      where: { stillUrl: null, season: { titleId: t.id } },
      data: { stillUrl: t.posterUrl },
    });
    n += r.count;
  }
  console.log(`filled: ${n}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('stills failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
