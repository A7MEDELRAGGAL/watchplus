/* eslint-disable no-console */
/**
 * probe — point it at a listing page, get back a starter source config.
 *
 *   npm run probe -- https://example.com/browse
 *
 * The generic provider needs CSS selectors, and hand-writing them by reading
 * markup is the slowest part of adding a source. This does the first pass:
 * fetches the page, checks robots.txt, looks for JSON-LD, guesses which
 * repeating element is a catalogue card, and guesses the title/link/poster
 * inside it. Then it prints a config you paste into SOURCES_JSON.
 *
 * It guesses. Review the output before trusting it — the point is to save an
 * hour of looking at markup, not to remove the need to look at markup.
 */
import 'dotenv/config';
import { fetchText, NAVIGATION_HEADERS, HttpError } from '../src/lib/scraper/core/http';
import { crawlDelay, isAllowed, sitemaps } from '../src/lib/scraper/core/robots';
import { absolute, asString, clean, jsonLd, load, type Doc } from '../src/lib/scraper/core/html';

const url = process.argv[2];
if (!url) {
  console.error('usage: npm run probe -- <listing-page-url>');
  process.exit(1);
}

const origin = new URL(url).origin;

/** Candidate card containers, most specific first. */
const CANDIDATES = [
  'article', 'li.result', 'li.post', 'li.item', 'li.movie', 'li.series', 'li.card',
  'div.card', 'div.item', 'div.result', 'div.post', 'div.movie', 'div.series',
  'div.entry', 'div.release', 'div.show', 'div.title-card', 'div.content-item',
  'tr', '[class*="card"]', '[class*="item"]', '[class*="result"]', '[class*="movie"]',
  '[class*="show"]', '[class*="release"]', '[class*="post"]', '[class*="entry"]',
  '[class*="grid"] > *', 'main > div', 'section > div',
];

const TITLE_CANDIDATES = [
  'h2', 'h3', 'h4', '.title', '.name', '.card-title', '.entry-title', '[class*="title"]',
  'img[alt]',
];

function score(sel: string, $: Doc): { count: number; score: number } {
  let count = 0;
  let good = 0;

  $(sel).each((_, el) => {
    const node = $(el);
    const links = node.find('a[href]');
    if (!links.length) return;
    count += 1;
    // A card holds one link and a short piece of text. A wrapper holding twelve
    // links is a layout container, not a card, and would produce garbage.
    if (links.length > 3) return;
    const text = clean(node.text());
    if (text.length < 2 || text.length > 300) return;
    good += 1;
  });

  // Prefer many good candidates, penalise a very broad match (the whole page).
  const breadth = count > 400 ? count / 8 : count;
  return { count, score: good * 2 + breadth * 0.1 - good * 0.1 };
}

function guessTitleSelector(sel: string, $: Doc): string | undefined {
  for (const t of TITLE_CANDIDATES) {
    let hits = 0;
    const nodes = $(sel);
    nodes.each((_, el) => {
      if ($(el).find(t).length || $(el).is(t)) hits += 1;
    });
    if (hits > 0 && hits / Math.max(1, nodes.length) > 0.6) return `${sel} ${t}`;
  }
  return undefined;
}

/** Finds a listing URL whose page number can be turned into `{page}`. */
function guessListUrl($: Doc, current: string): { url: string; hint: string } | null {
  // An explicit rel=next is the most reliable signal.
  const rel = $('a[rel="next"]').first();
  if (rel.length) {
    const href = absolute(clean(rel.attr('href') ?? ''), current);
    if (href) return { url: href.replace(/([?&](?:page|p|paged)=)\d+/i, '$1{page}'), hint: 'rel=next' };
  }

  // Otherwise a link that is just a number, or "next"/"التالي".
  let best: { href: string; text: string } | null = null;
  $('a[href]').each((_, el) => {
    const node = $(el);
    const text = clean(node.text()).toLowerCase();
    const looksPaged = /^\d{1,3}$/.test(text) || /^(next|›|»|>|التالي|التاليه)\s*\d*$/i.test(text);
    if (!looksPaged) return;
    const href = absolute(clean(node.attr('href') ?? ''), current);
    if (!href || new URL(href).origin !== new URL(current).origin) return;
    if (!best || Number(text) < Number(best.text)) best = { href, text };
  });

  if (!best) return null;
  const b = best as { href: string; text: string };
  const templated = b.href.replace(/([?&](?:page|p|paged)=)\d+/i, '$1{page}');
  return {
    url: templated,
    hint: templated === b.href
      ? 'no page parameter found — add one, or use rel=next'
      : `page parameter found ("${b.text}")`,
  };
}

function suggestType($: Doc, title: string, description: string): string {
  const blob = `${title} ${description}`.toLowerCase();
  const ld = jsonLd($).map((b) => String(b['@type'] ?? '')).join(' ');
  if (/tvseries|tvepisode| episodicchema/.test(ld) || /مسلسل|series|season|episode/.test(blob)) {
    return 'SERIES';
  }
  return 'MOVIE';
}

async function main() {
  console.log(`\nprobing ${url}\n${'─'.repeat(60)}`);

  // ── robots.txt ────────────────────────────────────────────────────────────
  const allowed = await isAllowed(url);
  const delay = await crawlDelay(url);
  const maps = await sitemaps(origin);

  console.log(`robots.txt   ${allowed ? 'allowed' : 'DISALLOWED for this path'}`);
  if (delay > 0) console.log(`crawl-delay  ${delay}s (the provider will honour this)`);
  if (maps.length) {
    console.log(`sitemaps     ${maps.length} declared`);
    for (const m of maps.slice(0, 3)) console.log(`             ${m}`);
  }
  if (!allowed) {
    console.log(
      '\nThis origin asks crawlers to stay off that path. Point the source at an\n' +
        'allowed one, or — if this is your own site — set "ignoreRobots": true in\n' +
        'the source config.\n',
    );
    process.exit(2);
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  let html: string;
  try {
    html = await fetchText(url, { headers: NAVIGATION_HEADERS, timeoutMs: 20_000 });
  } catch (err) {
    if (err instanceof HttpError) {
      console.error(`\nfetch failed: HTTP ${err.status} for ${url}`);
      if (err.status === 403 || err.status === 503) {
        console.error('The origin is refusing automated requests. It may require a');
        console.error('cookie or a real browser; a static fetch will not get past it.');
      }
    } else {
      console.error('\nfetch failed:', (err as Error).message);
    }
    process.exit(1);
  }

  const $ = load(html);
  const pageTitle = clean($('title').first().text());
  const ogTitle = asString(
    $('meta[property="og:title"]').attr('content') as string | undefined,
  );
  const ogImage = asString(
    $('meta[property="og:image"]').attr('content') as string | undefined,
  );
  const description = clean(
    asString($('meta[name="description"]').attr('content') as string | undefined) ?? '',
  );

  console.log(`title        ${pageTitle || '(none)'}`);
  console.log(`description  ${description.slice(0, 90) || '(none)'}`);
  console.log(`html size    ${(html.length / 1024).toFixed(0)} KB`);

  // ── JSON-LD ───────────────────────────────────────────────────────────────
  const blocks = jsonLd($);
  const types = [...new Set(blocks.map((b) => String(b['@type'] ?? '?')))];
  console.log(
    `JSON-LD      ${blocks.length} block(s)${types.length ? ` — ${types.join(', ')}` : ''}`,
  );
  if (!blocks.length) {
    console.log('             none found, so every field will need a CSS selector');
  }

  // ── card detection ────────────────────────────────────────────────────────
  let best = { sel: '', count: 0, score: -1 };
  for (const sel of CANDIDATES) {
    const { count, score: s } = score(sel, $);
    if (count >= 3 && s > best.score) best = { sel, count, score: s };
  }

  console.log(`\nrepeated elements`);
  if (best.sel) {
    console.log(`  best card   ${best.sel}  (${best.count} matches)`);
    const runners = CANDIDATES.map((sel) => ({ sel, ...score(sel, $) }))
      .filter((r) => r.count >= 3 && r.sel !== best.sel)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const r of runners) console.log(`  also        ${r.sel}  (${r.count})`);

    // Show what the guess actually yields, so a wrong guess is obvious.
    console.log('\n  first three as parsed:');
    $(best.sel).slice(0, 3).each((_, el) => {
      const node = $(el);
      const a = node.find('a[href]').first();
      const href = absolute(clean(a.attr('href') ?? ''), url);
      let name = '';
      for (const t of TITLE_CANDIDATES) {
        const found = node.find(t).first();
        const text = clean(found.length ? found.text() || (found.attr('alt') ?? '') : '');
        if (text) { name = text; break; }
      }
      const img = node.find('img').first();
      console.log(`    ${name.slice(0, 50).padEnd(52)} ${href}`);
      if (img.length) {
        console.log(`      poster: ${absolute(clean(img.attr('src') ?? img.attr('data-src') ?? ''), url).slice(0, 90)}`);
      }
    });
  } else {
    console.log('  no repeated card pattern found');
    console.log('  this page is probably not a listing — try the catalogue index instead');
  }

  const listUrl = guessListUrl($, url);

  // ── config ────────────────────────────────────────────────────────────────
  const itemSelector = best.sel || 'div';
  const config = {
    id: new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
    name: pageTitle ? pageTitle.split(/[|\-–—]/)[0].trim().slice(0, 40) : 'New source',
    baseUrl: origin,
    type: suggestType($, pageTitle, description),
    enabled: false,
    priority: 100,
    list: {
      url: listUrl?.url ?? url,
      item: itemSelector,
      title: guessTitleSelector(itemSelector, $)
        ? { selector: guessTitleSelector(itemSelector, $)!.split(' ').slice(1).join(' ') }
        : undefined,
      urlField: { selector: 'a', attr: 'href' },
      minItems: Math.max(1, Math.floor(best.count * 0.6) || 1),
    },
    detail: {},
    episodes: [],
    note: `generated by probe from ${url} — review before enabling`,
  };

  console.log(`\npagination   ${listUrl ? `${listUrl.hint} → ${listUrl.url}` : 'not detected'}`);
  console.log(`poster       ${ogImage ? absolute(ogImage, url) : 'none on this page'}`);
  console.log(`suggested    type=${config.type} (set by hand — the guess is coarse)\n`);
  console.log('─'.repeat(60));
  console.log('starter config (paste into SOURCES_JSON, then review and enable):\n');
  console.log(JSON.stringify([config], null, 2));
  console.log(
    '\nNext steps\n' +
      '  1. open one detail page, run the probe on it, and read the fields it found\n' +
      '  2. add detail selectors for title / overview / poster / genres\n' +
      '  3. add an "episodes" block if the page lists episodes\n' +
      '  4. set "enabled": true\n' +
      '  5. npm run scrape -- <id> --pages 2   # small run first\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
