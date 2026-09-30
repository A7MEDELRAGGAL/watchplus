import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';

const SITE = process.env.SITE_URL ?? 'https://watchplus.vercel.app';

export const dynamic = 'force-dynamic';

/** خريطة الموقع: الصفحات الثابتة + كل عناوين الكتالوج (للأرشفة). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE}/browse`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${SITE}/search`, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });
  await prisma.$disconnect().catch(() => {});

  return [
    ...staticPages,
    ...titles.map((t) => ({
      url: `${SITE}/title/${encodeURIComponent(t.slug)}`,
      lastModified: t.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
