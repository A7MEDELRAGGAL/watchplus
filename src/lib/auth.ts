import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

/**
 * Session handling.
 *
 * A stateless signed cookie, not a session table: the free Postgres tier has no
 * reason to carry a session row per request, and the token is already verified
 * against `AUTH_SECRET` on every read. The trade-off is that a logout cannot
 * revoke an already-issued token before it expires, which is why the lifetime is
 * short and admin actions are not gated on this alone.
 */

export const SESSION_COOKIE = 'wb_session';
const SESSION_DAYS = 30;

/** A miss is a normal state (signed out), not an error. */
export type Session = { id: string; username: string; isAdmin: boolean };
export type SessionUser = Session | null;

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    // Failing loudly beats silently signing with a guessable key.
    throw new Error('AUTH_SECRET is missing or too short (need at least 16 characters)');
  }
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function destroySession(): void {
  cookies().set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}

/** Resolves the signed-in user, or null. Never throws on a bad token. */
export async function getSessionUser(): Promise<SessionUser> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== 'string') return null;

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isAdmin: true },
    });
    return user;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<Session> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('authentication required', 401);
  return user;
}

export async function requireAdmin(): Promise<Session> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('authentication required', 401);
  if (!user.isAdmin) throw new AuthError('admin only', 403);
  return user;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 409 = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

/** Shared validation so the API and the forms cannot disagree. */
export function validateCredentials(username: string, password: string) {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.';
  }
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 200) return 'Password is too long.';
  return null;
}
