/* eslint-disable no-console */
/**
 * استيراد idempotent من جداول السكرابر (Neon) إلى جداول الموقع.
 * يقرأ: series/releases/episodes/servers (+ ثقة source_entries).
 * المطابقة: seriesKey متساوٍ تمامًا وعنوان واحد فقط — الغامض → مراجعة بلا دمج قسري.
 * الإصدارات: kind=season برقم موجود فعلًا فقط. السيرفرات: unknown/active فقط،
 * providerId = sc:<id> فيجعل إعادة التشغيل صفر إضافات (upsert).
 *
 *   npm run import:scraper            dry run
 *   npm run import:scraper -- --go    apply
 *
 * يعمل في CI (DATABASE_URL) أو محليًا. لا يحذف شيئًا أبدًا.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { seriesKey } from '../src/lib/queries';
import { cleanEpisodeName } from '../src/lib/queries';

interface ScSeries { id: number; canonical_title: string; slug: string }
interface ScRelease { id: number; series_id: number; kind: string; season_number: number | null; title: string }
interface ScEpisode { id: number; release_id: number; episode_number: string | null; title: string | null }
interface ScServer {
  id: number; episode_id: number; provider: string; quality: string | null;
  url: string; kind: string; status: string; expires_at: string | null; conf: number | null;
}

function parseNum(v: string | null): number | null {
  if (v == null) return null;
  const m = String(v).match(/\d+/);
  return m ? Number(m[0]) : null;
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const before = await prisma.episodeSource.count();
  console.log(`my EpisodeSource before: ${before}`);

  // جداول السكرابر قد لا توجد (نطاق بوت آخر) — خروج نظيف لا كسر
  let series: ScSeries[];
  try {
    series = (await prisma.$queryRawUnsafe(
      'SELECT id, canonical_title, slug FROM "series" ORDER BY id')) as ScSeries[];
  } catch {
    console.log('scraper tables absent — nothing to import');
    await prisma.$disconnect();
    return;
  }
  const releases = (await prisma.$queryRawUnsafe(
    'SELECT id, series_id, kind, season_number, title FROM "releases"')) as ScRelease[];
  const episodes = (await prisma.$queryRawUnsafe(
    'SELECT id, release_id, episode_number, title FROM "episodes"')) as ScEpisode[];
  const servers = (await prisma.$queryRawUnsafe(
    `SELECT s.id, s.episode_id, s.provider, s.quality, s.url, s.kind, s.status, s.expires_at,
            e.match_confidence conf
     FROM "servers" s LEFT JOIN "source_entries" e ON e.id = s.source_entry_id
     WHERE s.status IN ('unknown','active')`)) as ScServer[];
  console.log(`scraper: series=${series.length} releases=${releases.length} episodes=${episodes.length} servers(unknown/active)=${servers.length}`);

  const myTitles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true, originalTitle: true,
      seasons: { select: { id: true, number: true, episodes: { select: { id: true, number: true } } } },
    },
  });
  const byKey = new Map<string, typeof myTitles>();
  for (const t of myTitles) {
    const k = seriesKey(t.originalTitle);
    const l = byKey.get(k) ?? [];
    l.push(t);
    byKey.set(k, l);
  }

  const review: string[] = [];
  let createdEp = 0;
  let createdSrc = 0;
  let skipped = 0;

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

  for (const s of series) {
    const key = seriesKey(s.canonical_title);
    const cands = byKey.get(key) ?? [];
    if (cands.length !== 1) {
      review.push(`series "${s.canonical_title.slice(0, 40)}": ${cands.length} matches — review`);
      continue;
    }
    const title = cands[0];
    for (const rel of relBySeries.get(s.id) ?? []) {
      if (rel.kind !== 'season' || rel.season_number == null) {
        review.push(`release "${(rel.title || '').slice(0, 40)}" kind=${rel.kind} — non-season skipped`);
        continue;
      }
      const season = title.seasons.find((x) => x.number === rel.season_number);
      if (!season) {
        review.push(`"${title.originalTitle.slice(0, 35)}" lacks season ${rel.season_number} — review`);
        continue;
      }
      for (const ep of epByRel.get(rel.id) ?? []) {
        const num = parseNum(ep.episode_number);
        if (num == null || num <= 0) {
          review.push(`ep without number in "${title.originalTitle.slice(0, 30)}" — review`);
          continue;
        }
        let myEp = season.episodes.find((e) => e.number === num);
        if (!myEp && go) {
          myEp = await prisma.episode.create({
            data: { seasonId: season.id, number: num, name: cleanEpisodeName(ep.title, num) },
            select: { id: true, number: true },
          });
          createdEp += 1;
        }
        if (!myEp) continue;
        for (const srv of srvByEp.get(ep.id) ?? []) {
          if ((srv.conf ?? 1) < 0.7) {
            skipped += 1;
            continue;
          }
          if (srv.expires_at && new Date(srv.expires_at).getTime() < Date.now()) {
            skipped += 1; // منتهٍ — لا يُستورد كصالح
            continue;
          }
          const isMp4 = /\.mp4(\?|$)/i.test(srv.url.split('?')[0]);
          const data = {
            provider: srv.provider || 'unknown',
            url: srv.url,
            streamUrl: isMp4 ? srv.url : null,
            kind: srv.kind === 'download' ? (isMp4 ? 'mp4' : 'page') : isMp4 ? 'mp4' : 'iframe',
            quality: srv.quality?.trim() || null,
            language: 'ar',
            isDead: false,
            lastSyncedAt: new Date(),
          };
          if (go) {
            await prisma.episodeSource.upsert({
              where: { episodeId_provider_providerId: { episodeId: myEp.id, provider: data.provider, providerId: `sc:${srv.id}` } },
              create: { episodeId: myEp.id, providerId: `sc:${srv.id}`, ...data },
              update: { ...data },
            });
          }
          createdSrc += 1;
        }
      }
    }
  }

  const after = go ? await prisma.episodeSource.count() : before;
  console.log(`\ncreated episodes: ${createdEp}, upserted servers: ${createdSrc}, skipped(low-conf/expired): ${skipped}`);
  console.log(`my EpisodeSource: ${before} → ${after} (+${after - before})`);
  console.log(`review (${review.length}):`);
  for (const r of review.slice(0, 20)) console.log(`  … ${r}`);
  if (review.length > 20) console.log(`  …and ${review.length - 20} more`);
  if (!go) console.log('dry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('import failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
