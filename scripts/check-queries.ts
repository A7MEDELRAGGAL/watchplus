/* eslint-disable no-console */
/**
 * Exercises every read path the pages use, against the real database.
 *
 *   npm run check:queries
 *
 * The scraper has been run and the build passes, but the *reading* side had
 * never executed against populated rows: home rows, browse facets, title
 * detail, and search were all written against an empty catalogue. An empty
 * table returns no rows and no errors, so every one of those bugs would only
 * have appeared after deploying to a database with content in it.
 *
 * `queries.ts` deliberately does not import `next/headers`, which is what makes
 * this runnable outside a request. Assert the *shape and content* of the
 * results, not just that a call did not throw — a query that returns 20 rows of
 * nulls is not a passing query.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import {
  getRows,
  listTitles,
  getTitleBySlug,
  searchTitles,
  collectGenres,
  displayTitle,
  SORT_KEYS,
} from '../src/lib/queries';

let failures = 0;

function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures += 1;
  console.log(`    ${ok ? 'pass' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  const total = await prisma.title.count();
  console.log(`\n  reading paths against ${total} real title(s)\n`);

  // ── Home rows ────────────────────────────────────────────────────────────
  console.log('  getRows()');
  const rows = await getRows(6);
  check('returns 4 rows', rows.length === 4, `got ${rows.length}`);
  const [popular, newest, topRated, byYear] = rows;
  for (const [name, row] of [
    ['popular', popular],
    ['newest', newest],
    ['top rated', topRated],
    ['by year', byYear],
  ] as const) {
    const withTitle = row.filter((c) => c && (c.titleAr || c.originalTitle));
    check(
      `${name}: every card has a display title`,
      withTitle.length === row.length,
      `${withTitle.length}/${row.length}`,
    );
    check(
      `${name}: every card has a slug`,
      row.every((c) => !!c.slug),
      row.filter((c) => !c.slug).length ? 'some slugs empty' : '',
    );
    check(
      `${name}: every card has a poster`,
      row.every((c) => !!c.posterUrl),
      row.filter((c) => !c.posterUrl).length ? 'some posters missing' : '',
    );
  }
  check(
    'popular row is not empty',
    popular.length > 0,
    `${popular.length} cards`,
  );

  // ── Browse / facets ──────────────────────────────────────────────────────
  console.log('\n  listTitles()');
  const first = await listTitles({ perPage: 10, page: 1 });
  check('returns a result object', !!first && 'items' in first);
  const items = (first as { items: { slug: string; titleAr: string | null; originalTitle: string }[] }).items;
  check('page 1 is populated', items.length > 0, `${items.length} items`);
  check('has a total for pagination', typeof (first as { total: number }).total === 'number',
    `total=${(first as { total: number }).total}`);

  for (const sort of SORT_KEYS) {
    const r = await listTitles({ sort, perPage: 6 });
    const it = (r as { items: unknown[] }).items;
    check(`sort=${sort} returns rows`, it.length > 0, `${it.length}`);
  }

  const genreSample = await prisma.title.findMany({ select: { genres: true } });
  const genres = collectGenres(genreSample);
  check('collectGenres found genres', genres.length > 0, `${genres.length} distinct`);
  check(
    'every genre has a usable slug for the facet link',
    genres.every((g) => !!(g.slug || g.name)),
    genres.filter((g) => !g.slug && !g.name).length ? 'some unusable' : '',
  );

  const target = genres.find((g) => g.slug);
  if (target) {
    const filtered = await listTitles({ genre: target.slug, perPage: 48 });
    const it = (filtered as { items: { genres: string | null }[] }).items;
    const total = (first as { total: number }).total;
    // Compare against the catalogue total, not against page 1's size — the
    // filtered page is allowed to be a different length than page 1.
    check(
      `genre filter "${target.name}" is a non-empty subset of the catalogue`,
      it.length > 0 && it.length <= total,
      `${it.length} of ${total}`,
    );
    // The facet is a LIKE over JSON text, so confirm the rows really match
    // rather than trusting the count. A substring probe is what the query
    // itself uses, so this is checking the rows agree with the filter.
    const needle = target.name.toLowerCase().slice(0, 5);
    const actuallyMatch = it.filter((t) => (t.genres ?? '').toLowerCase().includes(needle));
    check(
      `genre filter returns rows that really contain the genre`,
      actuallyMatch.length === it.length,
      `${actuallyMatch.length}/${it.length} matched`,
    );
  } else {
    console.log('    skip  no genre with a slug to filter on');
  }

  const year = await prisma.title.findFirst({
    where: { releaseYear: { not: null } },
    select: { releaseYear: true },
  });
  if (year?.releaseYear) {
    const byYearRes = await listTitles({ year: year.releaseYear, perPage: 24 });
    const it = (byYearRes as { items: unknown[] }).items;
    check(`year filter ${year.releaseYear} returns rows`, it.length > 0, `${it.length}`);
  }

  // Same page size on both pages, or the ranges overlap and this compares the
  // wrong two slices of the catalogue.
  const PER = 6;
  const pg1 = await listTitles({ perPage: PER, page: 1 });
  const pg2 = await listTitles({ perPage: PER, page: 2 });
  const pg1slugs = new Set((pg1 as { items: { slug: string }[] }).items.map((i) => i.slug));
  const pg2items = (pg2 as { items: { slug: string }[] }).items;
  check(
    `page 2 (perPage=${PER}) does not repeat page 1`,
    pg2items.length > 0 && pg2items.every((i) => !pg1slugs.has(i.slug)),
    pg2items.length
      ? `${pg2items.filter((i) => pg1slugs.has(i.slug)).length} of ${pg2items.length} overlapped`
      : 'page 2 empty',
  );

  const beyond = await listTitles({ perPage: PER, page: 99 });
  check(
    'a page past the end returns empty rather than wrapping',
    (beyond as { items: unknown[] }).items.length === 0,
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  console.log('\n  getTitleBySlug()');
  const withSeasons = await prisma.title.findFirst({
    where: { seasons: { some: {} } },
    orderBy: { totalEpisodes: { sort: 'desc', nulls: 'last' } },
    select: { slug: true, originalTitle: true },
  });  if (withSeasons) {
    const d = await getTitleBySlug(withSeasons.slug);
    check('resolves by slug', !!d, withSeasons.slug);
    if (d) {
      check('has seasons', (d.seasons?.length ?? 0) > 0, `${d.seasons?.length} seasons`);
      const eps = (d.seasons ?? []).reduce((n, s) => n + (s.episodes?.length ?? 0), 0);
      check('seasons carry episodes', eps > 0, `${eps} episodes`);
      check('every episode has a number', (d.seasons ?? []).every((s) => (s.episodes ?? []).every((e) => e.number > 0)));
      check('sources list present', Array.isArray(d.sources), `${d.sources?.length} source(s)`);
      check('genres parse to objects', Array.isArray(d.genres), `${d.genres?.length}`);
      check('overview present', !!d.overview, d.overview ? `${d.overview.length} chars` : 'EMPTY');
      check(
        'displayTitle() falls back sensibly in both locales',
        !!displayTitle(d, 'ar') && !!displayTitle(d, 'en'),
        `ar="${displayTitle(d, 'ar').slice(0, 24)}" en="${displayTitle(d, 'en').slice(0, 24)}"`,
      );
    }
  } else {
    console.log('    skip  no title with seasons in the database');
  }

  const missing = await getTitleBySlug('this-slug-does-not-exist-12345');
  check('unknown slug returns null, not a throw', missing === null || missing === undefined);

  // ── Search ───────────────────────────────────────────────────────────────
  console.log('\n  searchTitles()');
  const seed = await prisma.title.findFirst({
    where: { searchBlob: { not: null } },
    select: { originalTitle: true, searchBlob: true },
  });
  if (seed?.originalTitle) {
    const word = seed.originalTitle.split(/\s+/).find((w) => w.length >= 4) ?? seed.originalTitle;
    const res = await searchTitles(word);
    check(`"${word.slice(0, 24)}" returns results`, res.length > 0, `${res.length} hits`);
    check('every hit has a slug', res.every((r) => !!r.slug));
    check('every hit has a display title', res.every((r) => !!(r.titleAr || r.originalTitle)));
  }
  check('one-character query is rejected', (await searchTitles('a')).length === 0);
  check('empty query is rejected', (await searchTitles('   ')).length === 0);
  const nonsense = await searchTitles('zzzqqqxxxnotathing');
  check('nonsense query returns empty, not everything', nonsense.length === 0, `${nonsense.length} hits`);

  console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('  query verification crashed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
