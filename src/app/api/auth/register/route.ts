import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  AuthError,
  createSession,
  hashPassword,
  validateCredentials,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let username = '';
  let password = '';

  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    username = typeof body.username === 'string' ? body.username.trim() : '';
    password = typeof body.password === 'string' ? body.password : '';

    const invalid = validateCredentials(username, password);
    if (invalid) throw new AuthError(invalid, 400);

    // Case-insensitive uniqueness: "Ahmed" and "ahmed" should not both exist.
    const taken = await prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (taken) throw new AuthError('That username is taken.', 409);

    const user = await prisma.user.create({
      data: { username, password: await hashPassword(password) },
      select: { id: true, username: true, isAdmin: true },
    });

    await createSession(user.id);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('register failed:', err);
    return NextResponse.json({ error: 'Registration failed.' }, { status: 500 });
  }
}
