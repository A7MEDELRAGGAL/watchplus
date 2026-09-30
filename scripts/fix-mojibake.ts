/* eslint-disable no-console */
/**
 * Mojibake backfill: episode/title names stored with a broken encoding
 * ("Ø§Ù„Ø­Ù„Ù‚Ø© 10" → "الحلقة 10"). Labels that are UI junk after repair
 * ("مشاهدة وتحميل الآن") become "الحلقة N".
 *
 *   npm run fix:mojibake            dry run
 *   npm run fix:mojibake -- --go    apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { fixMojibake, isJunkLabel } from '../src/lib/scraper/normalize';

// ASCII-safe escapes (لا ليترال ترميز هش هنا)
/* eslint-disable-next-line no-control-regex */
const MOJI = /[\u00D9\u00D8\u00C3\u00C2]/;
// بقايا تلف لا تُصلح (بايتات مفقودة أصلًا) — الرقم سليم في عموده فنستخدمه
const STILL_BROKEN = /[�\u0080-\u009F\u00D8\u00D9\u00C0-\u00CF\u00D7\u00F7\u00A7\u00A9\u00AD\u201E\u0192]/;

function finalName(raw: string, num: number): string {
  const fixed = fixMojibake(raw);
  if (isJunkLabel(fixed) || STILL_BROKEN.test(fixed)) return `الحلقة ${num}`;
  return fixed;
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const eps = await prisma.episode.findMany({
    select: { id: true, number: true, name: true, season: { select: { titleId: true } } },
  });
  const badEp = eps.filter((e) => e.name && MOJI.test(e.name));
  console.log(`mojibake episodes: ${badEp.length}/${eps.length}`);
  let fixedEp = 0;
  for (const e of badEp.slice(0, 15)) {
    console.log(`  "${(e.name || '').slice(0, 40)}" → "${fixMojibake(e.name || '').slice(0, 40)}"`);
  }
  if (go) {
    for (const e of badEp) {
      const name = finalName(e.name || '', e.number);
      await prisma.episode.update({ where: { id: e.id }, data: { name } });
      fixedEp += 1;
    }
    console.log(`fixed episodes: ${fixedEp}`);
  }

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: { id: true, originalTitle: true, titleAr: true },
  });
  const badT = titles.filter((t) => MOJI.test(t.originalTitle) || (t.titleAr && MOJI.test(t.titleAr)));
  console.log(`mojibake titles: ${badT.length}`);
  if (go) {
    for (const t of badT) {
      await prisma.title.update({
        where: { id: t.id },
        data: {
          originalTitle: fixMojibake(t.originalTitle),
          ...(t.titleAr ? { titleAr: fixMojibake(t.titleAr) } : {}),
        },
      });
    }
    console.log(`fixed titles: ${badT.length}`);
  }
  if (!go) console.log('dry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('mojibake failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
