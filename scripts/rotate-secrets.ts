/* eslint-disable no-console */
/**
 * Rotates the two secrets that are safe to rotate from here, without ever
 * printing them.
 *
 *   npm run secrets:rotate
 *
 * AUTH_SECRET and ADMIN_PASSWORD were pasted into a chat log, so both are
 * treated as compromised. This generates fresh values, writes them into `.env`
 * in place, and re-hashes the admin password into the database.
 *
 * The values are deliberately NOT echoed. Printing them would put them back
 * into whatever log ran the command, which is the problem being fixed. Read
 * them out of `.env` yourself and paste them into Vercel / GitHub Actions
 * directly.
 *
 * Two things this cannot do, both web-console work:
 *   - rotate the Neon password (it lives in the connection strings)
 *   - revoke the leaked GitHub token
 * After either, update DATABASE_URL / DIRECT_DATABASE_URL in `.env` and in
 * Vercel + Actions.
 */
import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db';

const ENV_PATH = resolve(process.cwd(), '.env');

/**
 * Replace `KEY=` in place, or append if absent. Anchored on the key name so no
 * other value in the file is touched and a substring match cannot hit a
 * comment or a similarly named key.
 */
function setEnvValue(text: string, key: string, value: string): string {
  const line = new RegExp(`^${key}=.*$`, 'm');
  return line.test(text)
    ? text.replace(line, `${key}=${value}`)
    : `${text.replace(/\s*$/, '')}\n${key}=${value}\n`;
}

/** Enough to confirm "this is the new one" without disclosing it. */
function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function mask(value: string): string {
  return `${value.slice(0, 2)}${'*'.repeat(6)}… (${value.length} chars)`;
}

async function main() {
  const before = readFileSync(ENV_PATH, 'utf8');

  const prevSecret = process.env.AUTH_SECRET ?? '';
  const prevPassword = process.env.ADMIN_PASSWORD ?? '';

  if (!prevSecret) console.log('  note: AUTH_SECRET was not set; generating the first one.');
  if (!prevPassword) console.log('  note: ADMIN_PASSWORD was not set; generating the first one.');

  // 32 bytes of entropy, hex-encoded. Well past the 16-char floor in auth.ts.
  const newSecret = randomBytes(32).toString('hex');
  // 24 bytes, url-safe so it survives copy/paste and cookie/URL contexts.
  const newPassword = randomBytes(24).toString('base64url');

  let after = setEnvValue(before, 'AUTH_SECRET', newSecret);
  after = setEnvValue(after, 'ADMIN_PASSWORD', newPassword);
  writeFileSync(ENV_PATH, after, 'utf8');

  console.log('\n  .env updated');
  console.log(`    AUTH_SECRET      ${mask(newSecret)}   was ${fingerprint(prevSecret)} -> now ${fingerprint(newSecret)}`);
  console.log(`    ADMIN_PASSWORD   ${mask(newPassword)}   was ${fingerprint(prevPassword)} -> now ${fingerprint(newPassword)}`);

  // Re-hash into the database. The seed's upsert also flips isAdmin, so call the
  // same code path rather than reimplementing it.
  const hash = await bcrypt.hash(newPassword, 12);
  const usernames = (process.env.ADMIN_USERS ?? 'ahmed')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const username of usernames) {
    const user = await prisma.user.upsert({
      where: { username },
      create: { username, password: hash, isAdmin: true },
      update: { password: hash, isAdmin: true },
    });
    const ok = await bcrypt.compare(newPassword, user.password);
    console.log(`    admin "${user.username}" re-hashed (${user.password.length} chars, verify=${ok})`);
  }

  console.log('\n  Every existing session is now invalid — that is the point of the rotation.');
  console.log('  Next:');
  console.log('    1. copy AUTH_SECRET out of .env into Vercel and GitHub Actions');
  console.log('    2. log in with the new ADMIN_PASSWORD from .env');
  console.log('    3. rotate the Neon password in the Neon console, then update');
  console.log('       DATABASE_URL and DIRECT_DATABASE_URL in .env / Vercel / Actions');
  console.log('    4. revoke the leaked github_pat_ token in GitHub settings\n');
}

main()
  .catch((err) => {
    console.error('rotation failed:', err instanceof Error ? err.message : err);
    console.error('`.env` may be half-updated — check it before retrying.');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
