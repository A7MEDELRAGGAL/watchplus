import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { AuthError, createSession, verifyPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) throw new AuthError('Username and password are required.', 400);

    const user = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true, username: true, isAdmin: true, password: true },
    });

    // Same message and roughly the same work for both failures, so the response
    // does not reveal whether an account exists.
    const ok = user ? await verifyPassword(password, user.password) : false;
    if (!user || !ok) throw new AuthError('Incorrect username or password.', 401);

    await createSession(user.id);
    return NextResponse.json({
      user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('login failed:', err);
    return NextResponse.json({ error: 'Login failed.' }, { status: 500 });
  }
}
