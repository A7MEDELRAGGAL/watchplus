import type { TitleKind } from '@/lib/scraper/types';

/**
 * The Prisma SQLite connector supports neither `enum` nor `Json`, so these
 * string values are the single source of truth for both the database and the UI.
 */

export const TITLE_TYPES = ['MOVIE', 'SERIES', 'ANIME', 'DOCUMENTARY'] as const;
export type TitleType = (typeof TITLE_TYPES)[number];

export const TITLE_STATUSES = ['DRAFT', 'PUBLISHED', 'HIDDEN'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];

export const STREAM_KINDS = ['hls', 'mp4', 'iframe', 'dash', 'unknown'] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'ar';

/** URL segment prefix, per locale. Arabic is unprefixed for clean, shareable URLs. */
export const LOCALE_PREFIX: Record<Locale, string> = {
  ar: '',
  en: '/en',
};

export const SITE_NAME = {
  ar: 'ستريم',
  en: 'Stream',
} as const;

export const SITE_TAGLINE = {
  ar: 'أفلام ومسلسلات وأنمي — كل ما تريده في مكان واحد',
  en: 'Movies, series and anime — all in one place',
} as const;

/** Cards per row at each breakpoint; the grid adapts from these. */
export const GRID = { mobile: 2, sm: 3, md: 4, lg: 5, xl: 6 } as const;

export const PAGE_SIZE = 24;

export function titleTypeFromKind(kind: TitleKind): TitleType {
  return kind;
}

export function isTitleType(value: string): value is TitleType {
  return (TITLE_TYPES as readonly string[]).includes(value);
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Route helper: builds a locale-aware href. */
export function href(locale: Locale, path = ''): string {
  const prefix = LOCALE_PREFIX[locale];
  const suffix = path ? (path.startsWith('/') ? path : `/${path}`) : '';
  return `${prefix}${suffix}` || '/';
}
