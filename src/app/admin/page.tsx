import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { requireAdmin } from '@/lib/auth';
import { allProviders } from '@/lib/scraper/core/registry';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Admin · WatchBox', robots: { index: false } };

/** Compact "1.2k" / "3.4M" so the stat tiles stay one line at any count. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function ago(date: Date | null, locale: string): string {
  if (!date) return '—';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return fmt.format(-seconds, 'second');
  if (seconds < 3600) return fmt.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return fmt.format(-Math.floor(seconds / 3600), 'hour');
  return fmt.format(-Math.floor(seconds / 86400), 'day');
}

function statusTone(status: string | null): string {
  if (status === 'ok') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'error' || status === 'failed') return 'text-red-600 dark:text-red-400';
  if (status === 'partial') return 'text-amber-600 dark:text-amber-400';
  return 'text-ink-500 dark:text-ink-400';
}

export default async function AdminPage() {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    // requireAdmin throws for both signed-out and non-admin; the honest split is
    // "not allowed" either way, and leaking which is a needless tell.
    redirect('/login');
  }

  const locale = getLocale();
  const dict = getDictionary(locale);
  const intl = locale === 'ar' ? 'ar-EG' : 'en-US';

  const [titles, episodes, sources, users, favorites, watchlist, progress, runs, sourceRows, typeBreakdown] =
    await Promise.all([
      prisma.title.count(),
      prisma.episode.count(),
      prisma.episodeSource.count(),
      prisma.user.count(),
      prisma.favorite.count(),
      prisma.watchlist.count(),
      prisma.playProgress.count(),
      prisma.scrapeRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          trigger: true,
          status: true,
          startedAt: true,
          found: true,
          imported: true,
          updated: true,
          skipped: true,
          errors: true,
          message: true,
          source: { select: { key: true, name: true } },
        },
      }),
      prisma.source.findMany({
        orderBy: { priority: 'asc' },
        select: {
          key: true,
          name: true,
          kind: true,
          enabled: true,
          lastStatus: true,
          lastRunAt: true,
          itemsFound: true,
          itemsImported: true,
          errorCount: true,
        },
      }),
      prisma.title.groupBy({ by: ['type'], _count: { _all: true } }),
    ]);

  /**
   * One row per provider the scraper could actually run, joined with whatever
   * the last run recorded. A provider with no Source row yet shows "never run"
   * rather than vanishing, which is the case that needs diagnosing.
   */
  const rates = new Map(
    allProviders().map((p) => [p.key, p.rateLimit?.requestsPerSecond ?? null]),
  );
  const providerRows = [
    ...sourceRows.map((s) => ({ ...s, rate: rates.get(s.key) ?? null })),
    ...[...rates.keys()]
      .filter((key) => !sourceRows.some((s) => s.key === key))
      .map((key) => ({
        key,
        name: key,
        kind: 'api',
        enabled: true,
        lastStatus: null,
        lastRunAt: null,
        itemsFound: 0,
        itemsImported: 0,
        errorCount: 0,
        rate: rates.get(key) ?? null,
      })),
  ];

  const stats = [
    { label: dict.admin.titles, value: compact(titles) },
    { label: dict.admin.episodes, value: compact(episodes) },
    { label: dict.admin.sources, value: compact(sources) },
    { label: dict.admin.users, value: compact(users) },
  ];

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-10 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{dict.admin.title}</h1>
          <Link
            href="/"
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm dark:border-ink-700"
          >
            {dict.nav.home}
          </Link>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-ink-200 p-5 dark:border-ink-800"
            >
              <p className="text-xs uppercase tracking-wide text-ink-500">{s.label}</p>
              <p className="tabular mt-1 text-3xl font-black">{s.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-ink-200 p-5 dark:border-ink-800">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-500">
              {dict.admin.content}
            </h2>
            <ul className="space-y-2 text-sm">
              {typeBreakdown.map((t) => (
                <li key={t.type} className="flex items-center justify-between">
                  <span>{dict.browse.types[t.type] ?? t.type}</span>
                  <span className="tabular text-ink-500">{compact(t._count._all)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-ink-200 p-5 dark:border-ink-800">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-500">
              {dict.admin.library}
            </h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between">
                <span>{dict.library.favorites}</span>
                <span className="tabular text-ink-500">{compact(favorites)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>{dict.library.watchlist}</span>
                <span className="tabular text-ink-500">{compact(watchlist)}</span>
              </li>
              <li className="flex items-center justify-between">
                <span>{dict.library.continueWatching}</span>
                <span className="tabular text-ink-500">{compact(progress)}</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            {dict.admin.providers}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-ink-200 dark:border-ink-800">
            <table className="w-full min-w-[640px] text-start text-sm">
              <thead className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500 dark:border-ink-800">
                <tr>
                  <th className="px-4 py-2.5 text-start font-semibold">{dict.admin.providers}</th>
                  <th className="px-4 py-2.5 text-start font-semibold">Kind</th>
                  <th className="px-4 py-2.5 text-end font-semibold">Rate</th>
                  <th className="px-4 py-2.5 text-end font-semibold">Found</th>
                  <th className="px-4 py-2.5 text-end font-semibold">Imported</th>
                  <th className="px-4 py-2.5 text-end font-semibold">Errors</th>
                  <th className="px-4 py-2.5 text-end font-semibold">Last run</th>
                </tr>
              </thead>
              <tbody>
                {providerRows.map((p) => (
                  <tr
                    key={p.key}
                    className="border-b border-ink-100 last:border-0 dark:border-ink-900"
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{p.name}</span>
                      <span className="ms-2 text-xs text-ink-400">{p.key}</span>
                      {!p.enabled ? (
                        <span className="ms-2 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500 dark:bg-ink-800">
                          disabled
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-ink-500">{p.kind}</td>
                    <td className="tabular px-4 py-2.5 text-end text-ink-500">
                      {p.rate !== null ? `${p.rate}/s` : '—'}
                    </td>
                    <td className="tabular px-4 py-2.5 text-end text-ink-500">{p.itemsFound}</td>
                    <td className="tabular px-4 py-2.5 text-end text-emerald-600">
                      {p.itemsImported}
                    </td>
                    <td className="tabular px-4 py-2.5 text-end text-red-600">{p.errorCount}</td>
                    <td className="px-4 py-2.5 text-end">
                      <span className={statusTone(p.lastStatus)}>{p.lastStatus ?? '—'}</span>
                      <span className="ms-2 text-xs text-ink-400">{ago(p.lastRunAt, intl)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {providerRows.length === 0 ? (
            <p className="text-sm text-ink-500">No providers registered.</p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">
            {dict.admin.recentRuns}
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-500 dark:text-ink-400">{dict.admin.noRuns}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-ink-200 dark:border-ink-800">
              <table className="w-full min-w-[760px] text-start text-sm">
                <thead className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500 dark:border-ink-800">
                  <tr>
                    <th className="px-4 py-2.5 text-start font-semibold">Source</th>
                    <th className="px-4 py-2.5 text-start font-semibold">Trigger</th>
                    <th className="px-4 py-2.5 text-start font-semibold">Status</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Found</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Imported</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Updated</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Skipped</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Errors</th>
                    <th className="px-4 py-2.5 text-end font-semibold">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-ink-100 last:border-0 dark:border-ink-900"
                    >
                      <td className="px-4 py-2.5 font-medium">{r.source?.name ?? '—'}</td>
                      <td className="px-4 py-2.5 text-ink-500">{r.trigger}</td>
                      <td className={`px-4 py-2.5 font-semibold ${statusTone(r.status)}`}>
                        {r.status}
                        {r.message ? (
                          <span
                            className="ms-1 font-normal text-ink-400"
                            title={r.message}
                          >
                            · {r.message.slice(0, 40)}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular px-4 py-2.5 text-end">{r.found}</td>
                      <td className="tabular px-4 py-2.5 text-end text-emerald-600">
                        {r.imported}
                      </td>
                      <td className="tabular px-4 py-2.5 text-end">{r.updated}</td>
                      <td className="tabular px-4 py-2.5 text-end text-ink-500">{r.skipped}</td>
                      <td className="tabular px-4 py-2.5 text-end text-red-600">{r.errors}</td>
                      <td className="px-4 py-2.5 text-end text-ink-500">{ago(r.startedAt, intl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-xs text-ink-400">
          Scrapes run on the GitHub Actions schedule, not from this page — the
          free-tier runner has no business being triggered by a web request.
        </p>
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
