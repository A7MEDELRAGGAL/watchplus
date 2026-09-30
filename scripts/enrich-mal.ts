/* eslint-disable no-console */
/**
 * MAL enrichment: fills poster/overview/rating/genres for titles missing them,
 * using Jikan (free, no key). Never touches seasons/episodes/sources.
 *
 *   npm run enrich:mal                 titles missing poster OR overview OR rating
 *   npm run enrich:mal -- --limit 50
 *   npm run enrich:mal -- --all        re-check everything (refresh scores)
 *
 * Matching: Jikan search by English title, accept first result whose title
 * shares 2+ significant words (avoids wrong-anime poisoning).
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const BASE = process.env.JIKAN_BASE_URL ?? 'https://api.jikan.moe/v4';
const SLEEP_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function words(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|season|part|movie|ova|ona|special)$/.test(w));
}

function matchScore(a: string, b: string): number {
  const wa = new Set(words(a));
  let n = 0;
  for (const w of words(b)) if (wa.has(w)) n += 1;
  return n;
}

async function jikanSearch(q: string): Promise<any[]> {
  try {
    const r = await fetch(`${BASE}/anime?q=${encodeURIComponent(q)}&limit=8&sfw=true`);
    if (r.status === 429) {
      await sleep(5000);
      return jikanSearch(q);
    }
    if (!r.ok) return [];
    const j = (await r.json()) as any;
    return j?.data ?? [];
  } catch {
    return []; // Jikan/MAL down — AniList covers
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;]+;/g, ' ')
    .trim();
}

/** AniList GraphQL — يعمل حتى عند سقوط Jikan/MAL. */
async function anilistSearch(q: string): Promise<any | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query ($s: String) {
          Media(search: $s, type: ANIME) {
            id title { romaji english native } coverImage { large }
            averageScore description genres seasonYear
            studios { nodes { name } }
          }
        }`,
        variables: { s: q.slice(0, 80) },
      }),
    });
    if (r.status === 429) {
      await sleep(10000);
      return anilistSearch(q);
    }
    if (!r.ok) return null;
    const j = (await r.json()) as any;
    return j?.data?.Media ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const limitArg = process.argv.find((a) => a === '--limit');
  const limit = limitArg ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 0 : 0;
  const all = process.argv.includes('--all');

  const titles = await prisma.title.findMany({
    where: all
      ? { status: 'PUBLISHED' }
      : {
          status: 'PUBLISHED',
          OR: [{ posterUrl: null }, { overview: null }, { rating: null }],
        },
    select: { id: true, originalTitle: true, titleEn: true, posterUrl: true },
    orderBy: { updatedAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log(`enriching ${titles.length} titles…`);

  let ok = 0;
  let miss = 0;
  for (const t of titles) {
    const q = t.titleEn || t.originalTitle;
    try {
      // 1) AniList أولًا (شغال دائمًا تقريبًا)
      const ani = await anilistSearch(q);
      const aniScore = ani
        ? Math.max(
            matchScore(q, ani.title?.romaji ?? ''),
            matchScore(q, ani.title?.english ?? ''),
          )
        : 0;
      if (ani && aniScore >= 2) {
        const poster = ani.coverImage?.large ?? null;
        await prisma.title.update({
          where: { id: t.id },
          data: {
            ...(poster ? { posterUrl: poster } : {}),
            ...(ani.description ? { overview: stripHtml(ani.description).slice(0, 2000) } : {}),
            ...(typeof ani.averageScore === 'number' ? { rating: ani.averageScore / 10 } : {}),
            ...(ani.seasonYear ? { releaseYear: ani.seasonYear } : {}),
            ...(ani.genres?.length ? { genres: JSON.stringify(ani.genres.map((g: string) => ({ name: g }))) } : {}),
            ...(ani.studios?.nodes?.length
              ? { studios: JSON.stringify(ani.studios.nodes.map((s: any) => ({ name: s.name }))) }
              : {}),
            extra: JSON.stringify({ anilistId: ani.id }),
          },
        });
        ok += 1;
        console.log(`  ✅ ${t.originalTitle.slice(0, 45)} ← AniList ${ani.id}`);
      } else {
        // 2) Jikan احتياطيًا (عندما يعود MAL للعمل)
        const results = await jikanSearch(q);
        let best: any = null;
        let bestScore = 0;
        for (const r of results) {
          const s = Math.max(matchScore(q, r.title ?? ''), matchScore(q, r.title_english ?? ''));
          if (s > bestScore) {
            bestScore = s;
            best = r;
          }
        }
        if (!best || bestScore < 2) {
          miss += 1;
          console.log(`  ➖ ${t.originalTitle.slice(0, 45)}: لا تطابق`);
        } else {
          const poster = best.images?.jpg?.large_image_url ?? best.images?.jpg?.image_url ?? null;
          await prisma.title.update({
            where: { id: t.id },
            data: {
              ...(poster ? { posterUrl: poster } : {}),
              ...(best.synopsis ? { overview: best.synopsis } : {}),
              ...(typeof best.score === 'number' ? { rating: best.score } : {}),
              ...(typeof best.scored_by === 'number' ? { votesCount: best.scored_by } : {}),
              ...(best.aired?.from ? { releaseDate: new Date(best.aired.from) } : {}),
              ...(best.year ? { releaseYear: best.year } : {}),
              ...(best.genres?.length
                ? { genres: JSON.stringify(best.genres.map((g: any) => ({ name: g.name }))) }
                : {}),
              extra: JSON.stringify({ malId: best.mal_id, malUrl: best.url }),
            },
          });
          ok += 1;
          console.log(`  ✅ ${t.originalTitle.slice(0, 45)} ← MAL ${best.mal_id}`);
        }
      }
    } catch (e) {
      miss += 1;
      console.log(`  ⚠️ ${t.originalTitle.slice(0, 45)}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`done: enriched=${ok} missed=${miss}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('enrich failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
