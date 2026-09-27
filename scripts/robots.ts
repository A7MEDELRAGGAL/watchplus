/* eslint-disable no-console */
/**
 * robots — show what an origin's robots.txt permits, and whether our token
 * matches one of its groups.
 *
 *   npm run robots -- https://example.com/browse
 *   npm run robots -- https://example.com/browse MyBot
 *
 * Worth running before configuring a source: if the site disallows `/` for
 * `*` and names no specific bot, a crawl will return nothing useful, and the
 * reason is usually visible here in one line.
 */
import 'dotenv/config';
import { fetchText, NAVIGATION_HEADERS } from '../src/lib/scraper/core/http';
import { crawlDelay, isAllowed, sitemaps } from '../src/lib/scraper/core/robots';

const url = process.argv[2];
const token = process.argv[3] ?? process.env.SCRAPER_USER_AGENT ?? 'WatchBoxBot';

if (!url) {
  console.error('usage: npm run robots -- <url> [user-agent-token]');
  process.exit(1);
}

async function main() {
  const parsed = new URL(url);
  const origin = parsed.origin;

  console.log(`\n${origin}/robots.txt  (as "${token}")\n${'─'.repeat(60)}`);

  let text: string;
  try {
    text = await fetchText(`${origin}/robots.txt`, {
      headers: NAVIGATION_HEADERS,
      timeoutMs: 10_000,
      retries: 1,
    });
  } catch (err) {
    console.log('could not be fetched — treated as "allow everything".');
    console.log(String((err as Error).message));
    return;
  }

  // Echo the groups, trimmed of blank lines and comments.
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    console.log(`  ${line}`);
  }

  const maps = await sitemaps(origin);
  if (maps.length) {
    console.log(`\nsitemaps (${maps.length})`);
    for (const m of maps) console.log(`  ${m}`);
  }

  const delay = await crawlDelay(url, token);
  const allowed = await isAllowed(url, token);

  console.log(`\nverdict for ${url}`);
  console.log(`  crawl-delay  ${delay > 0 ? `${delay}s` : 'not specified'}`);
  console.log(`  permitted    ${allowed ? 'yes' : 'NO'}`);
  if (!allowed) {
    console.log(
      '\nIf this is your own site, set "ignoreRobots": true in the source config.\n' +
        'Otherwise the source has to target a different path.',
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
