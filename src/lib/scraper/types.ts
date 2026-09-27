/**
 * The single contract every source must satisfy.
 *
 * A provider only has to answer two questions:
 *   1. "what exists on you?"  -> discover()
 *   2. "tell me about this"   -> fetchDetail()
 *
 * Everything else (retry, rate limiting, caching, dedupe, DB writes) is handled
 * by the engine, so a new source is usually one file of selectors.
 */

import type { RateLimiter } from './core/rate-limiter';

export type TitleKind = 'MOVIE' | 'SERIES' | 'ANIME' | 'DOCUMENTARY';

export interface ProviderContext {
  /** extra headers for this specific request */
  headers?: Record<string, string>;
  /** abort the whole run (e.g. a cancel was requested) */
  signal?: AbortSignal;
  /** dry run: return data but never write it */
  dryRun?: boolean;
  /**
   * Token bucket sized to the provider's declared budget. Providers MUST pass
   * this to every fetchJson/fetchText call, otherwise one strict origin will
   * 429 itself mid-run.
   */
  limiter?: RateLimiter;
  logger: ScraperLogger;
}

export interface ScraperLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

/** A cheap listing entry, enough to decide whether it is worth a detail fetch. */
export interface DiscoveredItem {
  providerId: string;
  url: string;
  title: string;
  kind: TitleKind;
  year?: number;
  posterUrl?: string;
  /** rank/score on the origin site, 1..10 — used to order the home page */
  rank?: number;
}

export interface DiscoveredPage {
  items: DiscoveredItem[];
  /** pass-through so discover() can walk a catalogue page by page */
  cursor?: string;
  /** stop conditions the engine should honour */
  hasMore?: boolean;
}

export interface CastMember {
  name: string;
  character?: string;
  imageUrl?: string;
}

export interface Genre {
  name: string;
  slug?: string;
}

export interface StreamLink {
  providerId: string;
  url: string;
  /** absolute direct stream when the provider exposes one */
  streamUrl?: string;
  kind: 'hls' | 'mp4' | 'iframe' | 'dash' | 'unknown';
  quality?: string;
  language?: string;
  /** extra HTTP headers required to play this link */
  headers?: Record<string, string>;
}

export interface SeasonDetail {
  number: number;
  name?: string;
  overview?: string;
  posterUrl?: string;
  airDate?: string;
  episodes: EpisodeDetail[];
}

export interface EpisodeDetail {
  number: number;
  name?: string;
  overview?: string;
  stillUrl?: string;
  runtime?: number;
  airDate?: string;
  streams: StreamLink[];
}

export interface TitleDetail {
  providerId: string;
  url: string;
  kind: TitleKind;
  originalTitle: string;
  titleAr?: string;
  titleEn?: string;
  overview?: string;
  tagline?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  runtimeMin?: number;
  showStatus?: string;
  rating?: number;
  votesCount?: number;
  genres: Genre[];
  cast: CastMember[];
  studios: Genre[];
  countries?: { code: string; name: string }[];
  isOngoing?: boolean;
  totalSeasons?: number;
  totalEpisodes?: number;
  nextEpisodeAt?: string;
  seasons?: SeasonDetail[];
  /** the playable link for a MOVIE (seasons are used for everything else) */
  movieStreams?: StreamLink[];
  /** anything source-specific worth keeping */
  extra?: Record<string, unknown>;
}

export interface Provider {
  key: string;
  name: string;
  kind: 'api' | 'html' | 'rss';
  baseUrl: string;
  /** lower runs first */
  priority: number;
  /**
   * The budget this origin actually allows. The engine builds a token bucket
   * from it, so a strict API like AniList is not crawled at the speed a CDN-backed
   * HTML source could take. Slightly pessimistic values are deliberate.
   */
  rateLimit?: { requestsPerSecond: number; burst?: number };
  /**
   * Hard ceiling on in-flight requests, applied on top of `rateLimit`. Some
   * origins answer 504 when hit in parallel rather than 429, so a rate limit
   * alone is not enough — they need their requests serialised.
   */
  maxConcurrency?: number;
  /** list catalogue pages; `cursor` is opaque to the engine */
  discover(ctx: ProviderContext, opts: DiscoverOptions): Promise<DiscoveredPage>;
  /**
   * Full record for one item.
   *
   * `url` is only meaningful for `html` providers — an API provider addresses
   * its items by id alone, so it may legitimately ignore this argument. That is
   * what lets `--ids` re-fetch a single record without walking a catalogue.
   */
  fetchDetail(ctx: ProviderContext, providerId: string, url?: string): Promise<TitleDetail | null>;
  /** search, when the source supports it. Engine falls back to local DB search. */
  search?(ctx: ProviderContext, query: string): Promise<DiscoveredItem[]>;
  /** true when the source can be used without an API key */
  isConfigured(): boolean;
}

export interface DiscoverOptions {
  /** how many listing pages to walk this run */
  maxPages: number;
  /** opaque pagination token returned by the previous discover() call */
  cursor?: string;
  /** optional narrowing */
  kind?: TitleKind;
  /** provider-specific page size hint */
  pageSize?: number;
}
