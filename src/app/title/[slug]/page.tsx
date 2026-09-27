import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { LibraryButton } from '@/components/library-button';
import { getDictionary, intlLocale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { isInLibrary } from '@/lib/library';
import { displayTitle, getTitleBySlug } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const title = await getTitleBySlug(params.slug);
  if (!title) return {};
  return {
    title: displayTitle(title, 'en'),
    description: title.overview?.slice(0, 160) ?? undefined,
    openGraph: {
      images: title.posterUrl
        ? [{ url: `/api/img?url=${encodeURIComponent(title.posterUrl)}&w=640` }]
        : [],
    },
  };
}

export default async function TitlePage({ params }: { params: { slug: string } }) {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();
  const title = await getTitleBySlug(params.slug);

  if (!title) notFound();

  const name = displayTitle(title, locale);
  const firstPlayable =
    title.seasons.flatMap((s) => s.episodes).find((e) => e.sources.length > 0) ?? null;

  // Both flags in one round trip each, and only when there is a user to own them.
  const [inFavorites, inWatchlist] = user
    ? await Promise.all([
        isInLibrary('favorites', user.id, title.id),
        isInLibrary('watchlist', user.id, title.id),
      ])
    : [false, false];

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-10 py-8">
        <section className="grid gap-6 md:grid-cols-[240px_1fr]">
          <div className="relative mx-auto aspect-[2/3] w-full max-w-[240px] overflow-hidden rounded-2xl bg-ink-200 dark:bg-ink-800 md:mx-0">
            {title.posterUrl ? (
              <Image
                src={title.posterUrl}
                alt={name}
                fill
                sizes="240px"
                className="object-cover"
                priority
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{name}</h1>
              {locale === 'ar' && title.titleEn && title.titleEn !== name ? (
                <p dir="ltr" className="text-start text-sm text-ink-500 dark:text-ink-400">
                  {title.titleEn}
                </p>
              ) : null}
              {locale === 'en' && title.titleAr && title.titleAr !== name ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{title.titleAr}</p>
              ) : null}
            </div>

            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600 dark:text-ink-300">
              {title.releaseYear ? <li className="tabular">{title.releaseYear}</li> : null}
              {typeof title.rating === 'number' ? (
                <li className="tabular font-semibold text-amber-500">★ {title.rating.toFixed(1)}</li>
              ) : null}
              {title.runtimeMin ? (
                <li className="tabular">
                  {title.runtimeMin} {dict.common.min}
                </li>
              ) : null}
              <li>{dict.browse.types[title.type] ?? title.type}</li>
              <li>{title.isOngoing ? dict.detail.ongoing : dict.detail.ended}</li>
              <li>{dict.detail.sourceCount(title.sources.length)}</li>
            </ul>

            {title.genres.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {title.genres.map((g) => (
                  <li key={g.slug ?? g.name}>
                    <Link
                      href={`/browse?genre=${encodeURIComponent(g.slug ?? g.name)}`}
                      className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                    >
                      {g.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              {firstPlayable ? (
                <Link
                  href={`/watch/${title.slug}/${seasonOf(title.seasons, firstPlayable.id)}/${firstPlayable.number}`}
                  className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
                >
                  {dict.detail.watchNow}
                </Link>
              ) : null}

              {/* Save controls only when signed in — the button would otherwise
                  just bounce the reader to /login mid-browse. */}
              {user ? (
                <>
                  <LibraryButton
                    kind="favorites"
                    titleId={title.id}
                    initialInLibrary={inFavorites}
                    labels={{
                      add: dict.library.addFavorite,
                      remove: dict.library.removeFavorite,
                    }}
                  />
                  <LibraryButton
                    kind="watchlist"
                    titleId={title.id}
                    initialInLibrary={inWatchlist}
                    labels={{
                      add: dict.library.addWatchlist,
                      remove: dict.library.removeWatchlist,
                    }}
                  />
                </>
              ) : (
                <Link
                  href="/login"
                  className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold transition hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"
                >
                  {dict.auth.signInToSave}
                </Link>
              )}

              {title.releaseDate ? (
                <span className="text-xs text-ink-500">
                  {dict.common.from}{' '}
                  {new Date(title.releaseDate).toLocaleDateString(intlLocale(locale))}
                </span>
              ) : null}
            </div>

            <section className="space-y-2 pt-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
                {dict.detail.overview}
              </h2>
              <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-300">
                {title.overview || dict.detail.noOverview}
              </p>
            </section>

            {title.studios.length > 0 ? (
              <section className="space-y-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
                  {dict.detail.studios}
                </h2>
                <p className="text-sm text-ink-600 dark:text-ink-300">
                  {title.studios.map((s) => s.name).join(' · ')}
                </p>
              </section>
            ) : null}

            {title.cast.length > 0 ? (
              <section className="space-y-3 pt-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
                  {dict.detail.cast}
                </h2>
                <ul className="flex gap-4 overflow-x-auto pb-2">
                  {title.cast.slice(0, 16).map((c, i) => (
                    <li key={`${c.name}-${i}`} className="w-24 shrink-0 text-center">
                      <div className="relative mx-auto aspect-square w-24 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
                        {c.imageUrl ? (
                          <Image
                            src={c.imageUrl}
                            alt=""
                            fill
                            sizes="96px"
                            className="object-cover"
                          />
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs font-medium">{c.name}</p>
                      {c.character ? (
                        <p className="line-clamp-1 text-[11px] text-ink-500">{c.character}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </section>

        <Episodes title={title} dict={dict} />
      </main>
    </div>
  );
}

function Episodes({
  title,
  dict,
}: {
  title: NonNullable<Awaited<ReturnType<typeof getTitleBySlug>>>;
  dict: ReturnType<typeof getDictionary>;
}) {
  if (!title.seasons.length) {
    return (
      <section>
        <h2 className="mb-3 text-lg font-bold">{dict.detail.episodes}</h2>
        <p className="card p-6 text-sm text-ink-500">{dict.watch.noEpisodes}</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-bold">
        {dict.detail.episodes}
        <span className="tabular ms-2 text-sm font-normal text-ink-500">{title.episodeCount}</span>
      </h2>

      {title.seasons.map((season) => (
        <div key={season.id} className="space-y-3">
          {title.seasons.length > 1 ? (
            <h3 className="text-sm font-semibold text-ink-600 dark:text-ink-300">
              {dict.common.seasonOf} {season.number}
            </h3>
          ) : null}

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {season.episodes.map((ep) => {
              const playable = ep.sources.length > 0;
              const inner = (
                <>
                  <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded-lg bg-ink-200 dark:bg-ink-800">
                    {ep.stillUrl ? (
                      <Image
                        src={ep.stillUrl}
                        alt=""
                        fill
                        sizes="128px"
                        className="object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="tabular text-xs font-bold text-brand-600 dark:text-brand-400">
                      {dict.common.season} {season.number} · {dict.common.episode} {ep.number}
                    </p>
                    <p className="truncate text-sm font-medium">
                      {ep.name || `Episode ${ep.number}`}
                    </p>
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      {playable ? dict.detail.sourceCount(ep.sources.length) : dict.detail.notAired}
                    </p>
                  </div>
                </>
              );

              return (
                <li key={ep.id}>
                  {playable ? (
                    <Link
                      href={`/watch/${title.slug}/${season.number}/${ep.number}`}
                      className="card flex gap-3 p-3 transition hover:shadow-card-hover"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="card flex gap-3 p-3 opacity-60">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function seasonOf(
  seasons: { number: number; episodes: { id: string }[] }[],
  episodeId: string,
): number {
  for (const s of seasons) {
    if (s.episodes.some((e) => e.id === episodeId)) return s.number;
  }
  return 1;
}
