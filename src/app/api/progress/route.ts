import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { recordProgress } from '@/lib/library';

export const dynamic = 'force-dynamic';

/** POST /api/progress { episodeId, seconds } */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { episodeId?: unknown; seconds?: unknown };
    if (typeof body.episodeId !== 'string' || !body.episodeId) {
      throw new Error('episodeId is required');
    }
    const seconds = typeof body.seconds === 'number' ? body.seconds : Number(body.seconds);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('seconds must be >= 0');

    const { done } = await recordProgress(user.id, body.episodeId, seconds);
    return NextResponse.json({ ok: true, done });
  } catch (err) {
    const status = err instanceof Error && err.message === 'authentication required' ? 401 : 400;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
