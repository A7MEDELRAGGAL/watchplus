import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { applyProbe, probeTarget } from '@/lib/server-health';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/servers/{id}/probe — فحص حي للسيرفر وتحديث حالته بدورة الضربات.
 * تُستخدم من زر "اختبار" ومن صفحة المشاهدة للسيرفر الافتراضي.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const src = await prisma.episodeSource.findUnique({
    where: { id: params.id },
    select: { id: true, url: true, streamUrl: true },
  });
  if (!src) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });

  const reachable = await probeTarget(src.streamUrl || src.url);
  const state = await applyProbe(src.id, reachable);
  return NextResponse.json({
    ok: true,
    data: {
      id: src.id,
      reachable,
      status: state.isDead ? 'dead' : state.fails > 0 ? 'suspect' : 'active',
    },
  });
}
