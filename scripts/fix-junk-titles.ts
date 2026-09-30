/* eslint-disable no-console */
/**
 * Junk-title backfill: titles whose name is an episode label
 * ("الموسم 1 - الحلقة 1") get their real name derived from the source URL
 * slug (…/serie/akame-ga-kill/ → "Akame Ga Kill").
 *
 *   npm run fix:titles            dry run (lists, writes nothing)
 *   npm run fix:titles -- --go    apply
 *
 * Safe: slug/key untouched (URLs stable), only display names + searchBlob.
 * Run `npm run enrich:mal` after --go so MAL/AniList fills proper names,
 * posters and overviews for the renamed rows (their Latin names now match).
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { cleanTitle, isJunkTitle, titleFromUrlSlug } from '../src/lib/scraper/normalize';

const AR = /[\u0600-\u06FF]/;

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const titles = await prisma.title.findMany({
    where: { status: 'PUBLISHED' },
    select: {
      id: true, key: true, originalTitle: true, titleAr: true, titleEn: true, overview: true,
      sources: { select: { url: true } },
    },
  });

  let junk = 0;
  let fixed = 0;
  const preview: { from: string; to: string }[] = [];
  for (const t of titles) {
    const cleaned = cleanTitle(t.originalTitle);
    // مختلط (نظيف ومختلف) أو زائف تمامًا — الاثنان يحتاجان إصلاحًا.
    // فروق الترقيم وحدها (Steins;Gate) ليست سببًا للمساس بالاسم.
    const wordsBefore = t.originalTitle.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const wordsAfter = cleaned.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    const needsClean =
      cleaned !== t.originalTitle &&
      !isJunkTitle(cleaned) &&
      wordsAfter.length < wordsBefore.length;
    if (!needsClean && !isJunkTitle(t.originalTitle)) continue;
    junk += 1;
    let pretty: string | null = needsClean ? cleaned : null;
    if (!pretty) {
      const url = t.sources.map((s) => s.url).find((u) => titleFromUrlSlug(u));
      pretty = url ? titleFromUrlSlug(url) : null;
    }
    if (!pretty) {
      console.log(`  ?? no URL slug for "${t.originalTitle}" (${t.key})`);
      continue;
    }
    const arBad = t.titleAr && isJunkTitle(t.titleAr);
    preview.push({ from: t.originalTitle, to: pretty });
    if (go) {
      await prisma.title.update({
        where: { id: t.id },
        data: {
          originalTitle: pretty,
          titleEn: AR.test(pretty) ? t.titleEn : pretty,
          titleAr: arBad ? null : t.titleAr,
          searchBlob: `${pretty}\n${t.overview ?? ''}`.toLowerCase(),
        },
      });
      fixed += 1;
    }
  }

  console.log(`\njunk titles: ${junk}/${titles.length}`);
  for (const p of preview.slice(0, 25)) console.log(`  "${p.from}"  →  "${p.to}"`);
  if (preview.length > 25) console.log(`  …and ${preview.length - 25} more`);
  if (go) console.log(`renamed: ${fixed}`);
  else console.log('\ndry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('fix failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
