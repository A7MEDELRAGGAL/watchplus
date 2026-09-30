import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
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
        <section className="relative overflow-hidden rounded-3xl border border-ink-200 bg-gradient-to-br from-brand-950 via-ink-900 to-ink-950 p-6 sm:p-8 dark:border-ink-800">
          <div
            aria-hidden
            className="pointer-events-none absolute -start-16 -top-24 h-64 w-64 rounded-full bg-brand-600/25 blur-3xl"
          />
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            {dict.search.title}
          </h1>

          {/* A plain GET form: the results page is shareable and works with JS off. */}
          <form action="/search" method="get" role="search" className="mt-4 flex gap-2">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder={dict.search.placeholder}
              autoFocus
              className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-ink-300 outline-none backdrop-blur transition focus:border-brand-400"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-brand-600 px-6 py-3 text-sm font-bold text-white transition hover:bg-brand-500"
            >
              {dict.search.submit}
            </button>
          </form>
        </section>

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

      <SiteFooter dict={dict} />
    </div>
  );
}
