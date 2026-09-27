/* eslint-disable no-console */
/** Quick database inspection for development. */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { fromJsonText } from '../src/lib/db-json';

interface Genre {
  name: string;
  slug?: string;
}

(async () => {
  const titles = await prisma.title.findMany({
    take: 5,
    orderBy: { popularity: 'desc' },
    include: {
      seasons: { include: { episodes: { take: 3 } } },
      sources: true,
    },
  });

  for (const t of titles) {
    const genres = fromJsonText<Genre[]>(t.genres, []).map((g) => g.name);
    console.log('─'.repeat(70));
    console.log(`${t.originalTitle}  [${t.type}]  (${t.releaseYear ?? '----'})`);
    console.log(`  slug      ${t.slug}`);
    console.log(`  key       ${t.key}`);
    console.log(`  rating    ${t.rating ?? '-'}  (${t.votesCount ?? 0} votes)`);
    console.log(`  ar / en   ${t.titleAr ?? '-'}  /  ${t.titleEn ?? '-'}`);
    console.log(`  genres    ${genres.slice(0, 6).join(', ') || '-'}`);
    console.log(`  status    ${t.showStatus ?? '-'}  ongoing=${t.isOngoing}`);
    console.log(`  seasons   ${t.totalSeasons ?? 0}  episodes ${t.totalEpisodes ?? 0}`);
    console.log(`  poster    ${t.posterUrl ? 'yes' : 'no'}`);
    console.log(`  backdrop  ${t.backdropUrl ? 'yes' : 'no'}`);
    console.log(`  sources   ${t.sources.map((s) => `${s.provider}(${s.providerId})`).join(', ')}`);
    for (const s of t.seasons) {
      console.log(`    season ${s.number}: ${s.episodes.length} episode(s) loaded`);
      for (const e of s.episodes.slice(0, 2)) {
        console.log(`      ep ${e.number} ${e.name ?? ''} (${e.runtime ?? '?'} min)`);
      }
    }
  }

  const counts = {
    titles: await prisma.title.count(),
    seasons: await prisma.season.count(),
    episodes: await prisma.episode.count(),
    streams: await prisma.episodeSource.count(),
    sources: await prisma.source.count(),
    runs: await prisma.scrapeRun.count(),
  };
  console.log('─'.repeat(70));
  console.log('counts:', JSON.stringify(counts));
  await prisma.$disconnect();
})();
