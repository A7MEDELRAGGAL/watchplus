import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { toggleLibrary, type LibraryKind } from '@/lib/library';

export const dynamic = 'force-dynamic';

function parseKind(value: string | null): LibraryKind | null {
  return value === 'favorites' || value === 'watchlist' ? value : null;
}

/** POST /api/library?kind=favorites  { titleId } -> { inLibrary: boolean } */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const kind = parseKind(new URL(request.url).searchParams.get('kind'));
    if (!kind) throw new Error('kind must be favorites or watchlist');

    const body = (await request.json()) as { titleId?: unknown };
    if (typeof body.titleId !== 'string' || !body.titleId) {
      throw new Error('titleId is required');
    }

    // Confirm the title exists so a stale client cannot create dangling rows.
    const exists = await prisma.title.count({ where: { id: body.titleId } });
    if (exists === 0) throw new Error('unknown title');

    const inLibrary = await toggleLibrary(kind, user.id, body.titleId);
    return NextResponse.json({ inLibrary });
  } catch (err) {
    const status = err instanceof Error && err.message === 'authentication required' ? 401 : 400;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}

/** DELETE /api/library?kind=favorites&titleId=... */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const kind = parseKind(params.get('kind'));
    const titleId = params.get('titleId');
    if (!kind || !titleId) throw new Error('kind and titleId are required');

    if (kind === 'favorites') {
      await prisma.favorite.deleteMany({ where: { userId: user.id, titleId } });
    } else {
      await prisma.watchlist.deleteMany({ where: { userId: user.id, titleId } });
    }
    return NextResponse.json({ inLibrary: false });
  } catch (err) {
    const status = err instanceof Error && err.message === 'authentication required' ? 401 : 400;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
