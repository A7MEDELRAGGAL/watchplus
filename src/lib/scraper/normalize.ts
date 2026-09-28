import { isArabic, slugify } from './core/html';
import type { CastMember, Genre, TitleDetail, TitleKind } from './types';

/**
 * Converts a provider's raw output into the exact shape the `Title` table wants,
 * and derives the values the UI depends on (slug, search blob, duration sums).
 *
 * Kept separate from the providers so a new source never has to think about
 * slugs or search indexing.
 */

export interface NormalizedTitle {
  key: string;
  type: TitleKind;
  slug: string;
  originalTitle: string;
  titleAr: string | null;
  titleEn: string | null;
  overview: string | null;
  tagline: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  sourceUrl: string;
  releaseDate: Date | null;
  releaseYear: number | null;
  runtimeMin: number | null;
  showStatus: string | null;
  cast: CastMember[] | null;
  genres: Genre[] | null;
  studios: Genre[] | null;
  countries: CountryTag[] | null;
  extra: Record<string, unknown> | null;
  rating: number | null;
  votesCount: number | null;
  /** non-null: the column defaults to 0 and a missing rank is simply 0 */
  popularity: number;
  totalSeasons: number | null;
  totalEpisodes: number | null;
  latestEpisode: number | null;
  nextEpisodeAt: Date | null;
  isOngoing: boolean;
  siteRank: number | null;
  searchBlob: string;
  seasons: NormalizedSeason[];
  movieStreams: NormalizedStream[];
}

interface CountryTag {
  code: string;
  name: string;
}

export interface NormalizedSeason {
  number: number;
  name: string | null;
  overview: string | null;
  posterUrl: string | null;
  airDate: Date | null;
  episodes: NormalizedEpisode[];
}

export interface NormalizedEpisode {
  number: number;
  name: string | null;
  overview: string | null;
  stillUrl: string | null;
  runtime: number | null;
  airDate: Date | null;
  durationS: number | null;
  streams: NormalizedStream[];
}

export interface NormalizedStream {
  providerId: string;
  provider: string;
  url: string;
  streamUrl: string | null;
  kind: string;
  /** human label for this mirror as the origin names it */
  name: string | null;
  quality: string | null;
  language: string;
  headers: Record<string, string> | null;
}

export function normalize(
  detail: TitleDetail,
  providerKey: string,
  opts: { rank?: number } = {},
): NormalizedTitle {
  const originalTitle = (detail.originalTitle || '').trim() || 'Untitled';
  const { slug } = buildSlug(detail, originalTitle, providerKey);

  const seasons = (detail.seasons ?? [])
    .map((s) => normalizeSeason(s))
    .filter((s) => s.number > 0)
    .sort((a, b) => a.number - b.number);

  const allEpisodes = seasons.flatMap((s) => s.episodes);
  const latestEpisode = allEpisodes.length
    ? Math.max(...allEpisodes.map((e) => e.number))
    : null;

  const releaseDate = toDate(detail.releaseDate);

  return {
    key: `${providerKey}:${detail.providerId}`,
    type: detail.kind,
    slug,
    originalTitle,
    titleAr: detail.titleAr ?? (isArabic(originalTitle) ? originalTitle : null),
    titleEn: detail.titleEn ?? (isArabic(originalTitle) ? null : originalTitle),
    overview: detail.overview?.trim() || null,
    tagline: detail.tagline?.trim() || null,
    posterUrl: detail.posterUrl || null,
    backdropUrl: detail.backdropUrl || null,
    sourceUrl: detail.url,
    releaseDate,
    releaseYear: releaseDate ? releaseDate.getUTCFullYear() : null,
    runtimeMin: detail.runtimeMin ?? null,
    showStatus: detail.showStatus ?? null,
    cast: detail.cast.length ? detail.cast : null,
    genres: detail.genres.length ? detail.genres : null,
    studios: detail.studios.length ? detail.studios : null,
    countries: detail.countries?.length ? detail.countries : null,
    extra: detail.extra ?? null,
    rating: typeof detail.rating === 'number' ? clamp(detail.rating, 0, 10) : null,
    votesCount: detail.votesCount ?? null,
    popularity: opts.rank ?? 0,
    totalSeasons: detail.totalSeasons ?? (seasons.length || null),
    totalEpisodes: detail.totalEpisodes ?? (allEpisodes.length || null),
    latestEpisode,
    nextEpisodeAt: toDate(detail.nextEpisodeAt),
    isOngoing: Boolean(detail.isOngoing),
    siteRank: opts.rank ?? null,
    searchBlob: buildSearchBlob(detail, originalTitle),
    seasons,
    movieStreams: (detail.movieStreams ?? []).map((s) => normalizeStream(s, providerKey)),
  };
}

function normalizeSeason(s: import('./types').SeasonDetail): NormalizedSeason {
  const episodes = (s.episodes ?? [])
    .map((e) => normalizeEpisode(e))
    .filter((e) => e.number > 0)
    .sort((a, b) => a.number - b.number);

  return {
    number: s.number,
    name: s.name ?? null,
    overview: s.overview ?? null,
    posterUrl: s.posterUrl ?? null,
    airDate: toDate(s.airDate),
    episodes,
  };
}

function normalizeEpisode(e: import('./types').EpisodeDetail): NormalizedEpisode {
  const durationS = e.runtime ? e.runtime * 60 : null;
  return {
    number: e.number,
    name: e.name ?? null,
    overview: e.overview ?? null,
    stillUrl: e.stillUrl ?? null,
    runtime: e.runtime ?? null,
    airDate: toDate(e.airDate),
    durationS,
    streams: (e.streams ?? []).map((s) => normalizeStream(s, '')),
  };
}

function normalizeStream(s: import('./types').StreamLink, fallbackProvider: string): NormalizedStream {
  return {
    providerId: s.providerId,
    provider: fallbackProvider || s.providerId.split(':')[0] || 'unknown',
    url: s.url,
    streamUrl: s.streamUrl ?? null,
    kind: s.kind,
    name: s.name?.trim() || null,
    quality: s.quality ?? null,
    language: s.language ?? 'ar',
    headers: s.headers ?? null,
  };
}
/**
 * Slug must be unique across the whole table, and ids are only unique *within* a
 * provider: AniList anime 21 and MAL anime 21 are different shows. So the slug
 * is namespaced by a short hash of `provider:providerId` — a fixed 5-char suffix
 * that no two different sources can realistically agree on.
 *
 * The readable title is kept even when the provider id is numeric. A previous
 * version special-cased numeric ids into `anime-anilist-103303`, which is unique
 * but unreadable, and it hit every AniList and Jikan row — the two providers that
 * matter most. Titles carry accents and CJK; the hash handles the guarantee that
 * the id used to provide.
 *
 * If two hashes ever did collide, `claimSlug` in the upsert appends `-2`. The
 * slug is also only ever assigned on create, so URLs stay stable across re-runs.
 */
export function buildSlug(detail: TitleDetail, title: string, providerKey: string): { slug: string } {
  const base = slugify(title) || slugify(detail.titleEn ?? '') || 'title';
  return { slug: `${base}-${shortHash(`${providerKey}:${detail.providerId}`)}` };
}

function buildSearchBlob(detail: TitleDetail, title: string): string {
  const parts = [
    title,
    detail.titleAr ?? '',
    detail.titleEn ?? '',
    detail.overview ?? '',
    detail.showStatus ?? '',
    ...detail.genres.map((g) => g.name),
    ...detail.studios.map((s) => s.name),
    ...detail.cast.map((c) => c.name),
  ];
  return parts
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 5);
}

function toDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
