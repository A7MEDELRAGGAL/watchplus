import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { classify, matchesKindGroup, readFails, type KindGroup, type ServerRow } from '@/lib/servers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/episodes/{id}/servers?kind=stream|download — سيرفرات الحلقة
 * بشكل العقد: active ← suspect، والميت والمنتهي معها بشاراتها.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind'); // stream|download|null

  const ep = await prisma.episode.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      number: true,
      name: true,
      season: {
        select: {
          id: true,
          number: true,
          title: { select: { id: true, slug: true } },
        },
      },
      sources: {
        select: {
          id: true, provider: true, name: true, url: true, streamUrl: true,
          kind: true, quality: true, language: true, isDead: true,
          headers: true, lastSyncedAt: true,
        },
      },
    },
  });
  if (!ep) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const rows: ServerRow[] = ep.sources.map((s) => ({
    id: s.id,
    provider: s.provider,
    label: s.name,
    quality: s.quality,
    kind: s.kind,
    url: s.url,
    streamUrl: s.streamUrl,
    isDead: s.isDead,
    fails: readFails(s.headers),
    checkedAt: s.lastSyncedAt.toISOString(),
  }));

  let servers = rows.map(classify);
  // مجموعات kind حسب القيم المخزنة فعلًا (iframe/mp4/page/hls)
  if (kind === 'download' || kind === 'stream') {
    servers = servers.filter((s) => matchesKindGroup(s.kind, kind as KindGroup));
  }

  const order: Record<string, number> = { active: 0, suspect: 1, expired: 2, dead: 3 };
  servers.sort((a, b) => order[a.status] - order[b.status]);

  return NextResponse.json(
    {
      episode: {
        id: ep.id,
        series_id: ep.season.title.id,
        release_id: ep.season.id,
        episode_number: String(ep.number),
      },
      servers: servers.map((s) => ({
        id: s.id,
        provider: s.label || s.provider,
        quality: s.quality ?? 'SD',
        kind: s.isDownload ? 'download' : 'stream',
        source_site: s.provider,
        url: s.streamUrl || s.url,
        status: s.status,
        checked_at: s.checkedAt,
        expires_at: s.expiresAt,
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  );
}
