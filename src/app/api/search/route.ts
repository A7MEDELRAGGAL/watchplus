import { NextResponse } from 'next/server';
import { searchTitles, displayTitle } from '@/lib/queries';
import { isLocale } from '@/lib/i18n/config';

export const dynamic = 'force-dynamic';

/**
 * Typeahead for the search box.
 *
 * Returns a deliberately small shape: a search-as-you-type dropdown needs an id,
 * a label and artwork, and shipping whole title rows would be wasteful.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(20, Math.max(4, Number(url.searchParams.get('limit')) || 8));

  const rawLocale = url.searchParams.get('locale');
  const locale = isLocale(rawLocale) ? rawLocale : 'ar';

  if (query.length < 2) {
    if (url.searchParams.get('envelope') === '1') {
      return NextResponse.json({ ok: true, source: 'site', action: 'search', count: 0, data: [] });
    }
    return NextResponse.json({ results: [] });
  }

  const rows = await searchTitles(query, limit);

  if (url.searchParams.get('envelope') === '1') {
    return NextResponse.json(
      {
        ok: true,
        source: 'site',
        action: 'search',
        count: rows.length,
        data: rows.map((t) => ({
          id: t.id,
          slug: t.slug,
          title: displayTitle(t, locale),
          type: t.type,
          year: t.releaseYear,
          posterUrl: t.posterUrl,
        })),
      },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
    );
  }

  return NextResponse.json(
    {
      results: rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        title: displayTitle(t, locale),
        type: t.type,
        year: t.releaseYear,
        posterUrl: t.posterUrl,
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
  );
}
