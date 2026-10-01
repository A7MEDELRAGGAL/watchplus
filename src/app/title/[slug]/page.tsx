import Image from 'next/image';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { LibraryButton } from '@/components/library-button';
import { getDictionary, intlLocale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { isInLibrary } from '@/lib/library';
import { displayTitle, getTitleBySlug, canonicalSlug, getRelatedTitles, hasLive, cleanEpisodeName, displaySeasonNumber, seasonRank } from '@/lib/queries';

/** شارة نوع الإصدار: فيلم/أوفا/موسم N — لتمييز الأنواع بصريًا. */
function releaseBadge(originalTitle: string, type: string, locale: 'ar' | 'en'): string {
  if (type === 'MOVIE' || /فيلم|film|movie/i.test(originalTitle)) return locale === 'ar' ? 'فيلم' : 'Movie';
  if (/ova|ona|خاصة|اسبشل|سبيشل|special/i.test(originalTitle)) return locale === 'ar' ? 'خاصة' : 'Special';
  const n = seasonRank(originalTitle);
  if (n >= 1 && n <= 20) return locale === 'ar' ? `الموسم ${n}` : `S${n}`;
  return locale === 'ar' ? 'مرتبطة' : 'Related';
}

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
  // رابط قديم بسلاج مختلف (تغيّر بعد إعادة الاستيراد) → 301 للسلاج الحالي.
  // تقارن الصيغ المفكوكة (Next قد يسلّم المشفّر للعربية) ولا تعيد التوجيه
  // لفرق الترميز وحده — وإلا دخلنا حلقة. encodeURIComponent للـ Location.
  if (canonicalSlug(params.slug) !== title.slug) {
    permanentRedirect(`/title/${encodeURIComponent(title.slug)}`);
  }

  const name = displayTitle(title, locale);
  const firstPlayable =
    title.seasons.flatMap((s) => s.episodes).find((e) => hasLive(e)) ?? null;

  // Both flags in one round trip each, and only when there is a user to own them.
  const [inFavorites, inWatchlist, related] = await Promise.all([
    user ? isInLibrary('favorites', user.id, title.id) : Promise.resolve(false),
    user ? isInLibrary('watchlist', user.id, title.id) : Promise.resolve(false),
    getRelatedTitles(title.id, title.originalTitle),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      {/* cinematic banner */}
      <div className="relative overflow-hidden border-b border-ink-200 bg-ink-950 dark:border-ink-800">
        {(title.backdropUrl || title.posterUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/img?url=${encodeURIComponent((title.backdropUrl || title.posterUrl)!)}&w=1600&q=70`}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-50"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-50 via-ink-50/40 to-transparent dark:from-ink-950 dark:via-ink-950/40" />
      </div>

      <main className="container-page space-y-10 py-8">
        <section className="-mt-24 grid gap-6 sm:grid-cols-[200px_1fr] md:grid-cols-[240px_1fr]">
          <div className="relative mx-auto aspect-[2/3] w-full max-w-[200px] overflow-hidden rounded-2xl shadow-card-hover ring-1 ring-black/10 sm:mx-0 md:max-w-[240px] dark:ring-white/10">
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
            {typeof title.rating === 'number' ? (
              <span className="tabular absolute end-2 top-2 rounded-lg bg-black/70 px-2 py-1 text-sm font-black text-amber-300 backdrop-blur">
                ★ {title.rating.toFixed(1)}
              </span>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="space-y-2">
              <h1 className="break-words text-3xl font-black tracking-tight sm:text-4xl">{name}</h1>
              {/* الأسماء الثلاثية منظمة: عربي / إنجليزي / ياباني */}
              <ul className="space-y-1 text-sm">
                {locale !== 'ar' && title.titleAr && title.titleAr !== name ? (
                  <li className="flex gap-2">
                    <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-black text-ink-500 dark:bg-ink-800">
                      عربي
                    </span>
                    <span className="text-ink-600 dark:text-ink-300">{title.titleAr}</span>
                  </li>
                ) : null}
                {locale !== 'en' && title.titleEn && title.titleEn !== name ? (
                  <li dir="ltr" className="flex gap-2 text-start">
                    <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-black text-ink-500 dark:bg-ink-800">
                      EN
                    </span>
                    <span className="text-ink-600 dark:text-ink-300">{title.titleEn}</span>
                  </li>
                ) : null}
                {title.titleNative ? (
                  <li dir="ltr" className="flex gap-2 text-start">
                    <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-black text-ink-500 dark:bg-ink-800">
                      JP
                    </span>
                    <span className="text-ink-600 dark:text-ink-300">{title.titleNative}</span>
                  </li>
                ) : null}
              </ul>
            </div>

            <ul className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              {title.releaseYear ? (
                <li className="tabular rounded-full bg-ink-100 px-3 py-1 dark:bg-ink-800">
                  {title.releaseYear}
                </li>
              ) : null}
              <li className="rounded-full bg-ink-100 px-3 py-1 dark:bg-ink-800">
                {dict.browse.types[title.type] ?? title.type}
              </li>
              <li
                className={`rounded-full px-3 py-1 text-white ${title.isOngoing ? 'bg-brand-600' : 'bg-ink-500'}`}
              >
                {title.isOngoing ? dict.detail.ongoing : dict.detail.ended}
              </li>
              <li className="tabular rounded-full bg-ink-100 px-3 py-1 dark:bg-ink-800">
                {dict.detail.sourceCount(title.sources.length)}
              </li>
              {title.runtimeMin ? (
                <li className="tabular rounded-full bg-ink-100 px-3 py-1 dark:bg-ink-800">
                  {title.runtimeMin} {dict.common.min}
                </li>
              ) : null}
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
                  className="rounded-xl bg-gradient-to-l from-brand-500 to-brand-700 px-6 py-3 text-sm font-black text-white shadow-card transition hover:brightness-110"
                >
                  ▶ {dict.detail.watchNow}
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
                <ul className="rail flex max-w-full gap-4 overflow-x-auto pb-2">
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

        <Episodes title={title} dict={dict} locale={locale} />

        {related.length > 0 ? (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
              <span
                aria-hidden
                className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700"
              />
              {locale === 'ar' ? 'مواسم وإصدارات مرتبطة' : 'Related seasons & releases'}
            </h2>
            <ul className="flex gap-3 overflow-x-auto pb-2">
              {related.map((r) => (
                <li key={r.id} className="w-32 shrink-0">
                  <Link href={`/title/${r.slug}`} className="group block">
                    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-200 dark:bg-ink-800">
                      {r.posterUrl ? (
                        <Image
                          src={r.posterUrl}
                          alt=""
                          fill
                          sizes="128px"
                          className="object-cover transition duration-300 group-hover:scale-105"
                        />
                      ) : null}
                      <span className="absolute bottom-1.5 start-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                        {releaseBadge(r.originalTitle, r.type, locale)}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs font-bold group-hover:text-brand-500">
                      {displayTitle(r, locale)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}

function Episodes({
  title,
  dict,
  locale,
}: {
  title: NonNullable<Awaited<ReturnType<typeof getTitleBySlug>>>;
  dict: ReturnType<typeof getDictionary>;
  locale: 'ar' | 'en';
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
              const playable = hasLive(ep);
              const live = ep.sources.filter((s) => !s.isDead && playable);
              // "لم تبث بعد" للمواعيد المستقبلية فقط — القديم بلا روابط له رسالته
              const upcoming = ep.airDate ? new Date(ep.airDate).getTime() > Date.now() : false;
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
                      {dict.common.season} {displaySeasonNumber(title.originalTitle, season.number)} ·{' '}
                      {dict.common.episode} {ep.number}
                    </p>
                    <p className="truncate text-sm font-medium">
                      {cleanEpisodeName(ep.name, ep.number)}
                    </p>
                    {ep.airDate ? (
                      <p className="tabular text-[11px] text-ink-500 dark:text-ink-400">
                        {new Date(ep.airDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                      </p>
                    ) : null}
                    <p className="text-xs text-ink-500 dark:text-ink-400">
                      {playable
                        ? dict.detail.sourceCount(live.length)
                        : upcoming
                          ? dict.detail.notAired
                          : dict.detail.noSources}
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
