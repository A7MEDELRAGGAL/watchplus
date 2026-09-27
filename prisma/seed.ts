/* eslint-disable no-console */
/**
 * Creates the admin account and, if the catalogue is empty, imports a small
 * starter set so the site is never empty on first run.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/db';

const ADMIN_USERS = (process.env.ADMIN_USERS ?? 'ahmed')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.log('ADMIN_PASSWORD is not set — skipping admin creation.');
    console.log('Set it in .env then re-run: npm run db:seed');
  } else {
    const hash = await bcrypt.hash(password, 12);
    for (const username of ADMIN_USERS) {
      const user = await prisma.user.upsert({
        where: { username },
        create: { username, password: hash, isAdmin: true },
        update: { password: hash, isAdmin: true },
      });
      console.log(`admin ready: ${user.username}`);
    }
  }

  const existing = await prisma.title.count();
  if (existing === 0) {
    console.log('catalogue is empty — run `npm run scrape` to fill it.');
  } else {
    console.log(`catalogue holds ${existing} title(s).`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
