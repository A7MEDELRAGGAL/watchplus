import { prisma } from '@/lib/db';
import { toJsonText } from '@/lib/db-json';
import { fetchJson, mapLimit } from '../core/http';
import { RateLimiter, AbortError } from '../core/rate-limiter';
import { normalize } from '../normalize';
import { upsertTitle, type UpsertResult } from './upsert';
import type { Provider, ScraperLogger } from '../types';

export interface RunOptions {
  provider: Provider;
  maxPages?: number;
  concurrency?: number;
  delayMs?: number;
  dryRun?: boolean;
  trigger?: string;
  signal?: AbortSignal;
  logger?: ScraperLogger;
  /** skip catalogue walking, re-fetch only these provider ids */
  onlyIds?: string[];
}

export interface RunReport {
  provider: string;
  sourceId: string | null;
  status: 'success' | 'partial' | 'failed' | 'cancelled';
  pagesFetched: number;
  found: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  durationMs: number;
  message: string | null;
  log: RequestLog[];
}

interface RequestLog {
  url: string;
  ok: boolean;
  ms: number;
  error?: string;
}

function makeLogger(prefix: string, verbose: boolean): ScraperLogger {
  return {
    info: (m) => verbose && console.log(`  ${prefix} ${m}`),
    warn: (m) => verbose && console.warn(`  ${prefix} ! ${m}`),
    // The request log is written by the call site that knows the url; doing it
    // here too would double-count every failure.
    error: (m, err) => {
      if (verbose) console.error(`  ${prefix} x ${m} ${errText(err)}`);
    },
  };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Run one provider end to end: walk its catalogue, fetch each item, normalise it,
 * write it to the database, and record the outcome in `ScrapeRun`.
 */
export async function runProvider(opts: RunOptions): Promise<RunReport> {
  const verbose = process.env.SCRAPER_VERBOSE === '1' || process.env.NODE_ENV === 'development';
  const { provider } = opts;
  const maxPages = opts.maxPages ?? envInt('SCRAPER_MAX_PAGES', 20);
  const concurrency = opts.concurrency ?? envInt('SCRAPER_CONCURRENCY', 4);
  const dryRun = opts.dryRun ?? process.env.SCRAPER_DRY_RUN === '1';

  const started = Date.now();
  const requestLog: RequestLog[] = [];
  const logger = opts.logger ?? makeLogger(`[${provider.key}]`, verbose);

  // The provider's own declared budget wins over the global env default: a strict
  // API like AniList must not be crawled at the speed a CDN-backed source could
  // take, and 429s cost far more than a slower run.
  const declared = provider.rateLimit;
  const delayMs =
    opts.delayMs ??
    (declared ? Math.round(1000 / declared.requestsPerSecond) : envInt('SCRAPER_DELAY_MS', 350));
  const limiter = declared
    ? new RateLimiter(declared.burst ?? 2, declared.requestsPerSecond)
    : new RateLimiter(3, Math.max(0.1, 1000 / Math.max(delayMs, 1)));

  // A provider may also cap how many requests are in flight at once, which is
  // the only thing that satisfies origins that shed load with a 504.
  const parallel = provider.maxConcurrency
    ? Math.min(concurrency, provider.maxConcurrency)
    : concurrency;

  const ctx = { logger, signal: opts.signal, dryRun, limiter };
  const stats: UpsertResult = { created: 0, updated: 0, skipped: 0 };

  const report: RunReport = {
    provider: provider.key,
    sourceId: null,
    status: 'success',
    pagesFetched: 0,
    found: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
    message: null,
    log: requestLog,
  };

  // register / refresh the Source row so the admin panel can show it
  const source = await prisma.source.upsert({
    where: { key: provider.key },
    create: {
      key: provider.key,
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      priority: provider.priority,
    },
    update: {
      name: provider.name,
      kind: provider.kind,
      baseUrl: provider.baseUrl,
      priority: provider.priority,
    },
  });
  report.sourceId = source.id;

  const run = await prisma.scrapeRun.create({
    data: { sourceId: source.id, trigger: opts.trigger ?? 'manual' },
  });

  try {
    if (!provider.isConfigured()) {
      throw new Error(`${provider.name} is not configured — check its API key in .env`);
    }

    // ── 1. discover ─────────────────────────────────────────────────────────
    let items: import('../types').DiscoveredItem[] = [];

    if (opts.onlyIds?.length) {
      // Targeted re-fetch. An API provider addresses items by id alone; an HTML
      // provider still needs a url, so it is left empty and the provider will
      // report it cannot resolve one.
      items = opts.onlyIds.map((id) => ({
        providerId: id,
        url: '',
        title: id,
        kind: 'MOVIE' as const,
      }));
    } else {
      let cursor: string | undefined;

      for (let page = 0; page < maxPages; page++) {
        if (opts.signal?.aborted) throw new AbortError();

        const discovered = await provider.discover(ctx, { maxPages, cursor });
        report.pagesFetched += 1;
        items.push(...discovered.items);
        logger.info(`page ${page + 1}/${maxPages}: +${discovered.items.length} items`);

        if (discovered.hasMore === false) break;
        cursor = discovered.cursor;
        if (!cursor && page > 0) break;
      }
    }

    // de-duplicate across pages
    const seen = new Set<string>();
    items = items.filter((i) => {
      if (!i.providerId || seen.has(i.providerId)) return false;
      seen.add(i.providerId);
      return true;
    });

    report.found = items.length;
    logger.info(`${items.length} unique items discovered`);

    if (dryRun) {
      report.status = 'success';
      report.skipped = items.length;
      report.message = `dry run — ${items.length} items would be imported`;
      return finalize();
    }

    // ── 2. fetch + normalise + write ────────────────────────────────────────
    await mapLimit(items, parallel, async (item) => {
      if (opts.signal?.aborted) return;
      const t0 = Date.now();
      try {
        const detail = await provider.fetchDetail(ctx, item.providerId, item.url || undefined);
        requestLog.push({ url: item.url || `${provider.key}:${item.providerId}`, ok: true, ms: Date.now() - t0 });

        if (!detail) {
          stats.skipped += 1;
          report.skipped += 1;
          return;
        }

        const normalized = normalize(detail, provider.key, { rank: item.rank });
        await upsertTitle(normalized, provider, stats);
        report.imported += 1;
      } catch (err) {
        const where = item.url || `${provider.key}:${item.providerId}`;
        requestLog.push({ url: where, ok: false, ms: Date.now() - t0, error: errText(err) });
        report.errors += 1;
        logger.error(`failed ${where}`, err);
      }
    });

    report.updated = stats.updated;
    report.status = report.errors > 0 ? 'partial' : 'success';
    report.message = report.errors
      ? `${report.errors} item(s) failed — see log`
      : `${report.imported} item(s) synced`;
  } catch (err) {
    if (err instanceof AbortError) {
      report.status = 'cancelled';
      report.message = 'cancelled';
    } else {
      report.status = 'failed';
      report.message = errText(err);
      report.errors += 1;
      logger.error('run failed', err);
    }
  }

  return finalize();

  async function finalize(): Promise<RunReport> {
    report.durationMs = Date.now() - started;
    // keep the log bounded so a big run does not bloat the row
    const trimmed = requestLog.slice(0, 200);

    await prisma.$transaction([
      prisma.scrapeRun.update({
        where: { id: run.id },
        data: {
          status: report.status,
          finishedAt: new Date(),
          pagesFetched: report.pagesFetched,
          found: report.found,
          imported: report.imported,
          updated: report.updated,
          skipped: report.skipped,
          errors: report.errors,
          message: report.message,
          log: toJsonText(trimmed),
        },
      }),
      prisma.source.update({
        where: { key: provider.key },
        data: {
          lastRunAt: new Date(),
          lastStatus: report.status,
          lastDurationMs: report.durationMs,
          itemsFound: report.found,
          itemsImported: report.imported,
          errorCount: { increment: report.errors },
        },
      }),
    ]);

    return report;
  }
}

/**
 * Run several providers in sequence (not parallel — we do not want to hammer
 * several origins at the same time from one IP).
 */
export async function runProviders(
  providers: Provider[],
  opts: Omit<RunOptions, 'provider'> = {},
): Promise<RunReport[]> {
  const reports: RunReport[] = [];
  for (const provider of providers) {
    if (opts.signal?.aborted) break;
    reports.push(await runProvider({ ...opts, provider }));
  }
  return reports;
}

export { fetchJson };
