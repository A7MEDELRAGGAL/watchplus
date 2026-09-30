/* eslint-disable no-console */
/**
 * Offline self-test for the parts of the scraper that are easy to get subtly
 * wrong: robots.txt rule resolution and URL helpers.
 *
 *   npm test
 *
 * No network and no database — everything here is a pure function, so this runs
 * in milliseconds and can be used as a pre-commit check. The rule cases come
 * from RFC 9309 §2.2.1 and the "allow wins ties" behaviour that Google and Bing
 * both document.
 */
import assert from 'node:assert/strict';
import { parseRobots, patternToRegex } from '../src/lib/scraper/core/robots';
import { slugify, extractYear, extractRuntime, isArabic } from '../src/lib/scraper/core/html';
import {
  classify,
  sortServers,
  filterServers,
  pickDefault,
  isExpiringLink,
  isActuallyExpired,
  isDownloadable,
  isReportCategory,
  matchesKindGroup,
  type ServerRow,
} from '../src/lib/servers';
import { fixMojibake, isJunkLabel } from '../src/lib/scraper/normalize';
import { cleanEpisodeName, displaySeasonNumber, seriesKey, seasonRank } from '../src/lib/queries';
import { mergeKey } from '../src/lib/scraper/normalize';

/**
 * Applies one robots.txt to a path the way the crawler does, but without
 * fetching. Mirrors `isAllowed`, which does the same thing after loading.
 */
function allows(text: string, path: string, token = 'WatchBoxBot'): boolean {
  const { groups } = parseRobots(text);
  if (groups.length === 0) return true;

  const ua = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const matched = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  if (matched.length === 0) return true;

  let best: { allow: boolean; length: number } | null = null;
  for (const group of matched) {
    for (const rule of group.rules) {
      if (!rule.regex.test(path)) continue;
      if (
        !best ||
        rule.pattern.length > best.length ||
        (rule.pattern.length === best.length && rule.allow && !best.allow)
      ) {
        best = { allow: rule.allow, length: rule.pattern.length };
      }
    }
  }
  return best ? best.allow : true;
}

const cases: [string, string, boolean, string][] = [
  [
    'User-agent: *\nDisallow: /private',
    '/private/secret',
    false,
    'disallow prefix blocks everything under it',
  ],
  [
    'User-agent: *\nDisallow: /private',
    '/public',
    true,
    'paths outside the rule are allowed',
  ],
  [
    'User-agent: *\nDisallow:',
    '/anything',
    true,
    'an empty Disallow means allow everything',
  ],
  [
    'User-agent: *\nDisallow: /\nAllow: /public',
    '/public',
    true,
    'Allow overrides a broader Disallow',
  ],
  [
    'User-agent: *\nDisallow: /*.pdf$',
    '/docs/manual.pdf',
    false,
    '$ anchors the pattern to the end',
  ],
  [
    'User-agent: *\nDisallow: /*.pdf$',
    '/docs/manual.pdf?x=1',
    true,
    'the $ anchor does not match past a query string',
  ],
  [
    'User-agent: *\nDisallow: /*.pdf$',
    '/docs/manual.pdfx',
    true,
    'the $ anchor rejects a partial extension match',
  ],
  [
    'User-agent: *\nDisallow: /a/b/c',
    '/a/b',
    true,
    'a prefix of the disallowed path is still allowed',
  ],
  [
    'User-agent: badbot\nDisallow: /\n\nUser-agent: *\nDisallow:',
    '/x',
    true,
    'a specific group for another bot does not apply to us',
  ],
  [
    'User-agent: WatchBoxBot\nDisallow: /\n\nUser-agent: *\nDisallow:',
    '/x',
    false,
    'our named group wins over the * fallback',
  ],
  [
    'User-agent: *\nDisallow: /watch',
    '/watch/slug/1',
    false,
    'a watch path is blocked for a wildcard bot',
  ],
  [
    '# comment\nUser-agent: *\n# another\nDisallow: /x\n',
    '/x',
    false,
    'comments are ignored',
  ],
  [
    'User-agent: *\nDisallow: /a\nDisallow: /b',
    '/b',
    false,
    'repeated Disallow lines all apply',
  ],
  [
    'User-agent: *\nCrawl-delay: 5\nDisallow:',
    '/x',
    true,
    'Crawl-delay is parsed without affecting matching',
  ],
  [
    'User-agent: *\nDisallow: /a',
    '/A',
    true,
    'path matching is case-sensitive, so /a does not block /A',
  ],
];

let passed = 0;
const failures: string[] = [];

for (const [robots, path, expected, description] of cases) {
  const actual = allows(robots, path);
  if (actual === expected) {
    passed += 1;
  } else {
    failures.push(`  ${description}\n    robots: ${JSON.stringify(robots)}\n    path:   ${path}\n    expected ${expected}, got ${actual}`);
  }
}

// Sitemaps are collected from anywhere in the file, regardless of group.
{
  const { sitemaps } = parseRobots('Sitemap: https://x.test/s1.xml\nUser-agent: *\nDisallow:\nSitemap: https://x.test/s2.xml');
  assert.deepEqual(sitemaps, ['https://x.test/s1.xml', 'https://x.test/s2.xml']);
  passed += 1;
}

// Crawl-delay picks the strictest value among the groups that match us.
{
  const { groups } = parseRobots('User-agent: *\nCrawl-delay: 2\n\nUser-agent: WatchBoxBot\nCrawl-delay: 10\n');
  const mine = groups.find((g) => g.agents.includes('watchboxbot'));
  assert.equal(mine?.crawlDelay, 10);
  passed += 1;
}

// `*` spans any characters, including `/` and the empty string.
{
  const re = patternToRegex('/a/*/b');
  assert.ok(re.test('/a/x/y/b'), 'matches across path separators');
  assert.ok(re.test('/a//b'), 'matches an empty run');
  assert.ok(!re.test('/a/b'), 'still requires the literal segments either side');
  passed += 1;
}

// A dot in a path must match itself, not any character.
{
  assert.ok(!patternToRegex('/v1.0/').test('/v1x0/'));
  passed += 1;
}

// Slugs must survive Arabic titles, and stay URL-safe.
{
  assert.equal(slugify('Attack on Titan'), 'attack-on-titan');
  assert.equal(slugify('  spaced   out  '), 'spaced-out');
  assert.equal(slugify('Movie: Part 2!'), 'movie-part-2');
  assert.ok(!/[^\w-]/.test(slugify('A/B: C? D')), 'no punctuation survives');
  passed += 1;
}

// Year/runtime extraction has to cope with the shapes providers actually send.
{
  assert.equal(extractYear('(2019)'), 2019);
  assert.equal(extractYear(' aired 1994 '), 1994);
  assert.equal(extractYear('no digits'), undefined);
  assert.equal(extractRuntime('24 min'), 24);
  assert.equal(extractRuntime('1h 45m'), 105);
  assert.equal(extractRuntime('PT2H30M'), 150);
  passed += 1;
}

// Arabic detection gates the titleAr column.
{
  assert.equal(isArabic('حرب العروبة'), true);
  assert.equal(isArabic('Attack on Titan'), false);
  assert.equal(isArabic('Naruto ナルト'), false);
  passed += 1;
}

// ── servers: acceptance 1, 2, 4 ──────────────────────────────────────────
const mkRow = (over: Partial<ServerRow> & { id: string }): ServerRow => ({
  provider: 'witanime',
  label: null,
  quality: null,
  kind: 'iframe',
  url: 'https://x.test/e/1',
  streamUrl: null,
  isDead: false,
  fails: 0,
  checkedAt: null,
  ...over,
});

{
  // 1: الترتيب active ← suspect والجودة/المصدر واضحان
  const rows = [
    mkRow({ id: 'd', isDead: true }),
    mkRow({ id: 's', fails: 2, provider: 'animerco', quality: '720p' }),
    mkRow({ id: 'a', provider: 'witanime', quality: '1080p' }),
  ].map(classify);
  assert.deepEqual(sortServers(rows).map((r) => r.id), ['a', 's', 'd']);
  assert.equal(rows.find((r) => r.id === 'a')!.status, 'active');
  assert.equal(rows.find((r) => r.id === 's')!.status, 'suspect');
  passed += 1;
}

{
  // 2: فلترة الجودة والموقع تعمل على stream وdownload
  const rows = [
    mkRow({ id: 'a', quality: '1080p', provider: 'witanime', kind: 'mp4', streamUrl: 'https://x.test/f.mp4' }),
    mkRow({ id: 'b', quality: '720p', provider: 'animerco' }),
    mkRow({ id: 'c', quality: null, provider: 'witanime' }),
  ].map(classify);
  assert.deepEqual(
    filterServers(rows, { quality: '1080p', site: null, showDead: false }).map((r) => r.id),
    ['a'],
  );
  assert.deepEqual(
    filterServers(rows, { quality: null, site: 'witanime', showDead: false }).map((r) => r.id),
    ['a', 'c'],
  );
  passed += 1;
}

{
  // 3 (منطق الاختيار): الافتراضي active ثم suspect، والمنتهي فعلًا/الميت ليس صالحًا
  const pastTs = String(Math.floor(Date.now() / 1000) - 7200);
  const rows = [
    mkRow({ id: 'x', url: `https://x.test/e?expires=${pastTs}`, streamUrl: null }),
    mkRow({ id: 's', fails: 1 }),
    mkRow({ id: 'a' }),
  ].map(classify);
  assert.equal(pickDefault(rows)!.id, 'a');
  assert.equal(pickDefault(rows.filter((r) => r.id !== 'a'))!.id, 's');
  assert.equal(pickDefault([rows[0]]), null);
  passed += 1;
}

{
  // 4: dead مخفي افتراضيًا + suspect مميز (status يحمله)
  const rows = [mkRow({ id: 'd', isDead: true }), mkRow({ id: 's', fails: 1 })].map(classify);
  assert.deepEqual(
    filterServers(rows, { quality: null, site: null, showDead: false }).map((r) => r.id),
    ['s'],
  );
  assert.deepEqual(
    filterServers(sortServers(rows), { quality: null, site: null, showDead: true }).map((r) => r.id),
    ['s', 'd'],
  );
  passed += 1;
}

{
  // 5: المنتهي فعلًا ليس صالحًا + mp4 المباشر قابل للتحميل
  // (الموقّع بتاريخ مستقبلي يعمل — التوقيع وحده ليس موتًا)
  const past = Math.floor(Date.now() / 1000) - 3600;
  const future = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(isExpiringLink(`https://x.test/f.mp4?expires=${past}&token=abc`), true);
  assert.equal(isActuallyExpired(`https://x.test/f.mp4?expires=${past}`), true);
  assert.equal(isActuallyExpired(`https://x.test/f.mp4?expires=${future}&token=abc`), false);
  assert.equal(isActuallyExpired('https://x.test/embed/1'), false);
  const dl = classify(mkRow({ id: 'm', kind: 'mp4', streamUrl: 'https://x.test/f.mp4' }));
  assert.equal(isDownloadable({ kind: 'mp4', streamUrl: 'https://x.test/f.mp4' }), true);
  assert.equal(dl.isDownload, true);
  assert.equal(isDownloadable({ kind: 'iframe', streamUrl: null }), false);
  passed += 1;
}

{
  // kind mapping حسب القيم المخزنة فعلًا (iframe/mp4/page — لا stream/download)
  assert.equal(matchesKindGroup('iframe', 'stream'), true);
  assert.equal(matchesKindGroup('mp4', 'stream'), true);
  assert.equal(matchesKindGroup('mp4', 'download'), true);
  assert.equal(matchesKindGroup('page', 'download'), true);
  assert.equal(matchesKindGroup('page', 'stream'), false);
  assert.equal(matchesKindGroup('iframe', 'download'), false);
  passed += 1;
}

{
  // 6: فئات البلاغ الثلاث فقط تُقبل
  assert.equal(isReportCategory('dead-video'), true);
  assert.equal(isReportCategory('audio'), true);
  assert.equal(isReportCategory('subtitle'), true);
  assert.equal(isReportCategory('other'), false);
  assert.equal(isReportCategory(undefined), false);
  passed += 1;
}

// ── names: mojibake + episode dates + season display ──────────────────────
{
  // بناء الموجيباك برمجيًا (بلا ليترال غامض الترميز): عربي → بايتات → لاتيني
  const broken = Buffer.from('الحلقة 10', 'utf8').toString('latin1');
  assert.notEqual(broken, 'الحلقة 10');
  assert.equal(fixMojibake(broken), 'الحلقة 10');
  assert.equal(fixMojibake('الحلقة 10'), 'الحلقة 10');
  assert.equal(isJunkLabel('مشاهدة وتحميل الآن'), true);
  assert.equal(isJunkLabel('الحلقة 10'), false);
  assert.equal(cleanEpisodeName('الحلقة 3 - 2024/01/05', 3), 'الحلقة 3');
  assert.equal(cleanEpisodeName(null, 7), 'Episode 7');
  assert.equal(displaySeasonNumber('Shingeki no Kyojin Season 2', 1), 2);
  assert.equal(displaySeasonNumber('Naruto', 1), 1);
  assert.equal(seriesKey('Shingeki no Kyojin Season 2'), 'shingeki no kyojin');
  assert.equal(seasonRank('Bleach: The Movie'), 900);
  // mergeKey: نفس العمل بصياغات مختلفة يُدمج، والمواسم لا
  assert.equal(mergeKey('Bleach ( مسلسل )'), mergeKey('BLEACH'));
  assert.notEqual(mergeKey('Naruto'), mergeKey('Naruto Shippuuden'));
  assert.notEqual(mergeKey('Shingeki no Kyojin Season 2'), mergeKey('Shingeki no Kyojin Season 3'));
  passed += 1;
}

console.log(`\nself-test: ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}
