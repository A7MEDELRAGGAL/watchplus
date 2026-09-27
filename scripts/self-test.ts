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

console.log(`\nself-test: ${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}
