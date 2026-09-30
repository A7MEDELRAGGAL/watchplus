import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { TitleCard } from '@/components/title-card';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { getLibraryTitles } from '@/lib/library';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Favorites · WatchBox', robots: { index: false } };

export default async function FavoritesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const locale = getLocale();
  const dict = getDictionary(locale);
  const titles = await getLibraryTitles('favorites', user.id);

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />
      <main className="container-page py-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
              {dict.library.favorites}
            </h1>
            <p className="tabular mt-1 text-sm text-ink-500 dark:text-ink-400">
              {titles.length}
            </p>
          </div>
          <Link
            href="/browse"
            className="rounded-full border border-ink-200 px-4 py-2 text-xs font-bold transition hover:border-brand-500 hover:text-brand-600 dark:border-ink-700 dark:hover:border-brand-500"
          >
            {dict.nav.browse}
          </Link>
        </header>

        {titles.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-500 dark:text-ink-400">{dict.library.emptyFavorites}</p>
            <Link
              href="/browse"
              className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {dict.nav.browse}
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {titles.map((title) => (
              <li key={title.id}>
                <TitleCard title={title} locale={locale} dict={dict} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
