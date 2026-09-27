import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { TitleCard } from '@/components/title-card';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { searchTitles } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();
  const query = (searchParams.q ?? '').trim();
  const tooShort = query.length > 0 && query.length < 2;
  const results = query.length >= 2 ? await searchTitles(query) : [];

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{dict.search.title}</h1>

        {/* A plain GET form: the results page is shareable and works with JS off. */}
        <form action="/search" method="get" role="search" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder={dict.search.placeholder}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-brand-500 dark:border-ink-700 dark:bg-ink-900"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            {dict.search.submit}
          </button>
        </form>

        {tooShort ? (
          <p className="text-sm text-ink-500">{dict.search.hint}</p>
        ) : query.length >= 2 && results.length === 0 ? (
          <p className="card p-10 text-center text-sm text-ink-500">{dict.search.noResults(query)}</p>
        ) : results.length > 0 ? (
          <>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {dict.search.resultsFor(query)}
            </p>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {results.map((t, i) => (
                <li key={t.id}>
                  <TitleCard title={t} locale={locale} dict={dict} priority={i < 6} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </div>
  );
}
