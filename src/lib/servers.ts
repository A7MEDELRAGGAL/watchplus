/**
 * منطق السيرفرات المشترك (pure — يُختبر في self-test ويُستخدم في الصفحة والـ API).
 *
 * الحالات: active ← suspect (1-2 ضربات أو بلاغ) ← dead (3+ ضربات).
 * الروابط المنتهية (expires/token) ليست صالحة أبدًا — "تحتاج تحديثًا".
 */

export type ServerStatus = 'active' | 'suspect' | 'dead' | 'expired';
export type ServerKind = 'stream' | 'download';

export interface ServerRow {
  id: string;
  provider: string;
  label: string | null;
  quality: string | null;
  kind: string; // iframe|mp4|page|hls...
  url: string;
  streamUrl: string | null;
  isDead: boolean;
  fails: number;
  checkedAt: string | null;
}

export interface ClassifiedServer extends ServerRow {
  status: ServerStatus;
  isDownload: boolean;
  host: string | null;
  expiresAt: string | null;
}

const EXPIRY_PATTERNS = [/expires=/i, /[?&]token=/i, /signature=/i, /exp=\d{9,}/];

export function isExpiringLink(target: string): boolean {
  return EXPIRY_PATTERNS.some((p) => p.test(target));
}

export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** streamUrl المباشر (mp4) يصلح مشاهدة وتحميلًا؛ الباقي مشاهدة فقط. */
export function isDownloadable(s: Pick<ServerRow, 'kind' | 'streamUrl'>): boolean {
  return !!s.streamUrl && /\.mp4(\?|$)/i.test(s.streamUrl.split('?')[0]);
}

/**
 * مجموعات kind حسب القيم الفعلية في القاعدة (لا توجد 'stream'/'download'
 * مخزنة — iframe/mp4/page/hls فقط). مطابقة لعقد الـ API:
 * stream ← iframe + mp4 (+hls)، وdownload ← mp4 + page.
 */
export const KIND_GROUPS = {
  stream: ['iframe', 'mp4', 'hls'],
  download: ['mp4', 'page'],
} as const;
export type KindGroup = keyof typeof KIND_GROUPS;

export function matchesKindGroup(kind: string, group: KindGroup): boolean {
  return (KIND_GROUPS[group] as readonly string[]).includes(kind.toLowerCase());
}

export function classify(s: ServerRow): ClassifiedServer {
  const target = s.streamUrl || s.url;
  const expiring = isExpiringLink(target);
  let status: ServerStatus;
  if (expiring) status = 'expired';
  else if (s.isDead || s.fails >= 3) status = 'dead';
  else if (s.fails >= 1) status = 'suspect';
  else status = 'active';
  return {
    ...s,
    status,
    isDownload: isDownloadable(s),
    host: hostOf(target),
    expiresAt: expiring ? s.checkedAt : null,
  };
}

const STATUS_ORDER: Record<ServerStatus, number> = {
  active: 0,
  suspect: 1,
  expired: 2,
  dead: 3,
};

/** الترتيب: active ← suspect ← expired ← dead (الميت آخرًا ومخفي افتراضيًا). */
export function sortServers<T extends { status: ServerStatus }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export interface ServerFilters {
  quality: string | null; // null = الكل
  site: string | null; // provider key أو null
  showDead: boolean;
}

/** فلترة بالجودة والموقع — تعمل على stream وdownload معًا. */
export function filterServers<T extends ClassifiedServer>(rows: T[], f: ServerFilters): T[] {
  return rows.filter((s) => {
    if (!f.showDead && s.status === 'dead') return false;
    if (f.quality && (s.quality ?? null) !== f.quality) return false;
    if (f.site && s.provider !== f.site) return false;
    return true;
  });
}

/** أول سيرفر صالح للتشغيل التلقائي (active ثم suspect، لا expired/dead). */
export function pickDefault<T extends ClassifiedServer>(rows: T[]): T | null {
  return sortServers(rows).find((s) => s.status === 'active' || s.status === 'suspect') ?? null;
}

export const REPORT_CATEGORIES = ['dead-video', 'audio', 'subtitle'] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export function isReportCategory(v: unknown): v is ReportCategory {
  return typeof v === 'string' && (REPORT_CATEGORIES as readonly string[]).includes(v);
}

/** عدّاد الضربات من عمود headers (null = صفر؛ بيانات حقيقية = صفر ولا تُمس). */
export function readFails(headers: string | null): number {
  if (!headers) return 0;
  try {
    const j = JSON.parse(headers) as { v?: number; fails?: number };
    return j?.v === 1 && typeof j.fails === 'number' ? j.fails : 0;
  } catch {
    return 0;
  }
}
