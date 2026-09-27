/* eslint-disable no-console */
/** Prints the request log of the most recent scrape run. */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { fromJsonText } from '../src/lib/db-json';

interface Entry {
  url: string;
  ok: boolean;
  ms: number;
  error?: string;
}

(async () => {
  const run = await prisma.scrapeRun.findFirst({ orderBy: { startedAt: 'desc' } });
  if (!run) {
    console.log('no runs yet');
    return;
  }
  console.log(`run ${run.id} provider=${run.sourceId ?? '-'} status=${run.status}`);
  console.log(`found=${run.found} imported=${run.imported} errors=${run.errors}`);
  const log = fromJsonText<Entry[]>(run.log, []);
  const failed = log.filter((e) => !e.ok);
  console.log(`\nfailures (${failed.length}):`);
  for (const f of failed.slice(0, 12)) {
    console.log(`  ${f.error ?? 'unknown'}`);
  }
  await prisma.$disconnect();
})();
