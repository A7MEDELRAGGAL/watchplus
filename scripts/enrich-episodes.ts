/* eslint-disable no-console */
/**
 * MAL episode enrichment: fills generic/missing episode names with the
 * romanji titles from Jikan (MyAnimeList), and swaps poster-fallback stills
 * for real MAL episode thumbnails (Jikan videos endpoint).
 *
 * MAL has no full per-episode image API — videos cover recent episodes;
 * anything uncovered keeps the poster fallback (no grey boxes either way).
 *
 *   npm run enrich:eps -- --limit 20
 *
 * Resolves MAL id via AniList idMal when only an anilistId is stored.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const JIKAN = process.env.JIKAN_BASE_URL ?? 'https://api.jikan.moe/v4';
const SLEEP_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GENERIC_EP = /^episode\s*\d+$/i;

async function getJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'WatchBox/1.0 (catalogue enrichment)' },
    });
    if (!r.ok) return null;
    return (await r.json()) as any;
  } catch {
    return null;
  }
}

async function idMalFromAnilist(anilistId: number): Promise<number | null> {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ($id: Int) { Media(id: $id, type: ANIME) { idMal } }',
        variables: { id: anilistId },
      }),
    });
    if (!r.ok) return null;
    const b = (await r.json()) as any;
    return typeof b?.data?.Media?.idMal === 'number' ? b.data.Media.idMal : null;
  } catch {
    return null;
  }
}

function latinQuery(q: string): string {
  const stop = new Set(['episode', 'episodes', 'movie', 'ova', 'ona', 'special', 'season', 'part', 'the', 'and']);
  return q.replace(/[^A-Za-z0-9:!'’\- ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !stop.has(w.toLowerCase()))
    .slice(0, 6).join(' ');
}

/** AniList search → idMal مباشرة (لصفوف CSV التي لم تُثرَ بعد). */
async function idMalBySearch(title: string): Promise<number | null> {
  const q = latinQuery(title);
  if (!q) return null;
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'query ($s: String) { Media(search: $s, type: ANIME) { idMal } }',
        variables: { s: q.slice(0, 80) },
      }),
    });
    if (!r.ok) return null;
    const b = (await r.json()) as any;
    return typeof b?.data?.Media?.idMal === 'number' ? b.data.Media.idMal : null;
  } catch {
    return null;
  }
}

function epNum(label: string): number | null {
  const m = String(label ?? '').match(/(?:episode|ep|#)\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  const limitArg = process.argv.find((a) => a === '--limit');
  const limit = limitArg ? Number(process.argv[process.argv.indexOf('--limit') + 1]) || 20 : 20;

  // titles with playable streams first (visible catalogue wins)
  const titles = await prisma.title.findMany({
    where: {
      status: 'PUBLISHED',
      seasons: { some: { episodes: { some: { sources: { some: { isDead: false } } } } } },
    },
    select: {
      id: true, originalTitle: true, posterUrl: true, extra: true,
      seasons: { select: { episodes: { select: { id: true, number: true, name: true, stillUrl: true } } } },
    },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  });
  console.log(`enriching episodes for ${titles.length} titles…`);

  let names = 0;
  let stills = 0;
  for (const t of titles) {
    try {
      let extra: any = {};
      try { extra = JSON.parse(t.extra ?? '{}'); } catch { /* keep {} */ }
      let malId: number | null = typeof extra.malId === 'number' ? extra.malId : null;
      if (!malId && typeof extra.anilistId === 'number') {
        malId = await idMalFromAnilist(extra.anilistId);
        await sleep(400);
      }
      if (!malId) {
        // صف CSV لم يُثرَ بعد: بحث AniList يعطي idMal مباشرة
        malId = await idMalBySearch(t.originalTitle);
        await sleep(400);
      }
      if (!malId) {
        console.log(`  ➖ ${t.originalTitle.slice(0, 40)}: no MAL id`);
        continue;
      }

      // 1) episode names (all pages, 100/page)
      const epNames = new Map<number, string>();
      for (let page = 1; page <= 10; page += 1) {
        const j = await getJson(`${JIKAN}/anime/${malId}/episodes?page=${page}`);
        const rows: any[] = j?.data ?? [];
        if (!rows.length) break;
        for (const e of rows) {
          const n = Number(e?.mal_id);
          const name = (e?.title_romanji || e?.title || '').trim();
          if (Number.isFinite(n) && name && !/^(episode\s*\d*)?$/i.test(name)) epNames.set(n, name);
        }
        if (!j?.pagination?.has_next_page) break;
        await sleep(400);
      }

      // 2) recent-episode thumbnails
      const epImgs = new Map<number, string>();
      const v = await getJson(`${JIKAN}/anime/${malId}/videos`);
      for (const e of v?.data?.episodes ?? []) {
        const n = epNum(e?.episode ?? '');
        const img = e?.images?.jpg?.image_url;
        if (n && img) epImgs.set(n, img);
      }

      // 3) apply: names only over generic/missing, stills only over fallback
      for (const s of t.seasons) {
        for (const e of s.episodes) {
          const patch: { name?: string; stillUrl?: string } = {};
          if ((!e.name || GENERIC_EP.test(e.name)) && epNames.get(e.number)) {
            patch.name = epNames.get(e.number)!;
          }
          const isFallback = !e.stillUrl || e.stillUrl === t.posterUrl;
          if (isFallback && epImgs.get(e.number)) patch.stillUrl = epImgs.get(e.number)!;
          if (Object.keys(patch).length) {
            await prisma.episode.update({ where: { id: e.id }, data: patch });
            if (patch.name) names += 1;
            if (patch.stillUrl) stills += 1;
          }
        }
      }
      // remember MAL id for next runs
      if (!extra.malId) {
        await prisma.title.update({
          where: { id: t.id },
          data: { extra: JSON.stringify({ ...extra, malId }) },
        });
      }
      console.log(`  ✅ ${t.originalTitle.slice(0, 40)} ← MAL ${malId} (names=${epNames.size} imgs=${epImgs.size})`);
    } catch (e) {
      console.log(`  ⚠️ ${t.originalTitle.slice(0, 40)}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(SLEEP_MS);
  }
  console.log(`done: episode names filled=${names} stills upgraded=${stills}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('enrich-eps failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
