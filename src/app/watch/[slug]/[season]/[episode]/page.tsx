import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { EpisodeView, type EpisodeViewServer } from '@/components/episode-view';
import { EpisodeComments } from '@/components/episode-comments';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { displayTitle } from '@/lib/queries';
import { prisma } from '@/lib/db';
import { getTitleBySlug, canonicalSlug, cleanEpisodeName, displaySeasonNumber, hasLive } from '@/lib/queries';
import { classify, pickDefault, readFails, type ServerRow } from '@/lib/servers';
import { applyProbe, probeTarget } from '@/lib/server-health';

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

  // 1) مسار التنقل: السلسلة (لينك) ← الموسم/الإصدار ← رقم الحلقة كما ورد
  const seriesName = displayTitle(title, locale);
  const shownSeason = displaySeasonNumber(title.originalTitle, seasonNumber);
  const shownEpisode = cleanEpisodeName(episode.name, episodeNumber);

  // سيرفرات الحلقة بكل الحالات + تصنيفها (active ← suspect ← expired ← dead)
  const rows: ServerRow[] = episode.sources.map((s) => ({
    id: s.id,
    provider: s.provider,
    label: s.name,
    quality: s.quality,
    kind: s.kind,
    url: s.url,
    streamUrl: s.streamUrl,
    isDead: s.isDead,
    fails: readFails(s.headers),
    checkedAt: s.lastSyncedAt ? new Date(s.lastSyncedAt).toISOString() : null,
  }));
  let servers: EpisodeViewServer[] = rows.map((r) => ({ ...classify(r), checkedAt: r.checkedAt }));

  // فحص حي للسيرفر الافتراضي إن قدم فحصه (ساعة) — "نشط" تعني يعمل فعلًا لحظة العرض
  try {
    const def = pickDefault(servers);
    const stale = !def?.checkedAt || Date.now() - new Date(def.checkedAt).getTime() > 3600_000;
    if (def && stale) {
      const reachable = await probeTarget(def.streamUrl || def.url);
      const state = await applyProbe(def.id, reachable);
      const status = (state.isDead ? 'dead' : state.fails > 0 ? 'suspect' : 'active') as EpisodeViewServer['status'];
      servers = servers.map((s) =>
        s.id === def.id ? { ...s, status, checkedAt: new Date().toISOString() } : s,
      );
    }
  } catch {
    /* الفحص تحسين — فشله لا يكسر الصفحة أبدًا */
  }

  // سابق/تالي عبر حدود المواسم
  const ordered = title.seasons.flatMap((s) =>
    s.episodes.map((e) => ({ season: s.number, number: e.number })),
  );
  const index = ordered.findIndex((e) => e.season === seasonNumber && e.number === episodeNumber);
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const nextHref = next ? `/watch/${title.slug}/${next.season}/${next.number}` : null;

  // استئناف المشاهدة للستريم المباشر
  const progress = user
    ? await prisma.playProgress.findUnique({
        where: { userId_episodeId: { userId: user.id, episodeId: episode.id } },
        select: { seconds: true },
      })
    : null;
  const startAt = progress?.seconds ?? 0;
  const resumable = startAt > 10 && (!episode.runtime || startAt < episode.runtime * 60 - 30);

  // حلقات الموسم + علامات المشاهَدة
  const watchedEpisodes = new Set<number>();
  if (user) {
    const rws = await prisma.playProgress.findMany({
      where: {
        userId: user.id,
        seconds: { gte: 15 },
        episode: { season: { id: season.id } },
      },
      select: { episode: { select: { number: true } } },
    });
    for (const r of rws) watchedEpisodes.add(r.episode.number);
  }

  return (
    // غرفة المشاهدة داكنة دائمًا
    <div className="dark min-h-dvh bg-ink-950 text-ink-100">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-8 py-6">
        {/* 1) مسار التنقل */}
        <nav aria-label="breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm">
          <Link
            href={`/title/${title.slug}`}
            className="min-w-0 max-w-full truncate font-bold text-brand-400 hover:underline"
          >
            {seriesName}
          </Link>
          <span aria-hidden className="text-ink-600">
            ←
          </span>
          <span className="text-ink-300">
            {season.name && !/^season\s*1$/i.test(season.name) && season.name !== 'All episodes'
              ? season.name
              : `${dict.common.seasonOf} ${shownSeason}`}
          </span>
          <span aria-hidden className="text-ink-600">
            ←
          </span>
          <span className="tabular min-w-0 truncate font-bold text-white">
            {shownEpisode}
          </span>
        </nav>

        {/* 2+3+4) المشغّل + السيرفرات + التحميل + البلاغ */}
        <EpisodeView
          episodeId={episode.id}
          servers={servers}
          nextHref={nextHref}
          locale={locale}
          startAt={resumable ? startAt : 0}
          signedIn={Boolean(user)}
          labels={{
            servers: dict.watch.servers,
            downloads: dict.watch.downloads,
            autoplay: dict.watch.autoplay,
            showDead: dict.watch.showDead,
            hideDead: dict.watch.hideDead,
            report: dict.watch.report,
            reportTitle: dict.watch.reportTitle,
            reportSent: dict.watch.reportSent,
            reportFailed: dict.watch.reportFailed,
            retry: dict.common.retry,
            noServers: dict.watch.noServers,
            allDead: dict.watch.allDead,
            recheckAt: dict.watch.recheckAt,
            needsRefresh: dict.watch.needsRefresh,
            requestRefresh: dict.watch.requestRefresh,
            refreshQueued: dict.watch.refreshQueued,
            download: dict.watch.downloadNow,
            openPlayer: dict.watch.title,
            unavailable: dict.watch.unavailable,
            host: dict.watch.colHost,
            quality: dict.watch.colQuality,
            size: dict.watch.colSize,
            source: dict.watch.colSource,
            status: dict.watch.colStatus,
            action: dict.watch.colAction,
            all: dict.browse.all,
          }}
          reportLabels={{
            deadVideo: dict.watch.repDeadVideo,
            audio: dict.watch.repAudio,
            subtitle: dict.watch.repSubtitle,
          }}
        />

        {/* 5) سابق/تالي + قائمة حلقات الموسم */}
        <section className="card space-y-4 p-4 !bg-ink-900 dark:!border-ink-800">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-black">
              <span
                aria-hidden
                className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700"
              />
              {dict.detail.episodes}
              <span className="tabular text-sm font-normal text-ink-500">{season.episodes.length}</span>
            </h2>
            <div className="flex gap-2">
              {prev ? (
                <Link
                  href={`/watch/${title.slug}/${prev.season}/${prev.number}`}
                  className="rounded-xl border border-ink-700 px-4 py-2 text-xs font-bold transition hover:bg-ink-800"
                >
                  {dict.watch.previousEpisode}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/watch/${title.slug}/${next.season}/${next.number}`}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-brand-500"
                >
                  {dict.watch.nextEpisode}
                </Link>
              ) : (
                <span />
              )}
            </div>
          </div>
          <ul className="grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8">
            {season.episodes.map((e) => {
              const active = e.number === episodeNumber;
              const seen = watchedEpisodes.has(e.number);
              const live = hasLive(e);
              const label = cleanEpisodeName(e.name, e.number);
              return (
                <li key={e.id} title={label}>
                  <Link
                    href={`/watch/${title.slug}/${seasonNumber}/${e.number}`}
                    aria-current={active ? 'true' : undefined}
                    className={
                      active
                        ? 'tabular block rounded-xl bg-brand-600 py-3 text-center text-sm font-black text-white shadow-card'
                        : seen
                          ? 'tabular block rounded-xl border border-brand-800 bg-brand-950 py-3 text-center text-sm text-brand-300 transition hover:bg-brand-900'
                          : live
                            ? 'tabular block rounded-xl border border-ink-700 py-3 text-center text-sm text-ink-300 transition hover:border-brand-600 hover:text-white'
                            : 'tabular block rounded-xl border border-ink-800 py-3 text-center text-sm text-ink-600'
                    }
                  >
                    {e.number}
                  </Link>
                  {e.airDate ? (
                    <p className="tabular mt-1 truncate text-center text-[10px] text-ink-600">
                      {new Date(e.airDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        {/* 6) بطاقة معلومات السلسلة */}
        <section className="card flex gap-4 p-4 !bg-ink-900 dark:!border-ink-800 sm:p-5">
          {title.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/img?url=${encodeURIComponent(title.posterUrl)}&w=240&q=60`}
              alt=""
              className="h-36 w-24 shrink-0 rounded-xl object-cover"
            />
          ) : null}
          <div className="min-w-0 space-y-2">
            <Link href={`/title/${title.slug}`} className="text-lg font-black hover:text-brand-400">
              {seriesName}
            </Link>
            <ul className="flex flex-wrap gap-2 text-[11px] font-bold">
              <li className="rounded-full bg-ink-800 px-2.5 py-1">
                {dict.browse.types[title.type] ?? title.type}
              </li>
              <li
                className={`rounded-full px-2.5 py-1 text-white ${title.isOngoing ? 'bg-brand-600' : 'bg-ink-600'}`}
              >
                {title.isOngoing ? dict.detail.ongoing : dict.detail.ended}
              </li>
              {typeof title.rating === 'number' ? (
                <li className="tabular rounded-full bg-ink-800 px-2.5 py-1 text-amber-400">
                  ★ {title.rating.toFixed(1)}
                </li>
              ) : null}
            </ul>
            <p className="line-clamp-3 text-sm leading-relaxed text-ink-400">
              {title.overview || dict.detail.noOverview}
            </p>
          </div>
        </section>

        {/* 7) تعليقات وتقييم الحلقة */}
        <EpisodeComments
          episodeId={episode.id}
          signedIn={Boolean(user)}
          labels={{
            title: dict.watch.comments,
            loginToComment: dict.watch.loginToComment,
            placeholder: dict.watch.commentPh,
            send: dict.watch.commentSend,
            noComments: dict.watch.noComments,
            yourRating: dict.watch.yourRating,
          }}
        />
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
