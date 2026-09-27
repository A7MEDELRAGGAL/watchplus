import { fetchJson } from '../core/http';
import type {
  DiscoveredItem,
  DiscoveredPage,
  Genre,
  Provider,
  ProviderContext,
  TitleDetail,
  TitleKind,
} from '../types';

/**
 * TMDB — the reference catalogue for movies, series and documentaries.
 * Free API key, generous rate limits, stable JSON.
 *
 * Docs: https://developer.themoviedb.org/docs
 */

const BASE = process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3';
const KEY = process.env.TMDB_API_KEY ?? '';
const LANG = process.env.TMDB_LANGUAGE ?? 'en-US';
const IMG = process.env.TMDB_IMAGE_BASE_URL ?? 'https://image.tmdb.org/t/p';

/** How many listings to grab per page. */
const PAGE_SIZE = 40;

const KINDS: { kind: TitleKind; list: string; detail: string; with: string }[] = [
  { kind: 'MOVIE', list: 'trending/movie/day', detail: 'movie', with: 'credits,images' },
  { kind: 'MOVIE', list: 'movie/popular', detail: 'movie', with: 'credits,images' },
  { kind: 'SERIES', list: 'trending/tv/day', detail: 'tv', with: 'credits,images' },
  { kind: 'SERIES', list: 'tv/popular', detail: 'tv', with: 'credits,images' },
  { kind: 'DOCUMENTARY', list: 'discover/movie', detail: 'movie', with: 'credits,images' },
];

function img(path: string | null | undefined, size = 'w500'): string | undefined {
  if (!path) return undefined;
  return `${IMG}/${size}${path}`;
}

interface TmdbListResponse {
  page: number;
  total_pages: number;
  results: TmdbItem[];
}

interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  tagline?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  media_type?: string;
}

interface TmdbDetailResponse {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  tagline?: string;
  homepage?: string;
  status?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string;
  next_episode_to_air?: { air_date?: string };
  episode_run_time?: number[];
  runtime?: number;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  in_production?: boolean;
  genres?: { id: number; name: string }[];
  production_companies?: { id: number; name: string }[];
  origin_country?: string[];
  credits?: {
    cast?: {
      name: string;
      character?: string;
      profile_path?: string | null;
      order?: number;
    }[];
  };
  seasons?: {
    id: number;
    season_number: number;
    name?: string;
    overview?: string;
    poster_path?: string | null;
    air_date?: string;
    episode_count?: number;
    episodes?: TmdbEpisode[];
  }[];
  external_ids?: { imdb_id?: string; tvdb_id?: number; [k: string]: unknown };
}

interface TmdbEpisode {
  episode_number: number;
  name?: string;
  overview?: string;
  still_path?: string | null;
  air_date?: string;
  runtime?: number;
  vote_average?: number;
}

export const tmdbProvider: Provider = {
  key: 'tmdb',
  name: 'TMDB',
  kind: 'api',
  baseUrl: BASE,
  priority: 10,
  // TMDB is far more permissive than the anime APIs.
  rateLimit: { requestsPerSecond: 5, burst: 5 },

  isConfigured() {
    return KEY.trim().length > 0;
  },

  async discover(ctx: ProviderContext, opts): Promise<DiscoveredPage> {
    const { cursor, maxPages } = opts;
    // cursor encodes "<listIndex>:<page>"
    const [listIndexRaw, pageRaw] = (cursor ?? '0:1').split(':');
    const listIndex = Number(listIndexRaw) || 0;
    const page = Number(pageRaw) || 1;

    if (listIndex >= KINDS.length) return { items: [], hasMore: false };

    const entry = KINDS[listIndex];
    const url = new URL(`${BASE}/${entry.list}`);
    url.searchParams.set('language', LANG);
    url.searchParams.set('page', String(page));
    if (entry.kind === 'DOCUMENTARY') {
      url.searchParams.set('with_genres', '99'); // Documentary genre id on TMDB
      url.searchParams.set('sort_by', 'popularity.desc');
    }

    const data = await fetchJson<TmdbListResponse>(url.toString(), { signal: ctx.signal, limiter: ctx.limiter });

    const items: DiscoveredItem[] = (data.results ?? [])
      .filter((r) => r.media_type !== 'person')
      .map((r) => toItem(r, entry.kind));

    const nextList = page < data.total_pages ? listIndex : listIndex + 1;
    const nextPage = page < data.total_pages ? page + 1 : 1;
    const hasMore = nextList < KINDS.length && page < maxPages;

    return {
      items,
      cursor: hasMore ? `${nextList}:${nextPage}` : undefined,
      hasMore,
    };
  },

  async fetchDetail(ctx: ProviderContext, providerId: string): Promise<TitleDetail | null> {
    // ids are self-describing ("movie:550" / "tv:1399") so a single provider can
    // serve both media types and a targeted --ids re-fetch needs no catalogue walk
    const [kind, rawId] = providerId.includes(':')
      ? [providerId.split(':')[0], providerId.split(':')[1]]
      : ['movie', providerId];
    const endpoint = kind === 'tv' ? 'tv' : 'movie';
    const id = rawId ?? providerId;

    const detailUrl = new URL(`${BASE}/${endpoint}/${id}`);
    detailUrl.searchParams.set('language', LANG);
    detailUrl.searchParams.set('append_to_response', 'credits,external_ids');

    const d = await fetchJson<TmdbDetailResponse>(detailUrl.toString(), { signal: ctx.signal, limiter: ctx.limiter });
    if (!d?.id) return null;

    const isMovie = endpoint === 'movie';

    const genres: Genre[] = (d.genres ?? []).map((g) => ({ name: g.name, slug: slug(g.name) }));
    const studios: Genre[] = (d.production_companies ?? []).map((c) => ({ name: c.name }));

    const cast = (d.credits?.cast ?? [])
      .slice(0, 20)
      .map((c) => ({
        name: c.name,
        character: c.character,
        imageUrl: img(c.profile_path, 'w185'),
      }));

    const seasons = (d.seasons ?? [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({
        number: s.season_number,
        name: s.name,
        overview: s.overview,
        posterUrl: img(s.poster_path, 'w342'),
        airDate: s.air_date,
        episodes: (s.episodes ?? []).map((e) => ({
          number: e.episode_number,
          name: e.name,
          overview: e.overview,
          stillUrl: img(e.still_path, 'w300'),
          runtime: e.runtime,
          airDate: e.air_date,
          // TMDB carries no playable links; the player shows "not available yet"
          streams: [],
        })),
      }));

    const runtime = d.runtime ?? d.episode_run_time?.[0];

    return {
      providerId: `${endpoint}:${d.id}`,
      url: `https://www.themoviedb.org/${endpoint}/${d.id}`,
      kind: isMovie ? 'MOVIE' : 'SERIES',
      originalTitle: d.original_title ?? d.original_name ?? d.title ?? d.name ?? 'Untitled',
      titleEn: d.title ?? d.name,
      overview: d.overview,
      tagline: d.tagline,
      posterUrl: img(d.poster_path, 'w500'),
      backdropUrl: img(d.backdrop_path, 'w1280'),
      releaseDate: d.release_date ?? d.first_air_date,
      runtimeMin: runtime,
      showStatus: d.status,
      rating: d.vote_average,
      votesCount: d.vote_count,
      genres,
      cast,
      studios,
      countries: (d.origin_country ?? []).map((code) => ({ code, name: code })),
      isOngoing: d.in_production ?? false,
      totalSeasons: d.number_of_seasons,
      totalEpisodes: d.number_of_episodes,
      nextEpisodeAt: d.next_episode_to_air?.air_date,
      seasons,
      movieStreams: [],
      extra: {
        imdbId: d.external_ids?.imdb_id,
        popularity: d.popularity,
        lastAirDate: d.last_air_date,
      },
    };
  },

  async search(ctx: ProviderContext, query: string): Promise<DiscoveredItem[]> {
    const url = new URL(`${BASE}/search/multi`);
    url.searchParams.set('query', query);
    url.searchParams.set('language', LANG);
    url.searchParams.set('include_adult', 'false');

    const data = await fetchJson<{ results: TmdbItem[] }>(url.toString(), { signal: ctx.signal, limiter: ctx.limiter });
    return (data.results ?? [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => toItem(r, r.media_type === 'movie' ? 'MOVIE' : 'SERIES'));
  },
};

function toItem(r: TmdbItem, kind: TitleKind): DiscoveredItem {
  const title = r.title ?? r.name ?? r.original_title ?? r.original_name ?? 'Untitled';
  const date = r.release_date ?? r.first_air_date ?? '';
  const endpoint = kind === 'MOVIE' || kind === 'DOCUMENTARY' ? 'movie' : 'tv';
  return {
    providerId: `${endpoint}:${r.id}`,
    url: `https://www.themoviedb.org/${endpoint}/${r.id}`,
    title,
    kind,
    year: date ? Number(date.slice(0, 4)) : undefined,
    posterUrl: img(r.poster_path, 'w342'),
    rank: r.popularity,
  };
}

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
