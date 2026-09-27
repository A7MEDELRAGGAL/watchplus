import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { CastMember, Genre, StreamLink } from '../types';

/**
 * Thin, forgiving helpers over cheerio.
 *
 * Scraped pages break constantly. Every getter here returns a usable default
 * instead of throwing, so one bad card never kills a whole run.
 */

export type Doc = CheerioAPI;

/** The node type cheerio hands back from `.each()` / `.get()`. */
export type Node = AnyNode;

export function load(html: string): Doc {
  return cheerio.load(html);
}

/**
 * Narrow a Doc down to something with `.find()`.
 *
 * With no root we use `$.root()`, which is a real Cheerio selection over the
 * whole document — this keeps the return type a single concrete type instead of
 * a `Doc | Cheerio<...>` union that would break every chained call.
 */
function scope($: Doc, root?: Node) {
  return root === undefined ? $.root() : $(root);
}

export function text($: Doc, sel: string, root?: Node): string {
  const el = scope($, root).find(sel).first();
  if (!el.length) return '';
  return clean(el.text());
}

export function attr($: Doc, sel: string, name: string, root?: Node): string {
  return clean(scope($, root).find(sel).first().attr(name) ?? '');
}

export function textAll($: Doc, sel: string, root?: Node): string[] {
  return scope($, root)
    .find(sel)
    .map((_, el) => clean($(el).text()))
    .get()
    .filter(Boolean);
}

export function attrAll($: Doc, sel: string, name: string, root?: Node): string[] {
  return scope($, root)
    .find(sel)
    .map((_, el) => clean($(el).attr(name) ?? ''))
    .get()
    .filter(Boolean);
}

export function clean(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    // keep arabic letters, drop latin diacritics
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/** Resolve any href to an absolute URL. */
export function absolute(href: string, base: string): string {
  const value = clean(href);
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

/** Resolve a possibly-relative image src (including srcset-less lazy loads). */
export function absoluteImage(src: string, base: string): string {
  const value = clean(src);
  if (!value) return '';
  if (value.startsWith('data:')) return '';
  if (/^\/\//.test(value)) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) {
    try {
      return new URL(value, base).toString();
    } catch {
      return '';
    }
  }
  return '';
}

/** Common lazy-loading attributes, in the order we trust them. */
export function imageSrc($: Doc, root: Node, base: string): string {
  const el = $(root);
  const candidates = [
    el.attr('src'),
    el.attr('data-src'),
    el.attr('data-original'),
    el.attr('data-lazy-src'),
    el.attr('data-image'),
    el.attr('data-url'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const resolved = absoluteImage(c, base);
    if (resolved) return resolved;
  }

  // last resort: a srcset
  const srcset = el.attr('srcset') ?? el.attr('data-srcset');
  if (srcset) {
    const best = pickFromSrcset(srcset);
    const resolved = absoluteImage(best, base);
    if (resolved) return resolved;
  }

  // poster-style attribute
  const poster = el.attr('poster') ?? el.attr('data-poster');
  return poster ? absoluteImage(poster, base) : '';
}

/** Take the largest candidate out of a srcset attribute. */
export function pickFromSrcset(srcset: string): string {
  const entries = srcset
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [url, desc] = s.split(/\s+/);
      const w = /(\d+)w/.exec(desc ?? '')?.[1];
      const x = /([\d.]+)x/.exec(desc ?? '')?.[1];
      return { url: url ?? '', score: w ? Number(w) : x ? Number(x) * 1000 : 0 };
    })
    .filter((e) => e.url);
  entries.sort((a, b) => b.score - a.score);
  return entries[0]?.url ?? '';
}

/** Pull the first year-looking number out of a blob of text. */
export function extractYear(blob: string): number | undefined {
  const m = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(blob ?? '');
  return m ? Number(m[1]) : undefined;
}

/** "1h 47m" / "107 min" / "PT1H47M" -> minutes */
export function extractRuntime(blob: string): number | undefined {
  if (!blob) return undefined;
  const iso = /PT(?:(\d+)H)?(?:(\d+)M)?/i.exec(blob);
  if (iso && (iso[1] || iso[2])) return Number(iso[1] ?? 0) * 60 + Number(iso[2] ?? 0);

  const hm = /(\d+)\s*h(?:ours?|rs?)?\s*(\d+)?\s*m/i.exec(blob);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2] ?? 0);

  const min = /(\d+)\s*(?:m(?:in(?:ute)?s?)?)/i.exec(blob);
  if (min) return Number(min[1]);

  const bare = /^\s*(\d{2,4})\s*$/.exec(blob);
  if (bare) {
    const n = Number(bare[1]);
    if (n > 20 && n < 1000) return n;
  }
  return undefined;
}

/** Normalise a date blob to ISO yyyy-mm-dd, or undefined. */
export function extractDate(blob: string): string | undefined {
  if (!blob) return undefined;
  const value = clean(blob);

  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return iso[0];

  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(value);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = dmy[3];
    if (m <= 12) return `${y}-${pad(m)}-${pad(d)}`;
    return `${y}-${pad(d)}-${pad(m)}`;
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return undefined;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** Detect whether a blob contains arabic script. */
export function isArabic(blob: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(blob ?? '');
}

/**
 * Pick the best stream out of a raw page blob.
 * Handles both direct media URLs and the common packed player JSON.
 */
export function detectStream(raw: string, base: string): StreamLink | null {
  if (!raw) return null;

  const url = absolute(raw, base);
  if (!url) return null;

  if (/\.m3u8(\?|$)/i.test(url)) return { providerId: url, url, kind: 'hls' };
  if (/\.mpd(\?|$)/i.test(url)) return { providerId: url, url, kind: 'dash' };
  if (/\.(mp4|m4v|webm|mov)(\?|$)/i.test(url)) return { providerId: url, url, kind: 'mp4' };

  // still a usable page link — treat it as an iframe player
  return { providerId: url, url, kind: 'iframe' };
}

/** Build a CastMember[] from repeated card markup. */
export function parseCast(entries: { name: string; character?: string; image?: string }[]): CastMember[] {
  return entries
    .filter((e) => e.name)
    .map((e) => ({ name: e.name, character: e.character || undefined, imageUrl: e.image || undefined }));
}

/** Build a Genre[] from names, de-duplicated, order preserved. */
export function parseGenres(names: string[]): Genre[] {
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const raw of names) {
    const name = clean(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, slug: slugify(name) });
  }
  return out;
}

/**
 * Read a JSON-LD block. Movie sites put almost everything in one of these.
 * Returns the first object that carries a recognised @type.
 */
export function jsonLd($: Doc): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text() ?? $(el).text();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) collect(item, out);
    } catch {
      // malformed JSON-LD is extremely common; ignore
    }
  });
  return out;
}

function collect(node: unknown, out: Record<string, unknown>[]) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec['@graph']) {
    collect(rec['@graph'], out);
    return;
  }
  if (rec['@type']) out.push(rec);
}

/** Pick a JSON-LD object whose @type matches any of `types`. */
export function pickJsonLd(blocks: Record<string, unknown>[], ...types: string[]): Record<string, unknown> | undefined {
  return blocks.find((b) => {
    const t = b['@type'];
    const list = Array.isArray(t) ? t : [t];
    return list.some((x) => typeof x === 'string' && types.includes(x.toLowerCase()));
  });
}

export function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  return undefined;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return undefined;
}

export function firstElement($: Doc, sel: string, root?: Node): Node | undefined {
  const el = scope($, root).find(sel).first();
  return el.length ? (el.get(0) as Node) : undefined;
}
