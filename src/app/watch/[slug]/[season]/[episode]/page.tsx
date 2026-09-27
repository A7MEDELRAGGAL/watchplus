import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { VideoPlayer } from '@/components/video-player';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTitleBySlug } from '@/lib/queries';

export const dynamic = 'force-dynamic';

interface Params {
  slug: string;
  season: string;
  episode: string;
}

export default async function WatchPage({ params }: { params: Params }) {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();
  const title = await getTitleBySlug(params.slug);
  if (!title) notFound();

  const seasonNumber = Number(params.season) || 1;
  const episodeNumber = Number(params.episode) || 1;

  const season = title.seasons.find((s) => s.number === seasonNumber);
  const episode = season?.episodes.find((e) => e.number === episodeNumber);

  if (!season || !episode) notFound();

  // Flatten once so prev/next does not have to reason about season boundaries.
  const ordered = title.seasons.flatMap((s) =>
    s.episodes.map((e) => ({
      season: s.number,
      number: e.number,
      playable: e.sources.length > 0,
    })),
  );
  const index = ordered.findIndex((e) => e.season === seasonNumber && e.number === episodeNumber);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  // Where this user left off, so the player can seek. Only meaningful for a
  // direct stream — an <iframe> embed has its own player and its own clock.
  const progress = user
    ? await prisma.playProgress.findUnique({
        where: { userId_episodeId: { userId: user.id, episodeId: episode.id } },
        select: { seconds: true },
      })
    : null;
  const startAt = progress?.seconds ?? 0;
  const resumable =
    startAt > 10 &&
    (!episode.runtime || startAt < episode.runtime * 60 - 30);

  // Which of this season's episodes this user has touched, for the picker.
  const watchedEpisodes = new Set<number>();
  if (user) {
    const rows = await prisma.playProgress.findMany({
      where: {
        userId: user.id,
        seconds: { gte: 15 },
        episode: { season: { id: season.id } },
      },
      select: { episode: { select: { number: true } } },
    });
    for (const r of rows) watchedEpisodes.add(r.episode.number);
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
              {title.titleAr || title.originalTitle}
            </h1>
            <p className="tabular text-sm text-ink-500 dark:text-ink-400">
              {dict.common.seasonOf} {seasonNumber} · {dict.common.episode} {episodeNumber}
              {episode.name ? ` — ${episode.name}` : ''}
            </p>
          </div>
          <Link
            href={`/title/${title.slug}`}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-ink-700"
          >
            {dict.watch.backToDetail}
          </Link>
        </div>

        <VideoPlayer
          startAt={resumable ? startAt : 0}
          episodeId={user ? episode.id : undefined}
          signedIn={Boolean(user)}
          sources={episode.sources.map((s) => ({
            id: s.id,
            provider: s.provider,
            url: s.url,
            streamUrl: s.streamUrl,
            kind: s.kind,
            quality: s.quality,
            language: s.language,
          }))}
          labels={{
            unavailable: dict.watch.unavailable,
            openSource: dict.watch.openSource,
            noStreams: dict.common.noStreams,
          }}
        />

        <nav className="flex items-center justify-between gap-3">
          {prev ? (
            <Link
              href={`/watch/${title.slug}/${prev.season}/${prev.number}`}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm transition hover:bg-ink-100 dark:border-ink-700 dark:hover:bg-ink-800"
            >
              {dict.watch.previousEpisode}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`/watch/${title.slug}/${next.season}/${next.number}`}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {dict.watch.nextEpisode}
            </Link>
          ) : (
            <span />
          )}
        </nav>

        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            {dict.detail.episodes}
          </h2>
          <ul className="flex gap-2 overflow-x-auto pb-2">
            {season.episodes.map((e) => {
              const active = e.number === episodeNumber;
              return (
                <li key={e.id}>
                  <Link
                    href={`/watch/${title.slug}/${seasonNumber}/${e.number}`}
                    aria-current={active ? 'true' : undefined}
                    className={
                      active
                        ? 'tabular block h-10 w-10 rounded-lg bg-brand-600 text-center text-sm font-bold leading-10 text-white'
                        : 'tabular block h-10 w-10 rounded-lg border border-ink-200 text-center text-sm leading-10 text-ink-600 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
                    }
                  >
                    {e.number}
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Mark which episodes are part-watched so the picker is not a wall of
              identical squares once a season is halfway through. */}
          {user && watchedEpisodes.size > 0 ? (
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {dict.detail.continueWatching}:{' '}
              {[...watchedEpisodes]
                .sort((a, b) => a - b)
                .map((n) => `E${n}`)
                .join(' · ')}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
