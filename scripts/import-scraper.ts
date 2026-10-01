/* eslint-disable no-console */
/**
 * استيراد idempotent من جداول العقد (Neon) إلى جداول الموقع.
 *
 * القواعد (حسب التعليمات):
 * - بلا DELETE إطلاقًا، وبلا مساس بصفوف موجودة (الإثراء محفوظ بالبناء).
 * - series→Title: مطابقة موثوقة = رابط المصدر في TitleSource أولًا،
 *   ثم عنوان مُطبَّع وحيد. الغامض → مراجعة، لا دمج قسري، لا تكرار.
 * - العنوان الغائب تمامًا يُنشأ minimal (بلا بوستر → مخفي من الرئيسية حتى الإثراء).
 * - releases→Season (مواسم موجودة؛ تُنشأ الصدفة عند الحاجة فقط)، episodes→Episode.
 * - السيرفرات: unknown/active فقط + ثقة ≥0.7 + غير منتهية.
 *   url = صفحة المصدر الثابتة، streamUrl = الرابط المؤقت (cache فقط).
 *   المفتاح (episodeId, provider, providerId=sc:<id>) → إعادة التشغيل صفر جديد.
 * - بلا interactive transactions (الـ pooler يسقطها — موثق في upsert.ts):
 *   عمليات ذرية متسلسلة + idempotency = نفس الضمان.
 *
 *   npm run import:scraper            dry run
 *   npm run import:scraper -- --go    apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mergeKey, isJunkTitle } from '../src/lib/scraper/normalize';
import { cleanEpisodeName, seasonRank, seriesKey } from '../src/lib/queries';
import { isActuallyExpired } from '../src/lib/servers';

interface ScSeries { id: number; canonical_title: string; slug: string }
interface ScRelease { id: number; series_id: number; kind: string; season_number: number | null; title: string }
interface ScEpisode { id: number; release_id: number; episode_number: string | null; title: string | null }
interface ScServer {
  id: number; episode_id: number; provider: string; quality: string | null;
  url: string; kind: string; status: string; expires_at: string | null;
  conf: number | null; ep_url: string | null; anime_url: string | null;
}

function parseNum(v: string | null): number | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** إعادة محاولة للعمليات ضد تقطع الشبكة (idempotent أصلًا فآمنة). */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

function normUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return (x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '')) || null;
  } catch {
    return u.trim().toLowerCase() || null;
  }
}

function prettify(slugLike: string): string {
  return slugLike
    .split(/[^A-Za-z0-9\u0600-\u06FF]+/u)
    .filter(Boolean)
    .map((w) => (/[\u0600-\u06FF]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
    .slice(0, 120);
}

async function main() {
  const go = process.argv.includes('--go');
  const batchArg = process.argv.find((a) => a === '--batch');
  const batch = batchArg ? Number(process.argv[process.argv.indexOf('--batch') + 1]) || 0 : 0;
  const offsetArg = process.argv.find((a) => a === '--offset');
  const offset = offsetArg ? Number(process.argv[process.argv.indexOf('--offset') + 1]) || 0 : 0;
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const beforeSrc = await prisma.episodeSource.count();
  const beforeTitle = await prisma.title.count();
  const beforeEp = await prisma.episode.count();
  console.log(`before: titles=${beforeTitle} episodes=${beforeEp} sources=${beforeSrc}`);

  let series: ScSeries[];
  try {
    series = (await withRetry(() =>
      prisma.$queryRawUnsafe(
        'SELECT id, canonical_title, slug FROM "series" ORDER BY id',
      ),
    )) as ScSeries[];
  } catch {
    console.log('contract tables absent/unreachable — nothing to import');
    await prisma.$disconnect();
    return;
  }
  if (batch > 0) {
    series = series.slice(offset, offset + batch);
    console.log(`batch: offset=${offset} size=${series.length}`);
  }
  const releases = (await prisma.$queryRawUnsafe(
    'SELECT id, series_id, kind, season_number, title FROM "releases"')) as ScRelease[];
  const episodes = (await prisma.$queryRawUnsafe(
    'SELECT id, release_id, episode_number, title FROM "episodes"')) as ScEpisode[];
  const servers = (await prisma.$queryRawUnsafe(
    `SELECT s.id, s.episode_id, s.provider, s.quality, s.url, s.kind, s.status, s.expires_at,
            e.match_confidence conf, e.source_episode_url ep_url, e.source_anime_url anime_url
     FROM "servers" s LEFT JOIN "source_entries" e ON e.id = s.source_entry_id
     WHERE s.status IN ('unknown','active')`)) as ScServer[];
  console.log(`contract: series=${series.length} releases=${releases.length} episodes=${episodes.length} servers(unknown/active)=${servers.length}`);

  const myTitles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true, originalTitle: true,
      seasons: { select: { id: true, number: true, episodes: { select: { id: true, number: true } } } },
    },
  });
  const mySources = await prisma.titleSource.findMany({ select: { titleId: true, url: true } });
  const urlToTitle = new Map<string, string>();
  for (const s of mySources) {
    const n = normUrl(s.url);
    if (n && !urlToTitle.has(n)) urlToTitle.set(n, s.titleId);
  }
  const byKey = new Map<string, typeof myTitles>();
  const byMerge = new Map<string, typeof myTitles>();
  for (const t of myTitles) {
    const k = seriesKey(t.originalTitle);
    const l = byKey.get(k) ?? [];
    l.push(t);
    byKey.set(k, l);
    const m = mergeKey(t.originalTitle);
    const l2 = byMerge.get(m) ?? [];
    l2.push(t);
    byMerge.set(m, l2);
  }

  const relBySeries = new Map<number, ScRelease[]>();
  for (const r of releases) {
    const l = relBySeries.get(r.series_id) ?? [];
    l.push(r);
    relBySeries.set(r.series_id, l);
  }
  const epByRel = new Map<number, ScEpisode[]>();
  for (const e of episodes) {
    const l = epByRel.get(e.release_id) ?? [];
    l.push(e);
    epByRel.set(e.release_id, l);
  }
  const srvByEp = new Map<number, ScServer[]>();
  for (const s of servers) {
    const l = srvByEp.get(s.episode_id) ?? [];
    l.push(s);
    srvByEp.set(s.episode_id, l);
  }

  const review: string[] = [];
  let newTitles = 0;
  let newSeasons = 0;
  let newEps = 0;
  let upserted = 0;
  let skipped = 0;

  async function getOrCreateTitle(s: ScSeries): Promise<(typeof myTitles)[number] | null> {
    // سلسلة زائفة (تنقل/قوائم) لا تُنشأ أبدًا — تُراجع فقط
    if (isJunkTitle(s.canonical_title)) {
      review.push(`series "${s.canonical_title.slice(0, 40)}": junk canonical — review, never create`);
      return null;
    }
    // (أ) رابط المصدر أولًا — الأدق: روابط الأنمي من سيرفرات السلسلة
    const rels = relBySeries.get(s.id) ?? [];
    const urls = new Set<string>();
    for (const r of rels)
      for (const e of epByRel.get(r.id) ?? [])
        for (const srv of srvByEp.get(e.id) ?? []) {
          const n = normUrl(srv.anime_url);
          if (n) urls.add(n);
        }
    for (const u of urls) {
      const tid = urlToTitle.get(u);
      if (tid) {
        const found = myTitles.find((t) => t.id === tid);
        if (found) return found;
      }
    }
    // (ب) عنوان مُطبَّع وحيد (seriesKey ثم mergeKey الذي يتجاهل اللواحق)
    const cands = byKey.get(seriesKey(s.canonical_title)) ?? [];
    if (cands.length === 1) return cands[0];
    const mkey = mergeKey(s.canonical_title);
    const cands2 = mkey ? (byMerge.get(mkey) ?? []) : [];
    if (cands2.length === 1) return cands2[0];
    if (cands.length > 1 || cands2.length > 1) {
      review.push(`series "${s.canonical_title.slice(0, 40)}": ambiguous matches — review, no merge`);
      return null;
    }
    // (ج) غائب تمامًا → minimal (مخفي من الرئيسية حتى يُثرى)
    const name = prettify(s.canonical_title) || s.slug;
    let slug = (s.slug || `series-${s.id}`).slice(0, 60);
    if (go) {
      const clash = await prisma.title.findUnique({ where: { slug }, select: { id: true } });
      if (clash) slug = `${slug}-sc${s.id}`;
      const created = await prisma.title.create({
        data: {
          key: `sc:series:${s.id}`,
          type: 'ANIME',
          slug,
          originalTitle: name,
          titleEn: /[\u0600-\u06FF]/.test(name) ? null : name,
          titleAr: /[\u0600-\u06FF]/.test(name) ? name : null,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          searchBlob: name.toLowerCase(),
        },
        select: { id: true, originalTitle: true, seasons: { select: { id: true, number: true, episodes: { select: { id: true, number: true } } } } },
      });
      myTitles.push(created as (typeof myTitles)[number]);
      const arr = byKey.get(seriesKey(name)) ?? [];
      arr.push(created as (typeof myTitles)[number]);
      byKey.set(seriesKey(name), arr);
      newTitles += 1;
      return created as (typeof myTitles)[number];
    }
    review.push(`series "${s.canonical_title.slice(0, 40)}": would create minimal title`);
    return null;
  }

  for (const s of series) {
    const title = await getOrCreateTitle(s);
    if (!title) continue;
    for (const rel of relBySeries.get(s.id) ?? []) {
      if (rel.kind !== 'season') {
        review.push(`release "${(rel.title || '').slice(0, 40)}" kind=${rel.kind} — non-season skipped`);
        continue;
      }
      // season_number غالبًا NULL في العقد — يُستنتج من الاسم (Season 2 → 2) وإلا 1
      const rank = seasonRank(rel.title || '');
      const sn = rel.season_number ?? (rank <= 20 ? rank : 1);
      let season = title.seasons.find((x) => x.number === sn);
      if (!season) {
        if (!go) {
          review.push(`"${title.originalTitle.slice(0, 32)}" lacks season ${sn} — would create`);
          continue;
        }
        season = await prisma.season.create({
          data: { titleId: title.id, number: sn, name: `Season ${sn}` },
          select: { id: true, number: true, episodes: { select: { id: true, number: true } } },
        });
        title.seasons.push(season);
        newSeasons += 1;
      }
      for (const ep of epByRel.get(rel.id) ?? []) {
        const num = parseNum(ep.episode_number);
        if (num == null || num <= 0) {
          review.push(`ep without number in "${title.originalTitle.slice(0, 30)}" S${sn} — review`);
          continue;
        }
        let myEp = season.episodes.find((e) => e.number === num);
        if (!myEp) {
          if (!go) continue;
          myEp = await prisma.episode.create({
            data: { seasonId: season.id, number: num, name: cleanEpisodeName(ep.title, num) },
            select: { id: true, number: true },
          });
          season.episodes.push(myEp);
          newEps += 1;
        }
        for (const srv of srvByEp.get(ep.id) ?? []) {
          if ((srv.conf ?? 1) < 0.7) {
            skipped += 1;
            continue;
          }
          if (srv.expires_at && new Date(srv.expires_at).getTime() < Date.now()) {
            skipped += 1;
            continue;
          }
          const stable = srv.ep_url || srv.url;
          const isMp4 = /\.mp4(\?|$)/i.test(srv.url.split('?')[0]);
          const expired = isActuallyExpired(srv.url);
          const data = {
            provider: srv.provider || 'unknown',
            url: stable,
            streamUrl: srv.url !== stable ? srv.url : isMp4 ? srv.url : null,
            kind: srv.kind === 'download' ? (isMp4 ? 'mp4' : 'page') : isMp4 ? 'mp4' : 'iframe',
            quality: srv.quality?.trim() || null,
            language: 'ar',
            isDead: false,
            headers: expired ? JSON.stringify({ v: 1, fails: 0, exp: true }) : null,
            lastSyncedAt: new Date(),
          };
          if (go) {
            await withRetry(() =>
              prisma.episodeSource.upsert({
                where: {
                  episodeId_provider_providerId: {
                    episodeId: myEp.id,
                    provider: data.provider,
                    providerId: `sc:${srv.id}`,
                  },
                },
                create: { episodeId: myEp.id, providerId: `sc:${srv.id}`, ...data },
                update: { ...data },
              }),
            );
          }
          upserted += 1;
        }
      }
    }
  }

  const afterSrc = go ? await prisma.episodeSource.count() : beforeSrc;
  const afterTitle = go ? await prisma.title.count() : beforeTitle;
  const afterEp = go ? await prisma.episode.count() : beforeEp;
  console.log(`\nbefore: titles=${beforeTitle} episodes=${beforeEp} sources=${beforeSrc}`);
  console.log(`after:  titles=${afterTitle} episodes=${afterEp} sources=${afterSrc}`);

  // الجسر: طلبات التجديد المعلّمة في headers → صفوف refresh_queue بسكيما السكرابر
  if (go) {
    try {
      const flagged = (await prisma.$queryRawUnsafe(
        `SELECT s.id, s.provider, COALESCE(s."streamUrl", s.url) u FROM "EpisodeSource" s
         WHERE s.headers LIKE '%refreshRequested%'`)) as { id: string; provider: string; u: string }[];
      let bridged = 0;
      for (const f of flagged) {
        try {
          const dup = (await prisma.$queryRawUnsafe(
            `SELECT id FROM "refresh_queue" WHERE watch_url=$1 AND status='pending' LIMIT 1`,
            f.u,
          )) as unknown[];
          if (dup.length === 0) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "refresh_queue"("site","watch_url","reason","status","requested_at")
               VALUES($1,$2,'expired','pending',NOW()::text)`,
              f.provider,
              f.u,
            );
            bridged += 1;
          }
        } catch { /* per-row failure never aborts */ }
      }
      const q = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) c FROM "refresh_queue" WHERE status='pending'`) as { c: bigint }[];
      console.log(`refresh bridge: flagged=${flagged.length} bridged-new=${bridged} queue-pending=${q[0].c.toString()}`);
    } catch {
      console.log('refresh bridge: table absent — skipped');
    }
  }
  console.log(`new titles=${newTitles} new seasons=${newSeasons} new episodes=${newEps} upserted servers=${upserted} skipped=${skipped}`);
  console.log(`review (${review.length}):`);
  for (const r of review.slice(0, 25)) console.log(`  … ${r}`);
  if (review.length > 25) console.log(`  …and ${review.length - 25} more`);
  if (!go) console.log('dry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('import failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
