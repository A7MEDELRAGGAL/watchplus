/* eslint-disable no-console */
/**
 * Prints a couple of fully-populated titles so a bad import is visible at a
 * glance — missing posters, zero episodes, or empty genre lists all show up
 * here instead of on the site.
 *
 *   npm run db:inspect
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { fromJsonText } from '../src/lib/db-json';

async function main() {
  const totals = {
    titles: await prisma.title.count(),
    seasons: await prisma.season.count(),
    episodes: await prisma.episode.count(),
    sources: await prisma.titleSource.count(),
    users: await prisma.user.count(),
  };
  console.log('\n  table counts');
  for (const [k, v] of Object.entries(totals)) {
    console.log(`    ${k.padEnd(10)} ${v}`);
  }

  const worst = await prisma.title.findMany({
    take: 3,
    orderBy: { votesCount: { sort: 'desc', nulls: 'last' } },
    select: {
      originalTitle: true,
      titleAr: true,
      slug: true,
      type: true,
      releaseYear: true,
      rating: true,
      posterUrl: true,
      genres: true,
      overview: true,
      seasons: {
        select: {
          number: true,
          _count: { select: { episodes: true } },
          episodes: { take: 2, select: { number: true, name: true, airDate: true } },
        },
      },
    },
  });

  console.log('\n  sample titles');
  for (const t of worst) {
    const genres = fromJsonText<{ name: string }[]>(t.genres, []);
    const eps = t.seasons.reduce((n, s) => n + s._count.episodes, 0);
    console.log(`\n    ${t.titleAr ?? '(no Arabic title)'}  /  ${t.originalTitle}`);
    console.log(`      slug      ${t.slug}`);
    console.log(`      type      ${t.type}   ${t.releaseYear ?? '—'}   rating ${t.rating ?? '—'}`);
    console.log(`      poster    ${t.posterUrl ? 'yes' : 'MISSING'}`);
    console.log(`      genres    ${genres.map((g) => g.name).join(', ') || 'NONE'}`);
    console.log(`      overview  ${t.overview ? `${t.overview.length} chars` : 'MISSING'}`);
    console.log(`      seasons   ${t.seasons.length}   episodes ${eps}`);
    for (const s of t.seasons) {
      const first = s.episodes[0];
      console.log(
        `        S${s.number}: ${s._count.episodes} eps` +
          (first ? `  (E${first.number} "${first.name ?? '—'}" ${first.airDate ?? ''})` : ''),
      );
    }
  }

  // Things that look like a broken import.
  const noPoster = await prisma.title.count({ where: { posterUrl: null } });
  const noOverview = await prisma.title.count({ where: { overview: null } });
  const noEpisodes = await prisma.title.count({
    where: { type: { in: ['SERIES', 'ANIME'] }, seasons: { none: {} } },
  });

  // A slug like `anime-anilist-103303` means the id fallback won over the
  // readable title. Run `npm run db:slugs` if this is non-zero.
  const idShaped = await prisma.title.findMany({
    where: { slug: { contains: '-anilist-' } },
    select: { slug: true },
    take: 5,
  });

  console.log('\n  data quality');
  console.log(`    no poster     ${noPoster}/${totals.titles}`);
  console.log(`    no overview   ${noOverview}/${totals.titles}`);
  console.log(`    series w/ 0 eps  ${noEpisodes}`);
  console.log(`    id-shaped slugs  ${idShaped.length}${idShaped.length ? ' (run npm run db:slugs)' : ''}`);
  for (const t of idShaped) console.log(`      ${t.slug}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
