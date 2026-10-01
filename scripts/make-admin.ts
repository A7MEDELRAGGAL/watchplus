/* eslint-disable no-console */
/**
 * منح صلاحية الأدمن لحساب مسجل:
 *
 *   npm run make:admin -- --username Ahmed
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
  const i = process.argv.indexOf('--username');
  const username = i > -1 ? process.argv[i + 1] : '';
  if (!username) {
    console.error('usage: npm run make:admin -- --username <name>');
    process.exit(1);
  }
  const u = await prisma.user.update({
    where: { username },
    data: { isAdmin: true },
    select: { username: true, isAdmin: true },
  });
  console.log(`admin: ${u.username} (isAdmin=${u.isAdmin}) — /admin is now visible`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('make-admin failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
