import { fetchJson } from '../core/http';
import type {
  DiscoveredItem,
  DiscoveredPage,
  Genre,
  Provider,
  ProviderContext,
  TitleDetail,
} from '../types';

/**
 * Jikan — unofficial MyAnimeList REST API. Free, no key.
 *
 * Worth running alongside AniList: MAL carries synopsis, MAL score, studios and
 * characters, so a title imported by both providers has two independent sources
 * of truth, and the dedupe step can confirm a match.
 *
 * Docs: https://jikan.moe
 */

const BASE = process.env.JIKAN_BASE_URL ?? 'https://api.jikan.moe/v4';
/**
 * Jikan allows ~3 req/s and 60 req/min. It answers 429 readily, so this provider
 * leans on the engine's retry/backoff rather than its own limiter.
 */
const RATE_LIMIT_HINT_MS = 1_200;

/** Jikan returns both jpg and webp variants; jpg is the safe default. */
interface JikanImages {
  image_url?: string;
  small_image_url?: string;
  large_image_url?: string;
}

interface JikanList<T> {
  data: T[];
  pagination?: { has_next_page?: boolean; page?: number };
}

interface JikanAnime {
  mal_id: number;
  url?: string;
  images?: { jpg?: JikanImages; webp?: JikanImages } | null;
  titles?: { type: string; title: string }[];
  title?: string;
  type?: string | null;
  episodes?: number | null;
  status?: string | null;
  score?: number | null;
  scored_by?: number | null;
  popularity?: number | null;
  members?: number | null;
  synopsis?: string | null;
  year?: number | null;
  season?: string | null;
  duration?: string | null;
  genres?: { mal_id: number; name: string }[];
  studios?: { mal_id: number; name: string }[] | null;
  aired?: { from?: string | null; to?: string | null } | null;
  trailer?: { embed_url?: string | null; url?: string | null } | null;
  trailers?: { embed_url?: string | null; url?: string | null; url_name?: string | null }[];
  streaming?: { name?: string; url?: string }[];
  background?: string | null;
}

interface JikanFull extends JikanAnime {
  title_english?: string | null;
  title_japanese?: string | null;
  aired_prop?: { from?: string | null } | null;
  duration_minutes?: number | null;
  characters?: { character?: { name: string; images?: { jpg?: JikanImages } | null } }[] | null;
  relations?: { entry?: number; name: string; type: string }[] | null;
}

function poster(a: JikanAnime): string | undefined {
  const jpg = a.images?.jpg?.large_image_url ?? a.images?.jpg?.image_url;
  const webp = a.images?.webp?.large_image_url ?? a.images?.webp?.image_url;
  return jpg ?? webp ?? undefined;
}

function bestTitle(a: JikanAnime): string {
  const titles = a.titles ?? [];
  return (
    titles.find((t) => t.type === 'English')?.title ??
    titles.find((t) => t.type === 'Default')?.title ??
    a.title ??
    'Untitled'
  );
}

function arabicTitle(a: JikanFull | JikanAnime): string | undefined {
  const titles = a.titles ?? [];
  const arabic = /[\u0600-\u06FF]/;
  const hit = titles.find((t) => arabic.test(t.title));
  return hit?.title;
}

function minutes(duration?: string | null, fallback = 24): number {
  if (!duration) return fallback;
  const h = /(\d+)\s*hr/.exec(duration);
  const m = /(\d+)\s*min/.exec(duration);
  if (h || m) return Number(h?.[1] ?? 0) * 60 + Number(m?.[1] ?? 0);
  const per = /per\s+(\d+)\s*ep/i.exec(duration);
  if (per) return Number(per[1]);
  return fallback;
}

export const jikanProvider: Provider = {
  key: 'jikan',
  name: 'Jikan (MyAnimeList)',
  kind: 'api',
  baseUrl: BASE,
  priority: 20,
  // Jikan allows ~3 req/s and 60 req/min but 429s readily. Stay well under.
  rateLimit: { requestsPerSecond: 0.8, burst: 2 },
  // Keep it to two in flight: past that it starts shedding load.
  maxConcurrency: 2,

  isConfigured() {
    return true;
  },

  async discover(ctx, opts): Promise<DiscoveredPage> {
    const page = Number(opts.cursor ?? 1) || 1;
    // cycle the four useful orderings so the catalogue stays varied
    const endpoint = page % 4 === 1 ? 'top/anime' : page % 4 === 2 ? 'top/airing' : page % 4 === 3 ? 'top/upcoming' : 'genres/1/full';

    const data = await fetchJson<JikanList<JikanAnime>>(`${BASE}/${endpoint}?page=${page}&limit=25`, {
      signal: ctx.signal,
      limiter: ctx.limiter,
      retries: 4,
      backoffBaseMs: RATE_LIMIT_HINT_MS,
    });

    const items: DiscoveredItem[] = (data.data ?? [])
      .filter((a) => (a.episodes ?? 0) > 0 || a.type === 'Movie')
      .map((a) => toItem(a));

    return {
      items,
      cursor: String(page + 1),
      hasMore: (data.pagination?.has_next_page ?? true) && page < opts.maxPages,
    };
  },

  async fetchDetail(ctx, providerId): Promise<TitleDetail | null> {
    // Deliberately not `/anime/{id}/full`: that endpoint 504s constantly under
    // load. The plain resource has everything except characters/external links,
    // and AniList is the better cast source anyway.
    const a = await fetchJson<{ data: JikanFull }>(`${BASE}/anime/${providerId}`, {
      signal: ctx.signal,
      limiter: ctx.limiter,
      retries: 4,
      backoffBaseMs: RATE_LIMIT_HINT_MS,
    });
    if (!a?.data?.mal_id) return null;
    const d = a.data;

    const genres: Genre[] = (d.genres ?? []).map((g) => ({ name: g.name, slug: slugify(g.name) }));
    const studios = (d.studios ?? []).map((s) => ({ name: s.name, slug: slugify(s.name) }));

    const cast = (d.characters ?? [])
      .slice(0, 16)
      .map((c) => ({
        name: c.character?.name ?? '',
        imageUrl: c.character?.images?.jpg?.image_url,
      }))
      .filter((c) => c.name);

    const trailerUrl = d.trailer?.embed_url ?? d.trailer?.url ?? d.trailers?.[0]?.embed_url ?? undefined;

    const episodes = d.episodes ?? 0;
    const dur = d.duration_minutes ?? minutes(d.duration);

    const isOngoing = d.status === 'Currently Airing';

    return {
      providerId: String(d.mal_id),
      url: d.url ?? `https://myanimelist.net/anime/${d.mal_id}`,
      kind: d.type === 'Movie' ? 'MOVIE' : 'ANIME',
      originalTitle: bestTitle(d),
      titleEn: d.title_english ?? undefined,
      titleAr: arabicTitle(d),
      overview: d.synopsis ?? d.background ?? undefined,
      tagline: d.season ? `${d.season} ${d.year ?? ''}`.trim() : undefined,
      posterUrl: poster(d),
      backdropUrl: undefined,
      releaseDate: d.aired?.from ?? d.aired_prop?.from ?? (d.year ? `${d.year}-01-01` : undefined),
      runtimeMin: dur,
      showStatus: d.status ?? undefined,
      rating: d.score ?? undefined,
      votesCount: d.scored_by ?? undefined,
      genres,
      cast,
      studios,
      isOngoing,
      totalSeasons: 1,
      totalEpisodes: episodes,
      seasons: episodes
        ? [
            {
              number: 1,
              name: 'All episodes',
              overview: d.synopsis ?? undefined,
              posterUrl: poster(d),
              airDate: d.aired?.from ?? undefined,
              episodes: Array.from({ length: Math.min(episodes, 2000) }, (_, i) => ({
                number: i + 1,
                name: `Episode ${i + 1}`,
                runtime: dur,
                streams: [],
              })),
            },
          ]
        : [],
      movieStreams: [],
      extra: {
        trailer: trailerUrl,
        members: d.members,
        popularity: d.popularity,
        relations: d.relations ?? undefined,
        // Where MAL says it legally streams, so the UI can link out rather than
        // only ever pointing at a scraper source.
        officialStreaming: (d.streaming ?? []).map((s) => ({ name: s.name, url: s.url })),
      },
    };
  },

  async search(ctx, query): Promise<DiscoveredItem[]> {
    const data = await fetchJson<JikanList<JikanAnime>>(
      `${BASE}/anime?q=${encodeURIComponent(query)}&limit=20`,
      { signal: ctx.signal, limiter: ctx.limiter, retries: 4, backoffBaseMs: RATE_LIMIT_HINT_MS },
    );
    return (data.data ?? []).map((a) => toItem(a));
  },
};

function toItem(a: JikanAnime): DiscoveredItem {
  return {
    providerId: String(a.mal_id),
    url: a.url ?? `https://myanimelist.net/anime/${a.mal_id}`,
    title: bestTitle(a),
    kind: a.type === 'Movie' ? 'MOVIE' : 'ANIME',
    year: a.year ?? undefined,
    posterUrl: poster(a),
    rank: a.popularity ?? a.members ?? undefined,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
