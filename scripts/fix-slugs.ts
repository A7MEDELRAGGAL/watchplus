/* eslint-disable no-console */
/**
 * Rewrites ID-shaped slugs into readable ones.
 *
 *   npm run db:slugs -- --dry    show what would change
 *   npm run db:slugs            apply
 *
 * Slugs are only assigned when a title is created, so this cannot live in the
 * scraper: the rows it needs to fix already exist. It is a one-off, kept in
 * the repo so a fresh database or a restored dump can be normalised the same
 * way, and so the change is reviewable.
 *
 * It imports `buildSlug` from the normalizer rather than recomputing the hash,
 * because a second copy of the slug rule is a second thing to keep in sync.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { buildSlug } from '../src/lib/scraper/normalize';
import type { TitleDetail } from '../src/lib/scraper/types';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const DRY = process.argv.includes('--dry');

/** Anything a real id-style slug looks like: `anime-anilist-103303`. */
const ID_SHAPED = /^(anime|movie|tv|series|ona|ova|special)-[a-z0-9]+-\d+$/;

async function main() {
  const rows = await prisma.title.findMany({
    select: { id: true, key: true, slug: true, originalTitle: true, titleEn: true, titleAr: true, type: true },
    orderBy: { slug: 'asc' },
  });

  // Slugs already in use, so a rename can never collide with one it is not
  // about to free up.
  const taken = new Map(rows.map((r) => [r.slug, r.id]));
  const planned: { id: string; from: string; to: string }[] = [];

  for (const r of rows) {
    // Only touch id-shaped slugs; a hand-tuned slug a human chose stays put.
    if (!ID_SHAPED.test(r.slug)) continue;

    const [providerKey, providerId] = r.key.split(':');
    if (!providerKey || !providerId) continue;

    const title = r.titleAr || r.titleEn || r.originalTitle;
    const detail = { providerId, titleEn: r.titleEn, kind: r.type } as unknown as TitleDetail;

    const { slug: base } = buildSlug(detail, title, providerKey);
    if (base === r.slug) continue;

    let candidate = base;
    let n = 2;
    while (taken.has(candidate) && taken.get(candidate) !== r.id) {
      candidate = `${base}-${n}`;
      n += 1;
    }

    taken.delete(r.slug);
    taken.set(candidate, r.id);
    planned.push({ id: r.id, from: r.slug, to: candidate });
  }

  if (!planned.length) {
    console.log(`  nothing to do — all ${rows.length} slugs are already readable\n`);
    return;
  }

  console.log(`\n  ${planned.length} slug(s) to rewrite\n`);
  for (const p of planned.slice(0, 20)) {
    console.log(`    ${p.from}\n      -> ${p.to}`);
  }
  if (planned.length > 20) console.log(`    ...and ${planned.length - 20} more`);

  if (DRY) {
    console.log('\n  dry run, nothing written\n');
    return;
  }

  // One at a time: the unique constraint is on slug, so a parallel batch could
  // order two rows into the same slot. This runs once over a few hundred rows.
  let n = 0;
  for (const p of planned) {
    await prisma.title.update({ where: { id: p.id }, data: { slug: p.to } });
    n += 1;
    if (n % 25 === 0) console.log(`    ${n}/${planned.length}`);
  }
  console.log(`\n  rewrote ${n} slug(s)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
