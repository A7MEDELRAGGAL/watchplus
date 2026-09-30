import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * GET /api/v1/episodes/{id}/servers — سيرفرات الحلقة بالمصدر والجودة والحالة.
 * ملاحظة أمان مقصودة: لا نكشف روابط الستريم الخام في الـ API العام؛
 * الصفحة الداخلية (/watch) هي التي تشغّل. يُرجع رابط المشاهدة الداخلي.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ep = await prisma.episode.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      number: true,
      name: true,
      season: { select: { number: true, title: { select: { slug: true } } } },
      sources: {
        select: {
          id: true, provider: true, name: true, url: true, streamUrl: true,
          kind: true, quality: true, language: true, isDead: true, lastSyncedAt: true,
        },
        orderBy: { lastSyncedAt: 'desc' },
      },
    },
  });
  if (!ep) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  return NextResponse.json(
    {
      ok: true,
      data: {
        episodeId: ep.id,
        number: ep.number,
        name: ep.name,
        watchUrl: `/watch/${ep.season.title.slug}/${ep.season.number}/${ep.number}`,
        servers: ep.sources.map((s) => ({
          id: s.id,
          provider: hostOf(s.streamUrl || s.url) ?? s.provider,
          label: s.name || s.provider,
          quality: s.quality,
          kind: s.kind,
          language: s.language,
          status: s.isDead ? 'dead' : 'active',
          checkedAt: s.lastSyncedAt,
        })),
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  );
}
