import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isReportCategory } from '@/lib/servers';

export const dynamic = 'force-dynamic';

function readMeta(headers: string | null): { fails: number; reports: { cat: string; at: string }[] } {
  if (!headers) return { fails: 0, reports: [] };
  try {
    const j = JSON.parse(headers) as { v?: number; fails?: number; reports?: { cat: string; at: string }[] };
    if (j?.v !== 1) return { fails: 0, reports: [] };
    return { fails: j.fails ?? 0, reports: Array.isArray(j.reports) ? j.reports : [] };
  } catch {
    return { fails: 0, reports: [] };
  }
}

/**
 * POST /api/v1/servers/{id}/report {category, episode_id}
 * بلاغ صالح → suspect فورًا (ضربة واحدة، لا حذف) → الفاحص الليلي يتأكد.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: { category?: unknown; episode_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  if (!isReportCategory(body.category) || typeof body.episode_id !== 'string' || !body.episode_id) {
    return NextResponse.json({ ok: false, error: 'category + episode_id required' }, { status: 400 });
  }

  const src = await prisma.episodeSource.findUnique({
    where: { id: params.id },
    select: { id: true, episodeId: true, headers: true, isDead: true },
  });
  if (!src || src.episodeId !== body.episode_id) {
    return NextResponse.json({ ok: false, error: 'server/episode mismatch' }, { status: 404 });
  }

  const meta = readMeta(src.headers);
  meta.reports.push({ cat: body.category, at: new Date().toISOString() });
  const fails = Math.max(meta.fails, 1); // suspect فورًا — لا حذف ولا موت مباشر
  await prisma.episodeSource.update({
    where: { id: src.id },
    data: {
      headers: JSON.stringify({ v: 1, fails, reports: meta.reports.slice(-10) }),
      lastSyncedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, data: { id: src.id, status: 'suspect', reports: meta.reports.length } });
}
