import { fetchText, NAVIGATION_HEADERS } from './http';

/**
 * Minimal robots.txt reader.
 *
 * Exists for two reasons. The obvious one is that a crawler which ignores
 * robots.txt gets the operator's IP banned and, depending on where it runs,
 * attracts liability. The practical one is that sites which disallow crawling
 * tend to also block or throttle aggressively, so honouring the file is usually
 * the difference between a working import and an empty one.
 *
 * Implements the parts of RFC 9309 that matter for a catalogue crawler:
 * `User-agent` groups, `Allow`/`Disallow` (longest-match wins), `*` wildcards,
 * `$` anchors, and `Crawl-delay`. Deliberately not implementing the obsolete
 * `Host`/`Sitemap` handling beyond reading `Sitemap:` for the caller's benefit.
 */

interface Rule {
  allow: boolean;
  /** Path pattern with `*` collapsed to a regex source fragment. */
  pattern: string;
  regex: RegExp;
}

export interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay: number | null;
}

const cache = new Map<string, { groups: Group[]; sitemaps: string[]; fetchedAt: number }>();

const TTL_MS = 6 * 60 * 60_000; // a robots.txt that changes intraday is rare

/** Turns a robots path pattern into a regex. `*` = any run, `$` = end anchor. */
export function patternToRegex(pattern: string): RegExp {
  let source = '';
  for (const ch of pattern) {
    if (ch === '*') source += '.*';
    else if (ch === '$') source += '$';
    else source += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}`);
}

/** Groups are `User-agent` lines followed by rules, until the next group. */
export function parseRobots(text: string): { groups: Group[]; sitemaps: string[] } {
  const groups: Group[] = [];
  const sitemaps: string[] = [];

  let current: Group | null = null;
  // Consecutive User-agent lines share one rule set.
  let expectingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;

    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (!current) continue;

    if (field === 'disallow' || field === 'allow') {
      expectingAgents = false;
      // An empty Disallow means "allow everything" and carries no rule.
      if (field === 'disallow' && value === '') continue;
      if (!value) continue;
      current.rules.push({
        allow: field === 'allow',
        pattern: value,
        regex: patternToRegex(value),
      });
    } else if (field === 'crawl-delay') {
      expectingAgents = false;
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  return { groups, sitemaps };
}

async function load(origin: string): Promise<{ groups: Group[]; sitemaps: string[] }> {
  const hit = cache.get(origin);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    return { groups: hit.groups, sitemaps: hit.sitemaps };
  }

  // No robots.txt (or an unreachable one) means no restrictions.
  let groups: Group[] = [];
  let sitemaps: string[] = [];
  try {
    const text = await fetchText(`${origin}/robots.txt`, {
      headers: NAVIGATION_HEADERS,
      timeoutMs: 10_000,
      retries: 1,
      cacheTtlMs: TTL_MS,
    });
    ({ groups, sitemaps } = parseRobots(text));
  } catch {
    groups = [];
  }

  cache.set(origin, { groups, sitemaps, fetchedAt: Date.now() });
  return { groups, sitemaps };
}

/**
 * True when `token` (our bot name) is allowed to fetch `path`.
 *
 * Rule resolution: pick the group whose `User-agent` matches our token exactly
 * or the `*` fallback — the most specific match wins per RFC 9309. Within a
 * group the longest matching pattern wins, and `Allow` breaks ties, which is
 * what makes `Disallow: /x` + `Allow: /x/y` behave the way a human expects.
 */
export async function isAllowed(
  url: string,
  token = process.env.SCRAPER_USER_AGENT ?? 'WatchBoxBot',
): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

  const { groups } = await load(parsed.origin);
  if (groups.length === 0) return true;

  const ua = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const matched = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  if (matched.length === 0) return true;

  let best: Rule | null = null;
  for (const group of matched) {
    for (const rule of group.rules) {
      if (!rule.regex.test(parsed.pathname + parsed.search)) continue;
      if (
        !best ||
        rule.pattern.length > best.pattern.length ||
        (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
      ) {
        best = rule;
      }
    }
  }

  return best ? best.allow : true;
}

/** The smallest `Crawl-delay` any matching group asks for, in seconds. */
export async function crawlDelay(
  url: string,
  token = process.env.SCRAPER_USER_AGENT ?? 'WatchBoxBot',
): Promise<number> {
  const parsed = new URL(url);
  const { groups } = await load(parsed.origin);
  const ua = token.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const matched = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));

  const delays = matched
    .map((g) => g.crawlDelay)
    .filter((d): d is number => d !== null);
  return delays.length > 0 ? Math.max(...delays) : 0;
}

/** Sitemap URLs advertised by the origin, if any. */
export async function sitemaps(origin: string): Promise<string[]> {
  const { sitemaps: list } = await load(origin);
  return list;
}

export function robotsCacheClear() {
  cache.clear();
}
