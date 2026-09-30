import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getTitleBySlug, displayTitle, seriesKey } from '@/lib/queries';
import { isLocale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

/** GET /api/v1/anime/{id} — يقبل id (cuid) أو slug. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const url = new URL(request.url);
  const locale = isLocale(url.searchParams.get('locale')) ? url.searchParams.get('locale')! : 'ar';

  // id أولًا (cuid يبدأ بـ c + أحرف)، ثم slug
  let slug = params.id;
  if (/^c[a-z0-9]{20,}$/.test(params.id)) {
    const row = await prisma.title.findUnique({
      where: { id: params.id },
      select: { slug: true },
    });
    if (row) slug = row.slug;
  }
  const t = await getTitleBySlug(slug);
  if (!t) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: t.id,
        slug: t.slug,
        title: displayTitle(t, locale as 'ar' | 'en'),
        type: t.type,
        year: t.releaseYear,
        rating: t.rating,
        posterUrl: t.posterUrl,
        backdropUrl: t.backdropUrl,
        overview: t.overview,
        seriesKey: seriesKey(t.originalTitle),
        episodeCount: t.episodeCount,
        playableCount: t.playableCount,
        seasons: t.seasons.map((s) => ({
          number: s.number,
          name: s.name,
          episodeCount: s.episodes.length,
          playableCount: s.episodes.filter((e) => e.sources.some((x) => !x.isDead)).length,
        })),
      },
    },
    { headers: { 'Cache-Control': 'public, max-age=120, s-maxage=600' } },
  );
}
