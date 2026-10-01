/* eslint-disable no-console */
/**
 * إصلاح ترقيم الحلقات المخلوط: الاسم يحمل رقمًا ("الحلقة 10") مختلفًا عن
 * رقم الصف، ولا يوجد صف بذلك الرقم — يُعاد ترقيم الصف (آمن تمامًا).
 *
 *   npm run fix:epnums            dry run
 *   npm run fix:epnums -- --go    apply
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

function numInName(name: string | null): number | null {
  if (!name) return null;
  const m = name.match(/(?:الحلقة|حلقة|episode|ep\.?|الحلقه)\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function main() {
  const go = process.argv.includes('--go');
  console.log(go ? 'MODE: apply' : 'MODE: dry run (use --go to apply)');

  const seasons = await prisma.season.findMany({
    select: {
      id: true, number: true,
      title: { select: { originalTitle: true } },
      episodes: { select: { id: true, number: true, name: true } },
    },
  });

  let moves = 0;
  const plan: { show: string; from: number; to: number; name: string }[] = [];
  for (const s of seasons) {
    const taken = new Set(s.episodes.map((e) => e.number));
    // ترتيب تصاعدي لتفادي التصادم أثناء التطبيق
    const cands = s.episodes
      .map((e) => ({ e, want: numInName(e.name) }))
      .filter((x) => x.want != null && x.want !== x.e.number && !taken.has(x.want!))
      .sort((a, b) => a.want! - b.want!);
    for (const c of cands) {
      if (taken.has(c.want!)) continue; // أُخذ أثناء الدفعة
      taken.delete(c.e.number);
      taken.add(c.want!);
      plan.push({ show: s.title.originalTitle.slice(0, 35), from: c.e.number, to: c.want!, name: (c.e.name || '').slice(0, 30) });
      if (go) {
        await prisma.episode.update({ where: { id: c.e.id }, data: { number: c.want! } });
        moves += 1;
      }
    }
  }
  console.log(`renumbers: ${plan.length}`);
  for (const p of plan.slice(0, 25)) console.log(`  "${p.show}" ${p.from} → ${p.to} (${p.name})`);
  if (plan.length > 25) console.log(`  …and ${plan.length - 25} more`);
  if (go) console.log(`applied: ${moves}`);
  else console.log('dry run, nothing written');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('epnums failed:', err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
