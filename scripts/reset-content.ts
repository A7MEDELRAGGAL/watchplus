/* eslint-disable no-console */
/**
 * Wipes imported content so the slug scheme can change without carrying rows
 * written under the old one. Cascades are explicit; `user` is left alone.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

(async () => {
  const force = process.argv.includes('--force');
  if (!force) {
    console.log('This deletes every title/season/episode/stream. Re-run with --force.');
    return;
  }
  await prisma.episodeSource.deleteMany();
  await prisma.playProgress.deleteMany();
  await prisma.watchHistory.deleteMany();
  await prisma.episode.deleteMany();
  await prisma.season.deleteMany();
  await prisma.titleSource.deleteMany();
  await prisma.title.deleteMany();
  await prisma.scrapeRun.deleteMany();
  console.log('content cleared');
  await prisma.$disconnect();
})();
