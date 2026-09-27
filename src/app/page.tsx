import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { TitleRow } from '@/components/title-card';
import { getDictionary, intlLocale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { getRows } from '@/lib/queries';

// The whole page is per-visitor (locale cookie, fresh catalogue), so never cache it.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();
  const [popular, latest, anime, movies] = await getRows(20);
  const isEmpty = popular.length === 0;

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-10 py-8">
        {isEmpty ? (
          <section className="card p-8">
            <h1 className="text-2xl font-bold tracking-tight">{dict.siteName}</h1>
            <p className="mt-2 max-w-2xl text-ink-600 dark:text-ink-400">{dict.home.emptyDb}</p>
            <p className="tabular mt-4 text-sm text-ink-500 dark:text-ink-400">
              {new Date().toLocaleDateString(intlLocale(locale))}
            </p>
          </section>
        ) : (
          <>
            <Hero title={popular[0]} locale={locale} dict={dict} />
            <TitleRow
              title={popular}
              heading={dict.home.popular}
              href="/browse?sort=popular"
              locale={locale}
              dict={dict}
            />
            <TitleRow
              title={latest}
              heading={dict.home.latest}
              href="/browse?sort=newest"
              locale={locale}
              dict={dict}
            />
            <TitleRow
              title={anime}
              heading={dict.home.anime}
              href="/browse?type=ANIME"
              locale={locale}
              dict={dict}
            />
            <TitleRow
              title={movies}
              heading={dict.home.movies}
              href="/browse?type=MOVIE"
              locale={locale}
              dict={dict}
            />
          </>
        )}
      </main>

      <footer className="mt-16 border-t border-ink-200 py-8 dark:border-ink-800">
        <div className="container-page flex flex-wrap items-center justify-between gap-3 text-xs text-ink-500 dark:text-ink-400">
          <p>
            © {new Date().getFullYear()} {dict.siteName} — {dict.footer.rights}
          </p>
          <p>{dict.footer.about}</p>
        </div>
      </footer>
    </div>
  );
}

function Hero({
  title,
  locale,
  dict,
}: {
  title: Awaited<ReturnType<typeof getRows>>[0][number];
  locale: 'ar' | 'en';
  dict: ReturnType<typeof getDictionary>;
}) {
  const name = title.titleAr || title.originalTitle;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-ink-200 dark:border-ink-800">
      {title.backdropUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/img?url=${encodeURIComponent(title.backdropUrl)}&w=1600&q=70`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30"
        />
      ) : null}

      <div className="relative space-y-3 p-6 sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
          {dict.browse.types[title.type] ?? title.type}
        </p>
        <h1 className="max-w-2xl text-3xl font-black tracking-tight sm:text-4xl">{name}</h1>
        {title.overview ? (
          <p className="line-clamp-3 max-w-2xl text-sm text-ink-600 dark:text-ink-300">
            {title.overview}
          </p>
        ) : null}
        <Link
          href={`/title/${title.slug}`}
          className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          {dict.detail.watchNow}
        </Link>
      </div>
    </section>
  );
}
