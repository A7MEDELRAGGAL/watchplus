import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
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

  const { items, total, page, pageCount, years, genres } = await listTitles({
    type: searchParams.type,
    genre: searchParams.genre,
    year: Number.isFinite(year) ? year : undefined,
    sort,
    page: searchParams.page ? Number(searchParams.page) : 1,
  });

  const current = { type: searchParams.type, genre: searchParams.genre, year: searchParams.year, sort, page: searchParams.page };

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-8 py-8">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{dict.browse.title}</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">{dict.browse.results(total)}</p>
        </header>

        <Filters
          dict={dict}
          types={TYPES}
          genres={genres}
          years={years}
          current={current}
          href={buildHref}
        />

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
          <nav className="flex items-center justify-center gap-2 pt-4">
            {page > 1 ? (
              <Link
                href={buildHref(current, { page: String(page - 1) })}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-ink-700"
              >
                {dict.common.back}
              </Link>
            ) : null}
            <span className="tabular text-sm text-ink-500">
              {page} / {pageCount}
            </span>
            {page < pageCount ? (
              <Link
                href={buildHref(current, { page: String(page + 1) })}
                className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-ink-700"
              >
                ›
              </Link>
            ) : null}
          </nav>
        ) : null}
      </main>
    </div>
  );
}

function Filters({
  dict,
  types,
  genres,
  years,
  current,
  href,
}: {
  dict: ReturnType<typeof getDictionary>;
  types: string[];
  genres: { name: string; slug?: string }[];
  years: number[];
  current: SearchParams;
  href: (base: SearchParams, patch: Partial<SearchParams>) => string;
}) {
  const chip = 'rounded-lg border px-3 py-1.5 text-xs font-medium transition';
  const active = `${chip} border-brand-600 bg-brand-600 text-white`;
  const idle = `${chip} border-ink-200 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800`;

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
