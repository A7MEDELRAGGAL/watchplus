import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { TitleCard } from '@/components/title-card';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { listTitles, SORT_KEYS, type SortKey } from '@/lib/queries';

export const dynamic = 'force-dynamic';

type SearchParams = {
  type?: string;
  genre?: string;
  year?: string;
  sort?: string;
  page?: string;
  available?: string;
  minRating?: string;
};

const TYPES = ['MOVIE', 'SERIES', 'ANIME', 'DOCUMENTARY'];

function buildHref(base: SearchParams, patch: Partial<SearchParams>) {
  const next = { ...base, ...patch };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `/browse?${s}` : '/browse';
}

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();

  const sort = (SORT_KEYS.includes(searchParams.sort as SortKey)
    ? searchParams.sort
    : 'popular') as SortKey;
  const year = searchParams.year ? Number(searchParams.year) : undefined;
  const minRating = searchParams.minRating ? Number(searchParams.minRating) : undefined;

  const { items, total, page, pageCount, years, genres } = await listTitles({
    type: searchParams.type,
    genre: searchParams.genre,
    year: Number.isFinite(year) ? year : undefined,
    sort,
    page: searchParams.page ? Number(searchParams.page) : 1,
    // الافتراضي: القابل للمشاهدة فقط (الكتالوج الفارغ يُرى بزر "الكل")
    available: searchParams.available === '0' ? false : true,
    minRating: typeof minRating === 'number' && Number.isFinite(minRating) ? minRating : undefined,
  });

  const current = { type: searchParams.type, genre: searchParams.genre, year: searchParams.year, sort, page: searchParams.page, available: searchParams.available, minRating: searchParams.minRating };

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-8 py-8">
        <header className="relative overflow-hidden rounded-3xl border border-ink-200 bg-gradient-to-br from-brand-950 via-ink-900 to-ink-950 p-6 sm:p-8 dark:border-ink-800">
          <div
            aria-hidden
            className="pointer-events-none absolute -end-16 -top-24 h-64 w-64 rounded-full bg-brand-600/25 blur-3xl"
          />
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            {dict.browse.title}
          </h1>
          <p className="tabular mt-1 text-sm text-ink-300">{dict.browse.results(total)}</p>
        </header>

        <div className="card space-y-4 p-4 sm:p-5">
          <Filters
            dict={dict}
            locale={locale}
            types={TYPES}
            genres={genres}
            years={years}
            current={current}
            href={buildHref}
          />
        </div>

        {items.length === 0 ? (
          <p className="card p-10 text-center text-sm text-ink-500 dark:text-ink-400">
            {dict.common.empty}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {items.map((t, i) => (
              <li key={t.id}>
                <TitleCard title={t} locale={locale} dict={dict} priority={i < 12} />
              </li>
            ))}
          </ul>
        )}

        {pageCount > 1 ? (
          <nav className="flex items-center justify-center gap-3 pt-4">
            {page > 1 ? (
              <Link
                href={buildHref(current, { page: String(page - 1) })}
                className="rounded-full border border-ink-200 bg-white px-4 py-2 text-sm font-semibold transition hover:border-brand-500 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900 dark:hover:border-brand-500"
              >
                {dict.common.back}
              </Link>
            ) : null}
            <span className="tabular rounded-full bg-ink-100 px-4 py-2 text-sm font-bold dark:bg-ink-800">
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Link
                href={buildHref(current, { page: String(page + 1) })}
                className="rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-500"
              >
                ›
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}

function Filters({
  dict,
  locale,
  types,
  genres,
  years,
  current,
  href,
}: {
  dict: ReturnType<typeof getDictionary>;
  locale: 'ar' | 'en';
  types: string[];
  genres: { name: string; slug?: string }[];
  years: number[];
  current: SearchParams;
  href: (base: SearchParams, patch: Partial<SearchParams>) => string;
}) {
  const chip = 'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition';
  const active = `${chip} border-brand-600 bg-brand-600 text-white shadow-card`;
  const idle = `${chip} border-ink-200 bg-white text-ink-600 hover:border-brand-400 hover:text-brand-600 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-300 dark:hover:border-brand-500 dark:hover:text-brand-400`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {dict.browse.type}
        </span>
        <Link href={href(current, { type: undefined, page: undefined })} className={current.type ? idle : active}>
          {dict.browse.all}
        </Link>
        {types.map((t) => (
          <Link
            key={t}
            href={href(current, { type: current.type === t ? undefined : t, page: undefined })}
            className={current.type === t ? active : idle}
          >
            {dict.browse.types[t] ?? t}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {dict.browse.sort}
        </span>
        {SORT_KEYS.map((s) => (
          <Link
            key={s}
            href={href(current, { sort: s === 'popular' ? undefined : s, page: undefined })}
            className={current.sort === s || (!current.sort && s === 'popular') ? active : idle}
          >
            {dict.browse.sorts[s]}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
          {locale === 'ar' ? 'الحالة' : 'Status'}
        </span>
        <Link
          href={href(current, { available: current.available === '0' ? undefined : '0', page: undefined })}
          className={current.available === '0' ? idle : active}
        >
          {current.available === '0'
            ? (locale === 'ar' ? 'الكل (حتى الفارغ)' : 'All (incl. empty)')
            : (locale === 'ar' ? 'متاح للمشاهدة ✓' : 'Watchable ✓')}
        </Link>
        {[7, 8].map((r) => (
          <Link
            key={r}
            href={href(current, { minRating: current.minRating === String(r) ? undefined : String(r), page: undefined })}
            className={current.minRating === String(r) ? active : idle}
          >
            {locale === 'ar' ? `تقييم ${r}+` : `Rated ${r}+`}
          </Link>
        ))}
      </div>

      {genres.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {dict.browse.genre}
          </span>
          {genres.slice(0, 24).map((g) => {
            const slug = g.slug ?? g.name;
            return (
              <Link
                key={slug}
                href={href(current, { genre: current.genre === slug ? undefined : slug, page: undefined })}
                className={current.genre === slug ? active : idle}
              >
                {g.name}
              </Link>
            );
          })}
        </div>
      ) : null}

      {years.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="me-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {dict.browse.year}
          </span>
          {years.slice(0, 16).map((y) => (
            <Link
              key={y}
              href={href(current, { year: current.year === String(y) ? undefined : String(y), page: undefined })}
              className={current.year === String(y) ? active : idle}
            >
              {y}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
