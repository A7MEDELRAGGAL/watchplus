/* eslint-disable no-console */
/**
 * Catalogue hygiene: permanently deletes titles that can never display well:
 *  (a) no seasons/episodes at all, (b) navigation junk names (قائمة/رئيسية/…).
 * NOTE: titles WITH episodes but no live sources are KEPT (metadata catalogue
 * from anilist/jikan + streams refresh over time; the homepage already hides
 * stream-less cards via its quality gate).
 *
 *   npm run clean:catalogue            dry run (lists, deletes nothing)
 *   npm run clean:catalogue -- --go    actually delete
 *
 * Re-runnable and safe: only touches PUBLISHED titles matching the rules.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const JUNK_NAMES = [
  'قائمة الأنمي', 'قائمة أفلام الأنمي', 'قوائم', 'عروض موسيقية', 'عروض أخرى',
  'قائمة الأونا', 'قائمة الأوفا', 'القائمه الرئيسيه', 'القائمة الرئيسية',
  'الرئيسية', 'شاهد', 'المزيد', 'عرض الكل', 'تصفح الكل',
];

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: delete' : 'MODE: dry run (use --go to delete)');

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true, key: true, originalTitle: true,
      seasons: {
        select: { episodes: { select: { sources: { where: { isDead: false }, select: { id: true } } } } },
      },
    },
  });

  const condemned: { id: string; key: string; title: string; reason: string }[] = [];
  for (const t of titles) {
    const eps = t.seasons.flatMap((s) => s.episodes);
    const name = t.originalTitle.trim();
    if (JUNK_NAMES.includes(name)) {
      condemned.push({ id: t.id, key: t.key, title: name, reason: 'junk-nav' });
    } else if (eps.length === 0) {
      condemned.push({ id: t.id, key: t.key, title: name.slice(0, 50), reason: 'no-episodes' });
    }
  }

  console.log(`condemned: ${condemned.length}/${titles.length}`);
  for (const c of condemned.slice(0, 30)) console.log(`  [${c.reason}] ${c.title} (${c.key.slice(0, 40)})`);
  if (condemned.length > 30) console.log(`  …and ${condemned.length - 30} more`);

  if (go && condemned.length) {
    const del = await prisma.title.deleteMany({ where: { id: { in: condemned.map((c) => c.id) } } });
    console.log(`deleted: ${del.count}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('clean failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
