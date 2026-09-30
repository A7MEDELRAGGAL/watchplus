/* temp: count playback links */
import { prisma } from '../../src/lib/db';

async function main() {
  const [links, withStream, dead] = await Promise.all([
    prisma.episodeSource.count(),
    prisma.episodeSource.count({ where: { streamUrl: { not: null } } }),
    prisma.episodeSource.count({ where: { isDead: true } }),
  ]);
  console.log({ links, withStream, dead });
  await prisma.$disconnect();
}

main();
