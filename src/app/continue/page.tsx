import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { getContinueWatching } from '@/lib/library';
import { displayTitle } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Continue watching · WatchBox',
  robots: { index: false },
};

export default async function ContinuePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const locale = getLocale();
  const dict = getDictionary(locale);
  const rows = await getContinueWatching(user.id);

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />
      <main className="container-page py-10">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">
          {dict.library.continueWatching}
        </h1>

        {rows.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-500 dark:text-ink-400">{dict.library.emptyContinue}</p>
            <Link
              href="/browse"
              className="inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {dict.nav.browse}
            </Link>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {rows.map(({ title, episode, seasonNumber, progress }) => (
              <li key={title.id}>
                <Link href={`/watch/${title.slug}/${seasonNumber}/${episode.number}`} className="group block">
                  <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-200 dark:bg-ink-800">
                    {title.posterUrl ? (
                      <Image
                        src={`/api/img?u=${encodeURIComponent(title.posterUrl)}`}
                        alt={displayTitle(title, locale)}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                        className="object-cover transition group-hover:scale-105"
                      />
                    ) : null}
                    {/* Resume bar sits on the poster so it needs no extra row. */}
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                      <div
                        className="h-full bg-brand-500"
                        style={{ width: `${Math.round(progress.ratio * 100)}%` }}
                      />
                    </div>
                    <span className="tabular absolute bottom-3 end-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      S{seasonNumber}E{episode.number}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium group-hover:text-brand-600">
                    {displayTitle(title, locale)}
                  </p>
                  <p className="text-xs text-ink-500 dark:text-ink-400">
                    {dict.library.resume} · {dict.library.progress(progress.ratio * 100)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
