import { z } from 'zod';
import {
  absolute,
  asNumber,
  asString,
  attr,
  clean,
  detectStream,
  extractDate,
  extractRuntime,
  extractYear,
  imageSrc,
  jsonLd,
  load,
  pickJsonLd,
  slugify,
  text,
  textAll,
  type Doc,
  type Node,
} from '../core/html';
import { fetchText, NAVIGATION_HEADERS } from '../core/http';
import { crawlDelay, isAllowed } from '../core/robots';
import { sleep } from '../core/rate-limiter';
import type {
  CastMember,
  DiscoveredItem,
  DiscoveredPage,
  EpisodeDetail,
  Genre,
  Provider,
  ProviderContext,
  SeasonDetail,
  StreamLink,
  TitleDetail,
} from '../types';

/**
 * Config-driven HTML scraper.
 *
 * Point it at any site with a list of CSS selectors and it becomes a first-class
 * provider. Nothing here is hardcoded to a single origin — this is the file you
 * edit when you name the site you want scraped.
 *
 * Every selector is optional. Whatever you leave blank falls back to JSON-LD,
 * which nearly every modern movie site embeds, so a usable config is often just
 * `{ list: { url, item } }`.
 */

// ── schema ───────────────────────────────────────────────────────────────────

/** Where to read one field. `attr` pulls an attribute, otherwise element text. */
const FieldSchema = z.object({
  selector: z.string().optional(),
  attr: z.string().optional(),
  /** regex with one capture group, applied to the extracted value */
  regex: z.string().optional(),
  index: z.number().int().optional(),
});

export type FieldConfig = z.infer<typeof FieldSchema>;

const ListConfigSchema = z.object({
  /** template url; `{page}` `{start}` `{query}` are substituted */
  url: z.string(),
  /** container element for one catalogue entry */
  item: z.string(),
  title: FieldSchema.optional(),
  urlField: z.object({ selector: z.string().optional(), attr: z.string().default('href') }).default({}),
  year: FieldSchema.optional(),
  poster: FieldSchema.optional(),
  /** selector for an element carrying a numeric rank attribute */
  rank: z.string().optional(),
  /** a page with fewer items than this means we have hit the end */
  minItems: z.number().int().default(1),
});

const CastConfigSchema = z.object({
  item: z.string(),
  name: FieldSchema.optional(),
  character: FieldSchema.optional(),
  image: FieldSchema.optional(),
});

const StreamConfigSchema = z.object({
  /** element carrying the playable link */
  selector: z.string(),
  attr: z.string().default('href'),
  /** pull the stream out of an inline script blob instead of an attribute */
  inlinePattern: z.string().optional(),
  /** base to resolve relative hrefs against; defaults to the page url */
  base: z.string().optional(),
});

const EpisodeConfigSchema = z.object({
  /** repeated block for one episode. Omit to use `count` instead. */
  item: z.string().optional(),
  /** generate N placeholder episodes when there is no per-episode markup */
  count: z.number().int().optional(),
  season: z.number().int().default(1),
  name: FieldSchema.optional(),
  number: FieldSchema.optional(),
  overview: FieldSchema.optional(),
  image: FieldSchema.optional(),
  date: FieldSchema.optional(),
  runtime: FieldSchema.optional(),
  quality: FieldSchema.optional(),
  stream: StreamConfigSchema.optional(),
  /** several sources per episode: qualities, mirrors, languages */
  streams: z.array(StreamConfigSchema).default([]),
});

const DetailConfigSchema = z.object({
  title: FieldSchema.optional(),
  titleAr: FieldSchema.optional(),
  overview: FieldSchema.optional(),
  tagline: FieldSchema.optional(),
  poster: FieldSchema.optional(),
  backdrop: FieldSchema.optional(),
  date: FieldSchema.optional(),
  runtime: FieldSchema.optional(),
  rating: FieldSchema.optional(),
  status: FieldSchema.optional(),
  /** one CSS selector that matches every genre chip */
  genres: z.string().optional(),
  cast: z.array(CastConfigSchema).default([]),
});

export const SourceConfigSchema = z.object({
  id: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'id must be lowercase letters, digits and dashes'),
  name: z.string().min(2),
  baseUrl: z.string().url(),
  type: z.enum(['MOVIE', 'SERIES', 'ANIME', 'DOCUMENTARY']).default('MOVIE'),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
  /** headers this origin insists on (referer, origin, custom tokens) */
  headers: z.record(z.string()).default({}),
  /** cookie string, e.g. "cf_clearance=..." */
  cookies: z.string().optional(),
  list: ListConfigSchema.optional(),
  detail: DetailConfigSchema.default({}),
  episodes: z.array(EpisodeConfigSchema).default([]),
  /** free-form note shown in the admin panel */
  note: z.string().optional(),
  /** set only when you own the site and want its robots.txt ignored */
  ignoreRobots: z.boolean().default(false),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

// ── config loading ───────────────────────────────────────────────────────────

/**
 * Lazy requires for the config-file loader. The scraper runs under tsx (CLI)
 * and inside the Next.js server, both of which have `fs`/`path` available, but
 * a lazy require keeps this module importable from edge-style bundles that do not.
 */
function requireFs(): typeof import('fs') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('fs') as typeof import('fs');
}

function requirePath(): typeof import('path') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('path') as typeof import('path');
}

/**
 * Sources are declared in `sources.config.json` at the repo root, and/or inline
 * in the SOURCES_JSON env var (handy on Vercel, where there is no file to edit).
 * Both are read; the file comes first so env entries can extend or override it.
 */
export function loadSourceConfigs(): SourceConfig[] {
  const raw: unknown[] = [];

  try {
    const fs = requireFs();
    const path = requirePath();
    const file = path.join(process.cwd(), 'sources.config.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) raw.push(...parsed);
      else console.warn('[generic-css] sources.config.json must be a JSON array');
    }
  } catch (err) {
    console.warn(`[generic-css] failed to read sources.config.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  const inline = process.env.SOURCES_JSON;
  if (inline) {
    try {
      const parsed = JSON.parse(inline);
      if (Array.isArray(parsed)) raw.push(...parsed);
      else console.warn('[generic-css] SOURCES_JSON must be a JSON array');
    } catch {
      console.warn('[generic-css] SOURCES_JSON is not valid JSON — ignoring');
    }
  }

  return raw
    .map((entry) => {
      const parsed = SourceConfigSchema.safeParse(entry);
      if (parsed.success) return parsed.data;
      console.warn(
        `[generic-css] ignoring source config: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || 'root'} ${i.message}`)
          .join('; ')}`,
      );
      return null;
    })
    .filter((c): c is SourceConfig => c !== null);
}

// ── provider factory ─────────────────────────────────────────────────────────

export function createProvider(config: SourceConfig): Provider {
  return {
    key: config.id,
    name: config.name,
    kind: 'html',
    baseUrl: config.baseUrl,
    priority: config.priority,
    // HTML sources are the most tolerant kind, but still be polite.
    rateLimit: { requestsPerSecond: 1, burst: 2 },

    isConfigured: () => config.enabled !== false,

    async discover(ctx, opts): Promise<DiscoveredPage> {
      if (!config.list) return { items: [], hasMore: false };

      const page = Number(opts.cursor ?? 1) || 1;
      const url = buildListUrl(config, page);
      const html = await fetchPage(config, url, ctx);
      const $ = load(html);

      const items: DiscoveredItem[] = [];
      $(config.list.item).each((index, el) => {
        const item = parseListItem($, el as Node, config, index);
        if (item) items.push(item);
      });

      ctx.logger.info(`${url} -> ${items.length} items`);

      return {
        items,
        cursor: String(page + 1),
        hasMore: items.length >= config.list.minItems && page < opts.maxPages,
      };
    },

    async fetchDetail(ctx, providerId, url): Promise<TitleDetail | null> {
      if (!url) {
        // an HTML source addresses items by page url, so a bare id cannot be
        // resolved — the caller must have discovered it first
        ctx.logger.warn(`[${config.id}] no page url for "${providerId}"; skipping`);
        return null;
      }

      const html = await fetchPage(config, url, ctx);
      const $ = load(html);

      // JSON-LD first: far more reliable than any selector we could guess
      const structured = readJsonLd($);
      const custom = readDetailFields($, config, url);
      const seasons = readSeasons($, config, url);

      const detail: TitleDetail = {
        providerId,
        url,
        kind: config.type,
        originalTitle: custom.originalTitle ?? structured?.originalTitle ?? 'Untitled',
        titleEn: custom.titleEn,
        titleAr: custom.titleAr ?? structured?.titleAr,
        overview: custom.overview ?? structured?.overview,
        tagline: custom.tagline ?? structured?.tagline,
        posterUrl: custom.posterUrl ?? structured?.posterUrl,
        backdropUrl: custom.backdropUrl ?? structured?.backdropUrl,
        releaseDate: custom.releaseDate ?? structured?.releaseDate,
        runtimeMin: custom.runtimeMin ?? structured?.runtimeMin,
        showStatus: custom.showStatus ?? structured?.showStatus,
        rating: custom.rating ?? structured?.rating,
        votesCount: structured?.votesCount,
        genres: custom.genres?.length ? custom.genres : (structured?.genres ?? []),
        cast: custom.cast?.length ? custom.cast : (structured?.cast ?? []),
        studios: structured?.studios ?? [],
        isOngoing: /airing|ongoing|يعرض|حالي/i.test(custom.showStatus ?? ''),
        totalSeasons: seasons.length || structured?.totalSeasons,
        totalEpisodes:
          seasons.reduce((n, s) => n + s.episodes.length, 0) || structured?.totalEpisodes,
        seasons,
        movieStreams: config.type === 'MOVIE' ? readMovieStreams($, config, url) : [],
        extra: { configId: config.id, sourceNote: config.note },
      };

      if (detail.originalTitle === 'Untitled' && !seasons.length) return null;
      return detail;
    },

    async search(ctx, query): Promise<DiscoveredItem[]> {
      // Only works when the list url exposes a {query} placeholder
      if (!config.list?.url.includes('{query}')) return [];
      const url = buildListUrl(config, 1, encodeURIComponent(query));
      const html = await fetchPage(config, url, ctx);
      const $ = load(html);
      const items: DiscoveredItem[] = [];
      $(config.list.item).each((index, el) => {
        const item = parseListItem($, el as Node, config, index);
        if (item) items.push(item);
      });
      return items;
    },
  };
}

// ── urls + headers ───────────────────────────────────────────────────────────

function buildListUrl(config: SourceConfig, page: number, query?: string): string {
  const raw = config.list?.url ?? '';
  return raw
    .replace('{page}', String(page))
    .replace('{query}', query ?? '')
    .replace('{start}', String((page - 1) * 24 + 1));
}

/** Most origins check Referer; some need a cookie jar passed through env. */
function requestHeaders(config: SourceConfig): Record<string, string> {
  // HTML sources get the navigation fingerprint on purpose: they are pages, and
  // looking like a normal visit is what gets the markup back.
  const headers: Record<string, string> = {
    ...NAVIGATION_HEADERS,
    Referer: `${config.baseUrl.replace(/\/$/, '')}/`,
    ...config.headers,
  };
  if (config.cookies) headers.Cookie = config.cookies;
  return headers;
}

/**
 * Fetch a page for an HTML source, refusing URLs the origin's robots.txt
 * disallows and honouring any Crawl-delay it asks for.
 *
 * The guard is opt-out via `ignoreRobots` on the config, because some operators
 * legitimately own the site being crawled and want the file ignored. The default
 * is to obey, which is the only defensible default for a crawler running on
 * someone else's server.
 */
async function fetchPage(
  config: SourceConfig,
  url: string,
  ctx: ProviderContext,
): Promise<string> {
  if (config.ignoreRobots) {
    return fetchText(url, { signal: ctx.signal, limiter: ctx.limiter, headers: requestHeaders(config) });
  }

  if (!(await isAllowed(url))) {
    throw new Error(`robots.txt disallows ${url} — refusing to fetch`);
  }

  const delay = await crawlDelay(url);
  if (delay > 0) await sleep(delay * 1000, ctx.signal);

  return fetchText(url, { signal: ctx.signal, limiter: ctx.limiter, headers: requestHeaders(config) });
}

// ── list page ────────────────────────────────────────────────────────────────

function parseListItem(
  $: Doc,
  el: Node,
  config: SourceConfig,
  index: number,
): DiscoveredItem | null {
  const list = config.list!;

  const href = absolute(
    fieldValue($, { selector: list.urlField.selector ?? 'a', attr: list.urlField.attr }, el) ||
      attr($, 'a', 'href', el),
    config.baseUrl,
  );

  const title = clean(
    (list.title ? fieldValue($, list.title, el) : '') ||
      attr($, 'a', 'title', el) ||
      text($, 'img[alt]', el) ||
      text($, 'a', el),
  );

  if (!href || !title) return null;

  const yearBlob = list.year ? fieldValue($, list.year, el) : '';
  const rankRaw = list.rank ? attr($, list.rank, 'data-rank', el) : '';
  const posterNode = list.poster ? findFieldNode($, list.poster, el) : undefined;

  return {
    providerId: href,
    url: href,
    title,
    kind: config.type,
    year: yearBlob ? extractYear(yearBlob) : undefined,
    posterUrl: posterNode ? imageSrc($, posterNode, config.baseUrl) : undefined,
    rank: rankRaw ? Number(rankRaw) || index + 1 : index + 1,
  };
}

// ── field helpers ────────────────────────────────────────────────────────────

/**
 * Locate the element a field points at, optionally the nth match.
 *
 * `$.root()` is used for the whole-document case so the return type stays a
 * concrete Cheerio selection rather than a `Doc | Cheerio<...>` union.
 */
function findFieldNode($: Doc, field: FieldConfig, root?: Node): Node | undefined {
  const scope = root === undefined ? $.root() : $(root);
  if (!field.selector) return root;
  const found = scope.find(field.selector);
  if (!found.length) return undefined;
  const el = field.index === undefined ? found.first() : found.eq(field.index);
  return el.length ? (el.get(0) as Node) : undefined;
}

/** Extract a field's value as trimmed text, or as an attribute. */
function fieldValue($: Doc, field: FieldConfig, root?: Node): string {
  const node = findFieldNode($, field, root);
  if (!node) return '';
  const raw = field.attr ? clean($(node).attr(field.attr) ?? '') : clean($(node).text());
  if (!field.regex) return raw;
  try {
    const m = new RegExp(field.regex, 'i').exec(raw);
    return m?.[1] ?? m?.[0] ?? '';
  } catch {
    return raw;
  }
}

function fieldImage($: Doc, field: FieldConfig, base: string, root?: Node): string | undefined {
  const node = findFieldNode($, field, root);
  if (!node) return undefined;
  return imageSrc($, node, base) || undefined;
}

// ── detail page: selectors ───────────────────────────────────────────────────

interface CustomDetail {
  originalTitle?: string;
  titleEn?: string;
  titleAr?: string;
  overview?: string;
  tagline?: string;
  posterUrl?: string;
  backdropUrl?: string;
  releaseDate?: string;
  runtimeMin?: number;
  showStatus?: string;
  rating?: number;
  genres?: Genre[];
  cast?: CastMember[];
}

function readDetailFields($: Doc, config: SourceConfig, pageUrl: string): CustomDetail {
  const d = config.detail;
  const out: CustomDetail = {};

  if (d.title) out.originalTitle = fieldValue($, d.title) || undefined;
  if (d.titleAr) out.titleAr = fieldValue($, d.titleAr) || undefined;
  if (d.overview) out.overview = fieldValue($, d.overview) || undefined;
  if (d.tagline) out.tagline = fieldValue($, d.tagline) || undefined;
  if (d.poster) out.posterUrl = fieldImage($, d.poster, pageUrl);
  if (d.backdrop) out.backdropUrl = fieldImage($, d.backdrop, pageUrl);

  if (d.date) {
    const iso = extractDate(fieldValue($, d.date));
    if (iso) out.releaseDate = iso;
  }
  if (d.runtime) {
    const minutes = extractRuntime(fieldValue($, d.runtime));
    if (minutes) out.runtimeMin = minutes;
  }
  if (d.rating) {
    const value = asNumber(fieldValue($, d.rating));
    if (value !== undefined) out.rating = value > 10 ? value / 10 : value;
  }
  if (d.status) out.showStatus = fieldValue($, d.status) || undefined;

  if (d.genres) {
    const names = textAll($, d.genres);
    if (names.length) out.genres = dedupeGenres(names);
  }

  if (d.cast.length) {
    const cast: CastMember[] = [];
    for (const c of d.cast) {
      $(c.item).each((_, el) => {
        if (cast.length >= 20) return;
        const name = c.name ? fieldValue($, c.name, el as Node) : clean($(el).text());
        if (!name) return;
        cast.push({
          name,
          character: c.character ? fieldValue($, c.character, el as Node) || undefined : undefined,
          imageUrl: c.image ? imageSrc($, el as Node, pageUrl) || undefined : undefined,
        });
      });
    }
    if (cast.length) out.cast = cast;
  }

  return out;
}

// ── detail page: JSON-LD ─────────────────────────────────────────────────────

interface StructuredDetail extends CustomDetail {
  votesCount?: number;
  studios: Genre[];
  totalSeasons?: number;
  totalEpisodes?: number;
}

function readJsonLd($: Doc): StructuredDetail {
  const blocks = jsonLd($);
  if (!blocks.length) return { studios: [] };

  const ld =
    pickJsonLd(blocks, 'movie', 'tvseries', 'tvepisode', 'videoobject', 'creativework', 'webpage') ??
    blocks[0];

  const out: StructuredDetail = { studios: [] };

  const name = asString(ld.name);
  if (name) out.originalTitle = name;

  const alt = ld.alternateName;
  if (alt) {
    const arabic = (Array.isArray(alt) ? alt : [alt])
      .map(asString)
      .find((v) => v && /[\u0600-\u06FF]/.test(v));
    if (arabic) out.titleAr = arabic;
  }

  const desc = asString(ld.description);
  if (desc) out.overview = desc;

  const image = ld.image;
  const raw = Array.isArray(image) ? asString(image[0]) : asString(image);
  if (raw) {
    const resolved = raw.startsWith('http') ? raw : absolute(raw, 'https://example.com');
    if (resolved) out.posterUrl = resolved;
  }

  const datePublished = asString(ld.datePublished) ?? asString(ld.startDate);
  if (datePublished) {
    const iso = extractDate(datePublished);
    if (iso) out.releaseDate = iso;
  }

  const duration = asString(ld.duration);
  if (duration) {
    const minutes = extractRuntime(duration);
    if (minutes) out.runtimeMin = minutes;
  }

  const rating = ld.aggregateRating as Record<string, unknown> | undefined;
  if (rating) {
    const value = asNumber(rating.ratingValue);
    if (value !== undefined) out.rating = value > 10 ? value / 10 : value;
    const count = asNumber(rating.ratingCount);
    if (count !== undefined) out.votesCount = count;
  }

  const genre = ld.genre;
  if (genre) {
    const names = (Array.isArray(genre) ? genre : [genre]).map(asString).filter((g): g is string => !!g);
    if (names.length) out.genres = dedupeGenres(names);
  }

  const creator = ld.creator as Record<string, unknown> | undefined;
  const creatorName = creator ? asString(creator.name) : undefined;
  if (creatorName) out.studios = [{ name: creatorName }];

  const seasons = asNumber(ld.numberOfSeasons);
  if (seasons) out.totalSeasons = seasons;
  const episodes = asNumber(ld.numberOfEpisodes);
  if (episodes) out.totalEpisodes = episodes;

  return out;
}

// ── episodes + streams ───────────────────────────────────────────────────────

function readSeasons($: Doc, config: SourceConfig, pageUrl: string): SeasonDetail[] {
  const seasons: SeasonDetail[] = [];

  for (const spec of config.episodes) {
    const episodes: EpisodeDetail[] = [];

    if (spec.item) {
      $(spec.item).each((_, el) => {
        const node = el as Node;
        const number = spec.number
          ? Number(fieldValue($, spec.number, node)) || episodes.length + 1
          : episodes.length + 1;
        const streams = readStreams($, [spec.stream, ...spec.streams].filter(Boolean) as StreamConfigLike[], node, pageUrl);

        episodes.push({
          number,
          name: spec.name ? fieldValue($, spec.name, node) || undefined : undefined,
          overview: spec.overview ? fieldValue($, spec.overview, node) || undefined : undefined,
          stillUrl: spec.image ? fieldImage($, spec.image, pageUrl, node) : undefined,
          runtime: spec.runtime ? extractRuntime(fieldValue($, spec.runtime, node)) : undefined,
          airDate: spec.date ? extractDate(fieldValue($, spec.date, node)) : undefined,
          streams,
        });
      });
    } else if (spec.count && spec.count > 0) {
      // No per-episode markup: synthesise the episode list so the site still has
      // a complete, navigable catalogue. Streams stay empty until a source
      // exposes them.
      for (let i = 1; i <= spec.count; i++) {
        episodes.push({ number: i, streams: [] });
      }
    }

    if (episodes.length) {
      seasons.push({ number: spec.season, name: `Season ${spec.season}`, episodes });
    }
  }

  return seasons;
}

type StreamConfigLike = {
  selector: string;
  attr: string;
  inlinePattern?: string;
  base?: string;
};

function readStreams(
  $: Doc,
  specs: StreamConfigLike[],
  root: Node | undefined,
  pageUrl: string,
): StreamLink[] {
  const out: StreamLink[] = [];
  // an undefined root means "search the whole document"
  const scope = root === undefined ? $.root() : $(root);

  for (const spec of specs) {
    scope.find(spec.selector).each((_, el) => {
      const node = $(el);
      let raw = clean(node.attr(spec.attr) ?? '');

      if (spec.inlinePattern) {
        // some players keep the real url inside a data-* or inline script blob
        const blob = [
          node.attr('data-config'),
          node.attr('data-options'),
          node.attr('data-episode'),
          node.closest('div,section,li').attr('data-episode') ?? '',
        ]
          .filter(Boolean)
          .join(' ');
        if (blob) {
          try {
            const m = new RegExp(spec.inlinePattern, 'i').exec(blob);
            if (m?.[1]) raw = clean(m[1]);
          } catch {
            // a bad pattern in the config should not break the whole page
          }
        }
      }

      if (!raw) return;
      const link = detectStream(raw, spec.base ?? pageUrl);
      if (link) out.push({ ...link, language: 'ar' });
    });
  }

  // drop duplicate hrefs pointing at the same place
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = s.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readMovieStreams($: Doc, config: SourceConfig, pageUrl: string): StreamLink[] {
  const spec = config.episodes[0];
  if (!spec) return [];
  const specs = [spec.stream, ...spec.streams].filter(Boolean) as StreamConfigLike[];
  if (!specs.length) return [];
  return readStreams($, specs, undefined, pageUrl);
}

// ── misc ─────────────────────────────────────────────────────────────────────

function dedupeGenres(names: string[]): Genre[] {
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const raw of names) {
    const name = clean(raw);
    if (!name || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, slug: slugify(name) });
  }
  return out;
}
