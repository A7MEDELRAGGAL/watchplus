import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { VideoPlayer } from '@/components/video-player';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTitleBySlug, canonicalSlug } from '@/lib/queries';

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
  if (canonicalSlug(params.slug) !== title.slug) {
    permanentRedirect(
      `/watch/${encodeURIComponent(title.slug)}/${params.season}/${params.episode}`,
    );
  }

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
    // غرفة المشاهدة داكنة دائمًا (class strategy يجعل dark: يعمل هنا مهما كان الثيم)
    <div className="dark min-h-dvh bg-ink-950 text-ink-100">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-6 py-6">
        {/* cinema header: poster thumb + title + position */}
        <div className="flex items-center gap-4">
          {title.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/img?url=${encodeURIComponent(title.posterUrl)}&w=160&q=60`}
              alt=""
              className="h-20 w-14 shrink-0 rounded-xl object-cover shadow-card"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <Link
              href={`/title/${title.slug}`}
              className="truncate text-lg font-black tracking-tight hover:text-brand-400 sm:text-2xl"
            >
              {title.titleAr || title.originalTitle}
            </Link>
            <p className="tabular mt-0.5 text-sm text-ink-400">
              {dict.common.seasonOf} {seasonNumber} · {dict.common.episode} {episodeNumber}
              {episode.name ? ` — ${episode.name}` : ''}
            </p>
          </div>
          <Link
            href={`/title/${title.slug}`}
            className="shrink-0 rounded-xl border border-ink-700 px-3 py-1.5 text-sm text-ink-300 transition hover:bg-ink-800"
          >
            {dict.watch.backToDetail}
          </Link>
        </div>

        {/* cinema frame */}
        <div className="overflow-hidden rounded-3xl border border-ink-800 bg-black shadow-card">
          <VideoPlayer
            startAt={resumable ? startAt : 0}
            episodeId={user ? episode.id : undefined}
            signedIn={Boolean(user)}
            sources={episode.sources.map((s) => ({
              id: s.id,
              provider: s.provider,
              name: s.name,
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
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          {/* episodes rail */}
          <section className="card space-y-3 p-4 !bg-ink-900 dark:!border-ink-800">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-400">
                {dict.detail.episodes}
              </h2>
              <div className="flex gap-2">
                {prev ? (
                  <Link
                    href={`/watch/${title.slug}/${prev.season}/${prev.number}`}
                    className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs transition hover:bg-ink-800"
                  >
                    {dict.watch.previousEpisode}
                  </Link>
                ) : null}
                {next ? (
                  <Link
                    href={`/watch/${title.slug}/${next.season}/${next.number}`}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-500"
                  >
                    {dict.watch.nextEpisode}
                  </Link>
                ) : null}
              </div>
            </div>
            <ul className="grid max-h-72 grid-cols-5 gap-2 overflow-y-auto sm:grid-cols-8 lg:grid-cols-6">
              {season.episodes.map((e) => {
                const active = e.number === episodeNumber;
                const seen = watchedEpisodes.has(e.number);
                const playable = e.sources.length > 0;
                return (
                  <li key={e.id}>
                    <Link
                      href={`/watch/${title.slug}/${seasonNumber}/${e.number}`}
                      aria-current={active ? 'true' : undefined}
                      className={
                        active
                          ? 'tabular block rounded-xl bg-brand-600 py-2.5 text-center text-sm font-black text-white shadow-card'
                          : seen
                            ? 'tabular block rounded-xl border border-brand-800 bg-brand-950 py-2.5 text-center text-sm text-brand-300 transition hover:bg-brand-900'
                            : playable
                              ? 'tabular block rounded-xl border border-ink-700 py-2.5 text-center text-sm text-ink-300 transition hover:border-brand-600 hover:text-white'
                              : 'tabular block rounded-xl border border-ink-800 py-2.5 text-center text-sm text-ink-600'
                      }
                    >
                      {e.number}
                    </Link>
                  </li>
                );
              })}
            </ul>
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

          {/* side info */}
          <aside className="card h-fit space-y-3 p-4 !bg-ink-900 dark:!border-ink-800">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-400">
              {dict.detail.overview}
            </h2>
            <p className="line-clamp-6 text-sm leading-relaxed text-ink-300">
              {title.overview || dict.detail.noOverview}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
              {title.releaseYear ? <li className="tabular">{title.releaseYear}</li> : null}
              {typeof title.rating === 'number' ? (
                <li className="tabular font-bold text-amber-400">★ {title.rating.toFixed(1)}</li>
              ) : null}
              <li>{dict.browse.types[title.type] ?? title.type}</li>
              <li>{dict.detail.sourceCount(episode.sources.length)}</li>
            </ul>
          </aside>
        </div>
      </main>
    </div>
  );
}
