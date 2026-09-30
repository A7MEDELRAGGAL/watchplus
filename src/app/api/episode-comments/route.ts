import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface CommentRow {
  id: string;
  body: string;
  stars: number | null;
  createdAt: Date;
  username: string;
}

/** GET /api/episode-comments?episodeId= — تعليقات الحلقة + متوسط التقييم. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const episodeId = url.searchParams.get('episodeId') ?? '';
  if (!episodeId) return NextResponse.json({ ok: false, error: 'episodeId required' }, { status: 400 });

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT c."id", c."body", c."stars", c."createdAt", u."username"
     FROM "EpisodeComment" c JOIN "User" u ON u."id" = c."userId"
     WHERE c."episodeId" = $1 ORDER BY c."createdAt" DESC LIMIT 100`,
    episodeId,
  )) as CommentRow[];

  const rated = rows.filter((r) => typeof r.stars === 'number');
  const avg = rated.length ? rated.reduce((n, r) => n + (r.stars ?? 0), 0) / rated.length : null;

  return NextResponse.json(
    { ok: true, data: { count: rows.length, avgStars: avg, comments: rows } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** POST — تعليق/تقييم من مسجل فقط (نص ≤500 حرف، نجوم 1-5 اختيارية). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401 });

  let body: { episodeId?: unknown; body?: unknown; stars?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId : '';
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, 500) : '';
  const stars =
    typeof body.stars === 'number' && Number.isInteger(body.stars) && body.stars >= 1 && body.stars <= 5
      ? body.stars
      : null;
  if (!episodeId || (!text && stars === null)) {
    return NextResponse.json({ ok: false, error: 'episodeId + body/stars required' }, { status: 400 });
  }

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EpisodeComment"("id","episodeId","userId","body","stars","createdAt") VALUES($1,$2,$3,$4,$5,NOW())`,
    id,
    episodeId,
    user.id,
    text,
    stars,
  );
  return NextResponse.json({ ok: true, data: { id } });
}
