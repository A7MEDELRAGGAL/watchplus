import type { MetadataRoute } from 'next';

const SITE = process.env.SITE_URL ?? 'https://watchplus.vercel.app';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/browse', '/search', '/title/'],
        disallow: ['/admin', '/api/', '/login', '/register', '/continue', '/favorites', '/watchlist'],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
