import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
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
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{dict.library.favorites}</h1>

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
    </div>
  );
}
