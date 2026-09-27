/* eslint-disable no-console */
/**
 * Scrape runner CLI.
 *
 *   npm run scrape                 all configured providers
 *   npm run scrape -- anilist      just one
 *   npm run scrape:dry             print what would happen, write nothing
 *   npm run scrape -- --pages 5    limit listing pages per provider
 *   npm run scrape -- --ids 21,529  re-fetch specific provider ids
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { allProviders, getProvider, selectedProviders } from '../src/lib/scraper/core/registry';
import { runProvider } from '../src/lib/scraper/pipeline/run';
import type { Provider } from '../src/lib/scraper/types';

function parseArgs(argv: string[]) {
  const providers: string[] = [];
  const ids: string[] = [];
  let pages: number | undefined;
  let dry = false;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry') dry = true;
    else if (arg === '-v' || arg === '--verbose') verbose = true;
    else if (arg === '--pages') pages = Number(argv[++i]);
    else if (arg === '--ids') ids.push(...String(argv[++i] ?? '').split(',').filter(Boolean));
    else if (!arg.startsWith('-')) providers.push(arg);
  }

  return { providers, ids, pages, dry, verbose };
}

function pad(value: string, width: number) {
  return value.padEnd(width);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  process.env.SCRAPER_DRY_RUN = args.dry ? '1' : '0';
  if (args.verbose) process.env.SCRAPER_VERBOSE = '1';

  console.log('\n  registered providers');
  console.log('  ' + '-'.repeat(64));
  for (const p of allProviders()) {
    const ok = p.isConfigured();
    console.log(
      `  ${ok ? 'x' : ' '} ${pad(p.key, 14)} ${pad(p.kind, 6)} ${pad(p.priority.toString(), 5)} ${p.name}${
        ok ? '' : '  (needs setup — skipped)'
      }`,
    );
  }
  console.log('');

  const providers: Provider[] = args.providers.length
    ? args.providers
        .map((key) => {
          const p = getProvider(key);
          if (!p) throw new Error(`unknown provider "${key}". Run without args to list them.`);
          return p;
        })
        .filter((p) => p.isConfigured())
    : selectedProviders();

  if (!providers.length) {
    console.error('  No usable providers. Set TMDB_API_KEY, or declare a source in SOURCES_JSON.');
    process.exit(1);
  }

  const started = Date.now();
  const reports = [];

  for (const provider of providers) {
    console.log(`  running ${provider.name} (${provider.key})...`);
    const report = await runProvider({
      provider,
      maxPages: args.pages,
      dryRun: args.dry,
      trigger: 'cli',
      onlyIds: args.ids.length ? args.ids : undefined,
    });
    reports.push(report);
    console.log(
      `    ${report.status} — found ${report.found}, imported ${report.imported}, updated ${report.updated}, skipped ${report.skipped}, errors ${report.errors} in ${report.durationMs}ms`,
    );
    if (report.message) console.log(`    ${report.message}`);
  }

  console.log('\n  ' + '-'.repeat(64));
  const totals = reports.reduce(
    (acc, r) => ({
      found: acc.found + r.found,
      imported: acc.imported + r.imported,
      updated: acc.updated + r.updated,
      errors: acc.errors + r.errors,
    }),
    { found: 0, imported: 0, updated: 0, errors: 0 },
  );
  console.log(
    `  total in ${((Date.now() - started) / 1000).toFixed(1)}s: ${totals.imported} new, ${totals.updated} updated, ${totals.errors} errors`,
  );

  const count = await prisma.title.count();
  console.log(`  database now holds ${count} title(s)\n`);

  await prisma.$disconnect();

  // A run that imported something is a success even if individual items failed:
  // rate limits are routine, and a red CI run on every 429 trains you to ignore
  // the workflow. Only a total wipeout is a real failure.
  const allFailed = reports.every((r) => r.status === 'failed');
  if (allFailed) {
    console.error('  every provider failed - treating this run as a failure\n');
  } else if (totals.errors > 0) {
    console.log(`  ${totals.errors} item(s) failed but the run succeeded overall\n`);
  }
  process.exit(allFailed ? 1 : 0);
}

main().catch(async (err) => {
  console.error('\n  scrape failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
