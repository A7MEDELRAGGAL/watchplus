import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/servers/{id}/refresh — طلب تجديد رابط منتهٍ (expires/token).
 * لا يعرضه صالحًا أبدًا: يصفّر الضربات ويعلّمه refreshRequested ليتقدم
 * في طابور الفاحص الليلي الذي يعيد الاستخراج من صفحة المصدر.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const src = await prisma.episodeSource.findUnique({
    where: { id: params.id },
    select: { id: true, headers: true },
  });
  if (!src) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  let meta: { v: number; fails: number; reports?: unknown[]; refreshRequested?: boolean } = {
    v: 1,
    fails: 0,
  };
  try {
    const j = JSON.parse(src.headers ?? '{}') as typeof meta;
    if (j?.v === 1) meta = { ...j };
  } catch {
    /* keep default */
  }
  meta.refreshRequested = true;
  await prisma.episodeSource.update({
    where: { id: src.id },
    data: { headers: JSON.stringify(meta), lastSyncedAt: new Date() },
  });
  return NextResponse.json({ ok: true, data: { id: src.id, queued: true } });
}
