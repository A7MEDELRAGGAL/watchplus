import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { displayTitle } from '@/lib/queries';
import { isLocale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/anime — فهرس الأعمال (قراءة فقط، لا روابط ستريم مباشرة).
 * يدعم: q, type, sort(rating|popular|newest), available=1, minRating, page, perPage + ?envelope=1
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const type = url.searchParams.get('type') ?? undefined;
  const sort = url.searchParams.get('sort') ?? 'popular';
  const available = url.searchParams.get('available') === '1';
  const minRatingRaw = url.searchParams.get('minRating') ?? url.searchParams.get('rating');
  const minRating = Number(minRatingRaw);
  // status=COMPLETED|ONGOING (يتطابق مع isOngoing)
  const status = (url.searchParams.get('status') ?? '').toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const perPage = Math.min(48, Math.max(1, Number(url.searchParams.get('perPage')) || 24));
  const locale = isLocale(url.searchParams.get('locale')) ? url.searchParams.get('locale')! : 'ar';

  const where = {
    status: 'PUBLISHED',
    ...(type ? { type } : {}),
    ...(Number.isFinite(minRating) && minRating > 0 ? { rating: { gte: minRating } } : {}),
    ...(status === 'COMPLETED' ? { isOngoing: false } : {}),
    ...(status === 'ONGOING' ? { isOngoing: true } : {}),
    ...(available
      ? { seasons: { some: { episodes: { some: { sources: { some: { isDead: false } } } } } } }
      : {}),
    ...(q.length >= 2
      ? { OR: [{ searchBlob: { contains: q } }, { originalTitle: { contains: q, mode: 'insensitive' as const } }] }
      : {}),
  };
  const order =
    sort === 'rating'
      ? [{ rating: 'desc' as const }, { votesCount: 'desc' as const }]
      : sort === 'newest'
        ? [{ createdAt: 'desc' as const }]
        : [{ popularity: 'desc' as const }];

  const [total, rows] = await Promise.all([
    prisma.title.count({ where }),
    prisma.title.findMany({
      where,
      select: {
        id: true, slug: true, type: true, originalTitle: true, titleAr: true, titleEn: true,
        releaseYear: true, rating: true, posterUrl: true, totalEpisodes: true, isOngoing: true,
      },
      orderBy: order,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  const data = rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    title: displayTitle(t, locale as 'ar' | 'en'),
    type: t.type,
    year: t.releaseYear,
    rating: t.rating,
    posterUrl: t.posterUrl,
    totalEpisodes: t.totalEpisodes,
    isOngoing: t.isOngoing,
  }));

  if (url.searchParams.get('envelope') === '1') {
    return NextResponse.json({ ok: true, source: 'site', action: 'anime', count: data.length, data });
  }
  return NextResponse.json(
    { ok: true, page, perPage, total, pageCount: Math.max(1, Math.ceil(total / perPage)), data },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  );
}
