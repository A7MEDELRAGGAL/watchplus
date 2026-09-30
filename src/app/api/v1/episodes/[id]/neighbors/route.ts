import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** GET /api/v1/episodes/{id}/neighbors — الحلقة السابقة/التالية في نفس الموسم. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const ep = await prisma.episode.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      number: true,
      season: {
        select: {
          id: true,
          number: true,
          title: { select: { slug: true } },
          episodes: {
            orderBy: { number: 'asc' },
            select: { id: true, number: true, name: true },
          },
        },
      },
    },
  });
  if (!ep) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const idx = ep.season.episodes.findIndex((e) => e.id === ep.id);
  const fmt = (e: { id: string; number: number; name: string | null } | undefined) =>
    e
      ? {
          id: e.id,
          episode_number: String(e.number),
          name: e.name,
          watchUrl: `/watch/${ep.season.title.slug}/${ep.season.number}/${e.number}`,
        }
      : null;

  return NextResponse.json(
    {
      ok: true,
      data: {
        prev: idx > 0 ? fmt(ep.season.episodes[idx - 1]) : null,
        next: idx >= 0 && idx < ep.season.episodes.length - 1 ? fmt(ep.season.episodes[idx + 1]) : null,
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=600' } },
  );
}
