/* eslint-disable no-console */
/**
 * Merge exact-duplicate titles: same normalized name, but only one row has
 * playable streams. The stream-less rows (usually anilist catalogue doubles
 * of a csv row) show empty players — copy any metadata they have that the
 * survivor lacks, then delete them.
 *
 *   npm run merge:dups            dry run (lists, deletes nothing)
 *   npm run merge:dups -- --go    apply
 *
 * Never deletes: the sole row of a show, or any row WITH live streams.
 * Rows with streams on both sides are kept (mirrors by design).
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const norm = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s{2,}/g, ' ').trim();

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true, key: true, originalTitle: true, posterUrl: true, overview: true, rating: true,
      seasons: {
        select: { episodes: { select: { sources: { where: { isDead: false }, select: { id: true } } } } },
      },
    },
  });

  const byName = new Map<string, typeof titles>();
  for (const t of titles) {
    const k = norm(t.originalTitle);
    if (!k) continue;
    const l = byName.get(k) ?? [];
    l.push(t);
    byName.set(k, l);
  }

  const live = (t: (typeof titles)[number]) =>
    t.seasons.flatMap((s) => s.episodes).filter((e) => e.sources.length > 0).length;

  let condemned = 0;
  for (const [name, group] of [...byName.entries()].sort()) {
    if (group.length < 2) continue;
    const withLive = group.filter((t) => live(t) > 0);
    if (!withLive.length) continue; // nobody playable — not ours to judge
    const dead = group.filter((t) => live(t) === 0);
    if (!dead.length) continue; // both playable — mirrors by design
    const surv = withLive.sort((a, b) => live(b) - live(a))[0];
    console.log(`\n  "${name}" survivor=${surv.key} liveEps=${live(surv)}`);
    for (const d of dead) {
      console.log(`    ✂ ${d.key}`);
      if (go) {
        // keep any metadata the survivor lacks
        await prisma.title.update({
          where: { id: surv.id },
          data: {
            ...(surv.posterUrl ? {} : d.posterUrl ? { posterUrl: d.posterUrl } : {}),
            ...(surv.overview ? {} : d.overview ? { overview: d.overview } : {}),
            ...(surv.rating != null ? {} : d.rating != null ? { rating: d.rating } : {}),
          },
        });
        const fresh = await prisma.title.findUnique({
          where: { id: surv.id }, select: { posterUrl: true, overview: true, rating: true },
        });
        Object.assign(surv, fresh);
        await prisma.title.delete({ where: { id: d.id } });
        condemned += 1;
      }
    }
  }
  console.log(go ? `\ndeleted: ${condemned}` : '\ndry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('merge failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
