import { fetchJson } from '../core/http';
import { clean } from '../core/html';
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
 * AniList — the best free anime catalogue there is.
 * GraphQL, no API key, includes Arabic titles, studios, characters and airing
 * schedule. This is what makes the anime section good rather than an afterthought.
 *
 * Docs: https://docs.anilist.co/graphql
 */

const ENDPOINT = 'https://graphql.anilist.co';
const PAGE_SIZE = 50;

const MEDIA_FIELDS = `
  id
  idMal
  type
  format
  status
  description(asHtml: false)
  averageScore
  popularity
  season
  seasonYear
  duration
  episodes
  genres
  synonyms
  isAdult
  coverImage { extraLarge large medium color }
  bannerImage
  title { romaji english native }
  startDate { year month day }
  endDate { year month day }
  nextAiringEpisode { episode timeUntilAiring airingAt }
  studios(isMain: true) { nodes { name isAnimationStudio } }
  characters(perPage: 14, sort: [ROLE, RELEVANCE]) {
    edges {
      role
      node { name { full } image { large medium } }
    }
  }
  relations {
    edges {
      relationType
      node { id type format episodes title { romaji } coverImage { large } }
    }
  }
  externalLinks { site url }
`;

interface AniListResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

function stripHtml(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const out = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  return out || undefined;
}

function cleanDesc(value: string | null | undefined): string | undefined {
  const s = stripHtml(value);
  if (!s) return undefined;
  // AniList descriptions often end with a source credit; keep it, it reads fine
  return s;
}

function toIso(d?: { year?: number | null; month?: number | null; day?: number | null }): string | undefined {
  if (!d?.year) return undefined;
  const m = d.month ?? 1;
  const day = d.day ?? 1;
  return `${d.year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface AniMedia {
  id: number;
  idMal?: number | null;
  type: string;
  format?: string | null;
  status?: string | null;
  description?: string | null;
  averageScore?: number | null;
  popularity?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  duration?: number | null;
  episodes?: number | null;
  genres?: string[] | null;
  synonyms?: (string | null)[] | null;
  isAdult?: boolean | null;
  coverImage?: { extraLarge?: string; large?: string; medium?: string; color?: string } | null;
  bannerImage?: string | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null;
  nextAiringEpisode?: { episode?: number; airingAt?: number } | null;
  studios?: { nodes?: { name: string; isAnimationStudio: boolean }[] } | null;
  characters?: {
    edges?: {
      role: string;
      node: { name?: { full?: string | null } | null; image?: { large?: string | null; medium?: string | null } | null };
    }[];
  } | null;
  relations?: {
    edges?: { relationType: string; node: { id: number; type: string; format?: string; episodes?: number | null; title?: { romaji?: string | null } | null; coverImage?: { large?: string | null } | null } }[];
  } | null;
  externalLinks?: { site: string; url: string }[] | null;
}

async function gql<T>(query: string, variables: Record<string, unknown>, ctx: ProviderContext): Promise<T> {
  const res = await fetchJson<AniListResponse<T>>(ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ query, variables }),
    signal: ctx.signal,
    limiter: ctx.limiter,
    headers: { Accept: 'application/json' },
  });

  if (res.errors?.length) throw new Error(`AniList: ${res.errors.map((e) => e.message).join('; ')}`);
  if (!res.data) throw new Error('AniList returned no data');
  return res.data;
}

export const anilistProvider: Provider = {
  key: 'anilist',
  name: 'AniList',
  kind: 'api',
  baseUrl: ENDPOINT,
  priority: 5,
  // AniList currently allows ~30 req/min; stay well under it.
  rateLimit: { requestsPerSecond: 0.4, burst: 2 },

  isConfigured() {
    return true; // no key required
  },

  async discover(ctx, opts): Promise<DiscoveredPage> {
    const page = Number(opts.cursor ?? 1) || 1;

    // Walking trending -> popular -> top rated gives a varied, high-quality
    // front page instead of the same 50 shows every run.
    const phase = page <= 4 ? 0 : page <= 8 ? 1 : 2;
    const perPhase = phase === 0 ? 4 : 4;
    const localPage = ((page - 1) % perPhase) + 1;

    const sortBy =
      phase === 0 ? 'TRENDING_DESC' : phase === 1 ? 'POPULARITY_DESC' : 'SCORE_DESC';

    const query = `
      query ($page: Int, $perPage: Int, $sort: [MediaSort]) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { currentPage hasNextPage total }
          media(type: ANIME, isAdult: false, sort: $sort) {
            ${MEDIA_FIELDS}
          }
        }
      }
    `;

    const data = await gql<{
      Page: {
        pageInfo: { currentPage: number; hasNextPage: boolean; total: number };
        media: AniMedia[];
      };
    }>(query, { page: localPage, perPage: PAGE_SIZE, sort: [sortBy] }, ctx);

    const items = (data.Page.media ?? [])
      // `episodes` is null for ongoing shows, so fall back to the airing
      // schedule rather than dropping every long-running series on the floor
      .filter((m) => m.format !== 'MUSIC' && ((m.episodes ?? 0) > 0 || m.status === 'RELEASING'))
      .map((m) => toItem(m));

    return {
      items,
      cursor: String(page + 1),
      hasMore: data.Page.pageInfo.hasNextPage && page < opts.maxPages,
    };
  },

  async fetchDetail(ctx, providerId): Promise<TitleDetail | null> {
    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} }
      }
    `;
    const data = await gql<{ Media: AniMedia | null }>(query, { id: Number(providerId) }, ctx);
    const m = data.Media;
    if (!m) return null;

    const title = pickTitle(m);
    const duration = m.duration ?? 24;
    const isOngoing = m.status === 'RELEASING';

    /**
     * AniList leaves `episodes` null for ongoing shows (a 25-year show has no
     * meaningful total). `nextAiringEpisode.episode` is then the best available
     * lower bound: everything up to it has aired.
     */
    const totalEpisodes =
      m.episodes ?? (m.nextAiringEpisode?.episode ? Math.max(0, m.nextAiringEpisode.episode - 1) : 0);

    const genres: Genre[] = (m.genres ?? []).map((g) => ({ name: g, slug: slugify(g) }));
    const studios = (m.studios?.nodes ?? []).map((s) => ({ name: s.name, slug: slugify(s.name) }));

    const cast = (m.characters?.edges ?? [])
      .slice(0, 16)
      .map((e) => ({
        name: clean(e.node?.name?.full ?? ''),
        character: e.role === 'MAIN' ? 'Main' : e.role === 'SUPPORTING' ? 'Supporting' : undefined,
        imageUrl: e.node?.image?.large ?? e.node?.image?.medium ?? undefined,
      }))
      .filter((c) => c.name);

    // AniList has no playable links, but the episode list is still what the
    // player page needs in order to show a season/episode picker.
    const seasons: TitleDetail['seasons'] = [
      {
        number: 1,
        name: 'All episodes',
        overview: stripHtml(m.description),
        posterUrl: m.coverImage?.large ?? undefined,
        airDate: toIso(m.startDate ?? undefined),
        episodes: Array.from({ length: Math.min(totalEpisodes, 2000) }, (_, i) => ({
          number: i + 1,
          name: `Episode ${i + 1}`,
          runtime: duration,
          airDate:
            m.nextAiringEpisode?.episode === i + 1 && m.nextAiringEpisode.airingAt
              ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString()
              : undefined,
          streams: [],
        })),
      },
    ];

    return {
      providerId: String(m.id),
      url: `https://anilist.co/anime/${m.id}`,
      kind: 'ANIME',
      originalTitle: title.romaji ?? title.english ?? title.native ?? 'Untitled',
      titleEn: title.english ?? title.romaji ?? undefined,
      titleAr: pickArabic(m),
      overview: cleanDesc(m.description),
      tagline: m.season ? `${m.season} ${m.seasonYear ?? ''}`.trim() : undefined,
      posterUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? undefined,
      backdropUrl: m.bannerImage ?? undefined,
      releaseDate: toIso(m.startDate ?? undefined),
      runtimeMin: duration,
      showStatus: statusLabel(m.status),
      // AniList scores are 0-100, ours are 0-10
      rating: m.averageScore ? m.averageScore / 10 : undefined,
      genres,
      cast,
      studios,
      isOngoing,
      totalSeasons: 1,
      totalEpisodes,
      nextEpisodeAt: m.nextAiringEpisode?.airingAt
        ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString()
        : undefined,
      seasons,
      movieStreams: [],
      extra: {
        malId: m.idMal,
        format: m.format,
        popularity: m.popularity,
        synonyms: (m.synonyms ?? []).filter(Boolean),
        relations: (m.relations?.edges ?? []).slice(0, 12).map((e) => ({
          relation: e.relationType,
          id: e.node.id,
          type: e.node.type,
          episodes: e.node.episodes,
          title: e.node.title?.romaji,
          posterUrl: e.node.coverImage?.large,
        })),
        links: m.externalLinks ?? [],
      },
    };
  },

  async search(ctx, query): Promise<DiscoveredItem[]> {
    const q = `
      query ($search: String) {
        Page(page: 1, perPage: 24) {
          media(search: $search, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
        }
      }
    `;
    const data = await gql<{ Page: { media: AniMedia[] } }>(q, { search: query }, ctx);
    return (data.Page.media ?? []).map((m) => toItem(m));
  },
};

function pickTitle(m: AniMedia) {
  return {
    romaji: m.title?.romaji ?? undefined,
    english: m.title?.english ?? undefined,
    native: m.title?.native ?? undefined,
  };
}

/**
 * AniList does not index Arabic titles as a separate field, but `synonyms` and
 * `native` occasionally carry them. Detect rather than assume.
 */
function pickArabic(m: AniMedia): string | undefined {
  const arabic = /[\u0600-\u06FF]/;
  for (const candidate of [m.title?.native, ...(m.synonyms ?? [])]) {
    if (candidate && arabic.test(candidate)) return clean(candidate);
  }
  return undefined;
}

function statusLabel(status?: string | null): string | undefined {
  switch (status) {
    case 'RELEASING':
      return 'Airing';
    case 'FINISHED':
      return 'Finished';
    case 'NOT_YET_RELEASED':
      return 'Upcoming';
    case 'CANCELLED':
      return 'Cancelled';
    case 'HIATUS':
      return 'Hiatus';
    default:
      return undefined;
  }
}

function toItem(m: AniMedia): DiscoveredItem {
  const t = pickTitle(m);
  return {
    providerId: String(m.id),
    url: `https://anilist.co/anime/${m.id}`,
    title: t.english ?? t.romaji ?? t.native ?? 'Untitled',
    kind: 'ANIME',
    year: m.seasonYear ?? m.startDate?.year ?? undefined,
    posterUrl: m.coverImage?.large ?? undefined,
    rank: m.popularity ?? undefined,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
