/**
 * csv-import provider — reads the anime-scraper-api master CSV
 * (output/all_anime.csv) and exposes it to the pipeline as titles,
 * seasons, episodes and streams. No network, no rate limits.
 *
 * CSV columns: source,title,anime_url,watch_url,kind,episode_number,
 * label,img,servers,embeds,file_urls,scraped_at
 *
 * Mapping:
 * - one Title per anime_url (key `csv:<source>:<slug>` so the same show
 *   from two origins stays two rows until the merge step joins them)
 * - episodes -> season 1 (movies -> movieStreams)
 * - embeds -> iframe mirrors, direct .mp4/.m3u8 -> streamUrl
 *
 * Env: CSV_PATH (default: ../anime-scraper-api/output/all_anime.csv)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  DiscoveredItem,
  DiscoveredPage,
  DiscoverOptions,
  EpisodeDetail,
  Provider,
  ProviderContext,
  SeasonDetail,
  StreamLink,
  TitleDetail,
} from '../types';
import { cleanTitle, fixMojibake, isJunkTitle, titleFromUrlSlug } from '../normalize';

interface CsvRow {
  source: string;
  title: string;
  anime_url: string;
  watch_url: string;
  kind: string;
  episode_number: string;
  label: string;
  img: string;
  servers: string;
  embeds: string;
  file_urls: string;
  scraped_at: string;
}

const PAGE_SIZE = 100;

function defaultCsvPath(): string {
  if (process.env.CSV_PATH) return process.env.CSV_PATH;
  return path.resolve(process.cwd(), '..', 'anime-scraper-api', 'output', 'all_anime.csv');
}

function splitPipe(v: string): string[] {
  return v
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Minimal CSV parser (handles quotes + BOM). */
function parseCsv(text: string): CsvRow[] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cur = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cur);
      cur = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = (cells[i] ?? '').trim();
    });
    return obj as unknown as CsvRow;
  });
}

function slugOf(animeUrl: string): string {
  const clean = animeUrl.split('?')[0].replace(/\/+$/, '');
  const parts = clean.split('/');
  const tail = parts[parts.length - 1] || 'title';
  return tail
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** اسم العرض كما يظهر: إصلاح ترميز ← تنظيف ← الزائف يُستبدل بالمشتق من الرابط. */
function shownTitle(animeUrl: string, raw: string): string {
  const t = fixMojibake((raw || '').trim());
  const cleaned = cleanTitle(t);
  if (!isJunkTitle(cleaned)) return cleaned || animeUrl;
  return titleFromUrlSlug(animeUrl) || cleaned || animeUrl;
}

function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return h.split('.')[0] || 'mirror';
  } catch {
    return 'mirror';
  }
}

function fileKind(url: string): StreamLink['kind'] {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) return 'hls';
  if (clean.endsWith('.mp4')) return 'mp4';
  return 'page';
}

/** فيلم؟ — عنوان أو رابط يحمل علامة فيلم صريحة (النوع يظهر كشارة). */
export function looksLikeMovie(title: string, animeUrl: string): boolean {
  return /(\bthe movie\b|\bfilm\b|فيلم)/i.test(title) || /(\/film\/|\/movie\/|فيلم)/i.test(animeUrl);
}

let cache: { mtime: number; groups: Map<string, CsvRow[]> } | null = null;

function loadGroups(csvPath: string): Map<string, CsvRow[]> {
  let mtime = 0;
  try {
    mtime = fs.statSync(csvPath).mtimeMs;
  } catch {
    return new Map();
  }
  if (cache && cache.mtime === mtime) return cache.groups;
  const text = fs.readFileSync(csvPath, 'utf-8');
  const groups = new Map<string, CsvRow[]>();
  for (const row of parseCsv(text)) {
    if (!row.anime_url || !row.watch_url) continue;
    const list = groups.get(row.anime_url) ?? [];
    list.push(row);
    groups.set(row.anime_url, list);
  }
  cache = { mtime, groups };
  return groups;
}

/**
 * White-label: أزرار المشغّل "سيرفر 1..N" بدل أسماء المنصات (mega/ok.ru…).
 * الترتيب هو ترتيب الجودة (الأفضل أولًا) ويُعرض مع الجودة إن وجدت.
 */
function streamsFor(rows: CsvRow[], site: string): StreamLink[] {
  const out: StreamLink[] = [];
  let n = 0;
  const push = (s: Omit<StreamLink, 'providerId'>) => {
    n += 1;
    out.push({ ...s, providerId: `${site}:s${n}` });
  };
  for (const row of rows) {
    const quals = splitPipe(row.servers)
      .map((s) => {
        const m = s.match(/\(([^)]+)\)/);
        return m ? m[1] : null;
      });
    splitPipe(row.embeds).forEach((emb, i) => {
      push({
        
        url: emb, // المشغّل يضع الـ embed في iframe مباشرة
        streamUrl: undefined,
        kind: 'iframe',
        name: `سيرفر ${out.length + 1}`,
        quality: quals[i] || undefined,
        language: 'ar',
        headers: undefined,
      });
    });
    for (const f of splitPipe(row.file_urls)) {
      const kind = fileKind(f);
      const direct = kind === 'mp4' || kind === 'hls';
      push({
        
        url: direct ? row.watch_url : f,
        streamUrl: direct ? f : undefined,
        kind,
        name: `سيرفر ${out.length + 1}`,
        quality: undefined,
        language: 'ar',
        headers: undefined,
      });
    }
  }
  return out;
}

function buildDetail(animeUrl: string, rows: CsvRow[]): TitleDetail | null {
  if (!rows.length) return null;
  const first = rows[0];
  const site = (first.source || 'unknown').trim() || 'unknown';
  const providerId = `${site}:${slugOf(animeUrl)}`;
  const rawTitle = (first.title || '').trim();
  // عناوين animhq الزائفة ("الموسم 1 - الحلقة 1"): الاسم الحقيقي في الرابط.
  const title = shownTitle(animeUrl, rawTitle) || providerId;
  const poster = rows.map((r) => r.img).find((u) => u) || undefined;
  const isMovie =
    rows.every((r) => (r.kind || '').trim() === 'movie') || looksLikeMovie(title, animeUrl);

  const byEp = new Map<number, CsvRow[]>();
  for (const r of rows) {
    const num = parseInt(r.episode_number, 10);
    if (!Number.isFinite(num) || num <= 0) continue;
    const list = byEp.get(num) ?? [];
    list.push(r);
    byEp.set(num, list);
  }
  if (byEp.size === 0 && rows.length) {
    // بلا أرقام إطلاقًا (روابط vid مبهمة) — ترقيم تسلسلي بدل الإسقاط
    rows.forEach((r, i) => byEp.set(i + 1, [r]));
  }
  const episodes: EpisodeDetail[] = [...byEp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([num, eps]) => ({
      number: num,
      name: fixMojibake(eps.map((e) => e.label).find((l) => l) || '') || undefined,
      overview: undefined,
      // صورة الصف أولًا، ثم بوستر العمل بدل الفراغ الرمادي (MAL لاحقًا إن توفرت)
      stillUrl: eps.map((e) => e.img).find((u) => u) || poster || undefined,
      runtime: undefined,
      airDate: undefined,
      streams: streamsFor(eps, site),
    }));

  const movieStreams: StreamLink[] = isMovie ? streamsFor(rows, site) : [];

  return {
    providerId,
    url: animeUrl,
    kind: isMovie ? 'MOVIE' : 'ANIME',
    originalTitle: title,
    titleAr: /[\u0600-\u06FF]/.test(title) ? title : undefined,
    titleEn: /[\u0600-\u06FF]/.test(title) ? undefined : title,
    overview: undefined,
    tagline: undefined,
    posterUrl: poster,
    backdropUrl: undefined,
    genres: [],
    cast: [],
    studios: [],
    seasons: isMovie
      ? []
      : [
          {
            number: 1,
            name: 'Season 1',
            overview: undefined,
            posterUrl: poster ?? undefined,
            airDate: undefined,
            episodes,
          } as SeasonDetail,
        ],
    movieStreams,
    extra: { csvSource: site, episodeCount: rows.length },
  };
}

export const csvImportProvider: Provider = {
  key: 'csv',
  name: 'CSV import (anime-scraper-api)',
  kind: 'html',
  baseUrl: 'file://csv-import',
  priority: 150,
  rateLimit: { requestsPerSecond: 50, burst: 50 },

  isConfigured(): boolean {
    try {
      return fs.statSync(defaultCsvPath()).isFile();
    } catch {
      return false;
    }
  },

  async discover(_ctx: ProviderContext, opts: DiscoverOptions): Promise<DiscoveredPage> {
    const groups = loadGroups(defaultCsvPath());
    const keys = [...groups.keys()];
    const pageSize = opts.pageSize ?? PAGE_SIZE;
    const page = opts.cursor ? parseInt(opts.cursor, 10) || 0 : 0;
    const slice = keys.slice(page * pageSize, page * pageSize + pageSize);
    const items: DiscoveredItem[] = slice.map((animeUrl) => {
      const rows = groups.get(animeUrl) ?? [];
      const first = rows[0];
      const site = (first.source || 'unknown').trim() || 'unknown';
      const title = shownTitle(animeUrl, first.title || '');
      const isMovie =
        rows.every((r) => (r.kind || '').trim() === 'movie') || looksLikeMovie(title, animeUrl);
      return {
        providerId: `${site}:${slugOf(animeUrl)}`,
        url: animeUrl,
        title,
        kind: isMovie ? 'MOVIE' : 'ANIME',
        posterUrl: rows.map((r) => r.img).find((u) => u) || undefined,
      };
    });
    const hasMore = (page + 1) * pageSize < keys.length;
    return { items, cursor: hasMore ? String(page + 1) : undefined, hasMore };
  },

  async fetchDetail(_ctx: ProviderContext, providerId: string): Promise<TitleDetail | null> {
    const groups = loadGroups(defaultCsvPath());
    for (const [animeUrl, rows] of groups) {
      const site = ((rows[0]?.source || 'unknown').trim() || 'unknown');
      if (`${site}:${slugOf(animeUrl)}` === providerId) return buildDetail(animeUrl, rows);
    }
    return null;
  },

  async search(_ctx: ProviderContext, query: string): Promise<DiscoveredItem[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const groups = loadGroups(defaultCsvPath());
    const out: DiscoveredItem[] = [];
    for (const [animeUrl, rows] of groups) {
      const raw = (rows[0]?.title || '').trim();
      const title = shownTitle(animeUrl, raw);
      if (!title.toLowerCase().includes(q)) continue;
      const site = ((rows[0]?.source || 'unknown').trim() || 'unknown');
      const isMovie =
        rows.every((r) => (r.kind || '').trim() === 'movie') || looksLikeMovie(title, animeUrl);
      out.push({
        providerId: `${site}:${slugOf(animeUrl)}`,
        url: animeUrl,
        title,
        kind: isMovie ? 'MOVIE' : 'ANIME',
        posterUrl: rows.map((r) => r.img).find((u) => u) || undefined,
      });
      if (out.length >= 50) break;
    }
    return out;
  },
};


