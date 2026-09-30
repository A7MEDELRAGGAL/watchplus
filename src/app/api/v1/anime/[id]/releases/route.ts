import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getTitleBySlug } from '@/lib/queries';

export const dynamic = 'force-dynamic';

/** GET /api/v1/anime/{id}/releases — يقبل id أو slug. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  let slug = params.id;
  if (/^c[a-z0-9]{20,}$/.test(params.id)) {
    const row = await prisma.title.findUnique({ where: { id: params.id }, select: { slug: true } });
    if (row) slug = row.slug;
  }
  const t = await getTitleBySlug(slug);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  return NextResponse.json(
    {
      ok: true,
      data: t.seasons.map((s) => ({
        kind: s.number === 0 ? 'movie' : 'season',
        seasonNumber: s.number,
        name: s.name,
        episodeCount: s.episodes.length,
        playableCount: s.episodes.filter((e) => e.sources.some((x) => !x.isDead)).length,
        episodes: s.episodes.map((e) => ({
          id: e.id,
          number: e.number,
          name: e.name,
          playable: e.sources.some((x) => !x.isDead),
          serverCount: e.sources.filter((x) => !x.isDead).length,
        })),
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=600' } },
  );
}
