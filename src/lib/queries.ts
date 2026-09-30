import { prisma } from '@/lib/db';
import { fromJsonText } from '@/lib/db-json';
import type { Prisma } from '@prisma/client';

/**
 * Every read the site performs goes through this module.
 *
 * Two things it centralises:
 *   - `searchBlob` / JSON-text decoding, so no component touches a raw string
 *   - the "only published rows" rule, so a half-finished scrape can never show
 *     up in the UI
 */

export interface Genre {
  id?: string;
  name: string;
  slug?: string;
}

export interface Studio {
  id?: string;
  name: string;
  slug?: string;
}

export interface CastMember {
  name: string;
  character?: string;
  imageUrl?: string;
}

export const TITLE_SELECT = {
  id: true,
  slug: true,
  type: true,
  originalTitle: true,
  titleAr: true,
  titleEn: true,
  overview: true,
  tagline: true,
  posterUrl: true,
  backdropUrl: true,
  releaseDate: true,
  releaseYear: true,
  runtimeMin: true,
  showStatus: true,
  rating: true,
  votesCount: true,
  popularity: true,
  totalSeasons: true,
  totalEpisodes: true,
  isOngoing: true,
  genres: true,
  studios: true,
  nextEpisodeAt: true,
} satisfies Prisma.TitleSelect;

export type TitleCardData = Prisma.TitleGetPayload<{ select: typeof TITLE_SELECT }>;

/** Locale-aware display title: Arabic wins when the locale is Arabic. */
export function displayTitle(
  title: Pick<TitleCardData, 'originalTitle' | 'titleAr' | 'titleEn'>,
  locale: 'ar' | 'en',
): string {
  if (locale === 'ar') return title.titleAr || title.originalTitle;
  return title.titleEn || title.originalTitle;
}

const PUBLISHED = { status: 'PUBLISHED' } as const;

// ─────────────────────────────────────────────────────────────────────────────
// Home
// ─────────────────────────────────────────────────────────────────────────────

/** One row per home section, in the order the page renders them. */
export type HomeRows = [
  TitleCardData[],
  TitleCardData[],
  TitleCardData[],
  TitleCardData[],
  TitleCardData[],
];

/**
 * Home quality gate: a card without a poster or without a single playable
 * episode never reaches the front page (no more empty/broken cards).
 */
const DISPLAYABLE = {
  posterUrl: { not: null },
  seasons: { some: { episodes: { some: { sources: { some: { isDead: false } } } } } },
} as const;

export async function getRows(limit = 20): Promise<HomeRows> {
  return Promise.all([
    // رائج: الأعلى مشاهدة وتقييمًا (بشرط العرض)
    prisma.title.findMany({
      where: { ...PUBLISHED, ...DISPLAYABLE },
      select: TITLE_SELECT,
      orderBy: [{ views: 'desc' }, { rating: 'desc' }],
      take: limit,
    }),
    // الأحدث: آخر ما دخل قاعدة البيانات (استيراد/تحديث)
    prisma.title.findMany({
      where: { ...PUBLISHED, ...DISPLAYABLE },
      select: TITLE_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    // الأعلى تقييمًا (بوستر + روابط شرط)
    prisma.title.findMany({
      where: { ...PUBLISHED, rating: { not: null }, ...DISPLAYABLE },
      select: TITLE_SELECT,
      orderBy: [{ rating: 'desc' }, { votesCount: 'desc' }],
      take: limit,
    }),
    // أنمي: الأعلى تقييمًا أولًا (بوستر + روابط شرط)
    prisma.title.findMany({
      where: { ...PUBLISHED, type: 'ANIME', ...DISPLAYABLE },
      select: TITLE_SELECT,
      orderBy: [{ rating: 'desc' }, { votesCount: 'desc' }],
      take: limit,
    }),
    // أفلام: نفس البوابة (قد تكون فارغة — الصفحة تتخطى الفارغ بدل عرضه)
    prisma.title.findMany({
      where: { ...PUBLISHED, type: 'MOVIE', ...DISPLAYABLE },
      select: TITLE_SELECT,
      orderBy: [{ rating: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Browse
// ─────────────────────────────────────────────────────────────────────────────

export type SortKey = 'popular' | 'newest' | 'rating' | 'year';
export const SORT_KEYS: SortKey[] = ['popular', 'newest', 'rating', 'year'];

function orderFor(sort: SortKey): Prisma.TitleOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'rating':
      return [{ rating: 'desc' }, { votesCount: 'desc' }];
    case 'year':
      return [{ releaseYear: 'desc' }];
    case 'popular':
    default:
      return [{ popularity: 'desc' }];
  }
}

export interface BrowseArgs {
  type?: string;
  genre?: string;
  year?: number;
  sort?: SortKey;
  page?: number;
  perPage?: number;
}

export async function listTitles(args: BrowseArgs = {}) {
  const perPage = Math.min(48, Math.max(6, args.perPage ?? 24));
  const page = Math.max(1, args.page ?? 1);

  const where: Prisma.TitleWhereInput = {
    ...PUBLISHED,
    ...(args.type ? { type: args.type } : {}),
    ...(args.year ? { releaseYear: args.year } : {}),
    // genres is JSON text, so the facet is matched on the stored slug. It is an
    // index-less LIKE, which is acceptable at this catalogue size; a real
    // `TitleGenre` join table is the fix if the catalogue grows a lot.
    ...(args.genre ? { genres: { contains: `"slug":"${args.genre}"` } } : {}),
  };

  const [items, total, years, genreSample] = await Promise.all([
    prisma.title.findMany({
      where,
      select: TITLE_SELECT,
      orderBy: orderFor(args.sort ?? 'popular'),
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.title.count({ where }),
    prisma.title.findMany({
      where: PUBLISHED,
      distinct: ['releaseYear'],
      select: { releaseYear: true },
      orderBy: { releaseYear: 'desc' },
      take: 30,
    }),
    prisma.title.findMany({
      where: PUBLISHED,
      select: { genres: true },
      orderBy: { popularity: 'desc' },
      take: 1000,
    }),
  ]);

  return {
    items,
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
    years: years.map((y) => y.releaseYear).filter((y): y is number => typeof y === 'number'),
    genres: collectGenres(genreSample),
  };
}

/** Distinct genres, ordered by how many titles use them. */
export function collectGenres(rows: { genres: string | null }[]): Genre[] {
  const counts = new Map<string, Genre>();
  for (const row of rows) {
    for (const g of fromJsonText<Genre[]>(row.genres, [])) {
      if (!g?.name) continue;
      const key = g.slug || g.name;
      const existing = counts.get(key);
      if (existing) continue;
      counts.set(key, { name: g.name, slug: g.slug });
    }
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonical form for comparing a requested slug with the stored one: decode
 * once or twice (Next may hand the param still-encoded for Arabic slugs).
 * Used by pages to redirect old/aliased slugs without looping on mere
 * encoding differences.
 */
export function canonicalSlug(slug: string): string {
  let out = slug;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  return out;
}

export async function getTitleBySlug(slug: string) {
  const episodeSelect = {
    id: true,
    number: true,
    name: true,
    overview: true,
    stillUrl: true,
    runtime: true,
    airDate: true,
    sources: {
      where: { isDead: false },
      select: {
        id: true,
        provider: true,
        name: true,
        url: true,
        streamUrl: true,
        kind: true,
        quality: true,
        language: true,
      },
    },
  } as const;
  const seasonSelect = {
    id: true,
    number: true,
    name: true,
    overview: true,
    airDate: true,
    episodes: { orderBy: { number: 'asc' }, select: episodeSelect },
  } as const;

  async function lookup(s: string) {
    return prisma.title.findFirst({
      where: { slug: s, ...PUBLISHED },
      select: {
        ...TITLE_SELECT,
        cast: true,
        countries: true,
        key: true,
        sources: {
          select: { provider: true, url: true, isDead: true, language: true },
          where: { isDead: false },
        },
        seasons: { orderBy: { number: 'asc' }, select: seasonSelect },
      },
    });
  }

  let title = await lookup(slug);
  if (!title) {
    // فك التشفير المزدوج: Next.js قد يسلّم slug مشفّرًا مرة أو مرتين
    // للعناوين العربية — جرّب مرة ثم مرتين، أي إصابة تكسب.
    try {
      const once = decodeURIComponent(slug);
      if (once !== slug) title = await lookup(once);
    } catch {
      /* malformed escape — keep null */
    }
    if (!title) {
      try {
        const twice = decodeURIComponent(decodeURIComponent(slug));
        if (twice !== slug) title = await lookup(twice);
      } catch {
        /* double-encoded malformed — keep null */
      }
    }
  }

  if (!title) return null;

  const episodes = title.seasons.flatMap((s) => s.episodes);

  return {
    ...title,
    cast: fromJsonText<CastMember[]>(title.cast, []),
    genres: fromJsonText<Genre[]>(title.genres, []),
    studios: fromJsonText<Studio[]>(title.studios, []),
    countries: fromJsonText<{ name: string }[]>(title.countries, []),
    episodeCount: episodes.length,
    playableCount: episodes.filter((e) => e.sources.length > 0).length,
  };
}

export type TitleDetailData = NonNullable<Awaited<ReturnType<typeof getTitleBySlug>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Substring search over the denormalised `searchBlob`, ranked by popularity.
 *
 * A real deployment should move this to Postgres full-text search over an
 * Arabic- and English-aware configuration; `searchBlob` keeps the site useful
 * until then and works identically on either engine.
 */
export async function searchTitles(query: string, limit = 40): Promise<TitleCardData[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  return prisma.title.findMany({
    where: {
      ...PUBLISHED,
      OR: [
        { searchBlob: { contains: q } },
        { originalTitle: { contains: query.trim(), mode: 'insensitive' } },
      ],
    },
    select: TITLE_SELECT,
    orderBy: [{ popularity: 'desc' }, { rating: 'desc' }],
    take: limit,
  });
}
