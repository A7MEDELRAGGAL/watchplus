import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/servers/{id}/refresh — طلب تجديد رابط منتهٍ (expires/token).
 * لا يعرضه صالحًا أبدًا: يعلّم refreshRequested + يكتب صفًا في refresh_queue
 * بسكيما السكرابر (site/watch_url/reason/status) ليعيد الاستخراج.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const src = await prisma.episodeSource.findUnique({
    where: { id: params.id },
    select: { id: true, headers: true, episodeId: true, provider: true, url: true, streamUrl: true },
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

  // الجسر لسكيما السكرابر: صف معلق واحد لكل URL
  try {
    const target = src.streamUrl || src.url;
    const dup = (await prisma.$queryRawUnsafe(
      `SELECT id FROM "refresh_queue" WHERE watch_url=$1 AND status='pending' LIMIT 1`,
      target,
    )) as unknown[];
    if (dup.length === 0) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "refresh_queue"("site","watch_url","reason","status","requested_at")
               VALUES($1,$2,'expired','pending',NOW()::text)`,
        src.provider,
        target,
      );
    }
  } catch {
    /* الجدول قد لا يوجد في بيئة قديمة — العلم في headers يكفي */
  }
  return NextResponse.json({ ok: true, data: { id: src.id, queued: true } });
}
