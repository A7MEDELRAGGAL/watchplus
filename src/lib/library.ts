import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { TITLE_SELECT, type TitleCardData } from '@/lib/queries';

export type ContinueRow = {
  progress: { seconds: number; ratio: number };
  episode: { id: string; number: number };
  seasonNumber: number;
  title: TitleCardData;
};

/**
 * The signed-in user's library.
 *
 * Every mutation is idempotent: adding twice is the same as adding once, and
 * toggling is expressed as a single `deleteMany`/`upsert` pair so a double-click
 * cannot create duplicates or race into a unique-constraint error.
 */

export type LibraryKind = 'favorites' | 'watchlist';

export async function isInLibrary(kind: LibraryKind, userId: string, titleId: string) {
  const count =
    kind === 'favorites'
      ? await prisma.favorite.count({ where: { userId, titleId } })
      : await prisma.watchlist.count({ where: { userId, titleId } });
  return count > 0;
}

/** Adds if missing, removes if present. Returns the resulting state. */
export async function toggleLibrary(
  kind: LibraryKind,
  userId: string,
  titleId: string,
): Promise<boolean> {
  if (kind === 'favorites') {
    const existing = await prisma.favorite.findUnique({
      where: { userId_titleId: { userId, titleId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.favorite.delete({ where: { id: existing.id } });
      return false;
    }
    await prisma.favorite.create({ data: { userId, titleId } });
    return true;
  }

  const existing = await prisma.watchlist.findUnique({
    where: { userId_titleId: { userId, titleId } },
    select: { id: true },
  });
  if (existing) {
    await prisma.watchlist.delete({ where: { id: existing.id } });
    return false;
  }
  await prisma.watchlist.create({ data: { userId, titleId } });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Continue watching
// ─────────────────────────────────────────────────────────────────────────────

/** Below this the user is treated as having barely started. */
const MIN_PROGRESS_S = 15;
/** At or past this the title is finished and leaves the "continue" row. */
const DONE_RATIO = 0.93;

/**
 * Records playback and returns whether the title should stay in the list.
 *
 * The episode is resolved from the id, and the title is resolved from the
 * season, so callers only need the episode id they already have.
 */
export async function recordProgress(
  userId: string,
  episodeId: string,
  seconds: number,
): Promise<{ done: boolean }> {
  const safeSeconds = Math.max(0, Math.floor(seconds || 0));

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { id: true, runtime: true, season: { select: { titleId: true } } },
  });
  if (!episode) return { done: true };

  // Fall back to the stored duration when the source omitted the runtime.
  const secondsLong =
    episode.runtime && episode.runtime > 0 ? episode.runtime * 60 : (safeSeconds || 1);
  const done = safeSeconds / secondsLong >= DONE_RATIO;

  await prisma.$transaction([
    prisma.playProgress.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: { userId, episodeId, seconds: safeSeconds },
      update: { seconds: safeSeconds },
    }),
    prisma.watchHistory.upsert({
      where: { id: `${userId}:${episodeId}` },
      create: {
        id: `${userId}:${episodeId}`,
        userId,
        titleId: episode.season.titleId,
        episodeId,
        seconds: safeSeconds,
        completed: done,
      },
      update: { seconds: safeSeconds, completed: done, watchedAt: new Date() },
    }),
  ]);

  return { done };
}

/**
 * Titles the user has part-watched, most recent first.
 *
 * Progress rows are per episode, so one title can have several. This keeps the
 * most recent unfinished episode and drops the title entirely once any episode
 * is past DONE_RATIO — otherwise finishing S1E1 would keep the show in "continue"
 * because S1E2 is still unwatched.
 */
export async function getContinueWatching(userId: string, limit = 12) {
  const rows = await prisma.playProgress.findMany({
    where: { userId, seconds: { gte: MIN_PROGRESS_S } },
    orderBy: { updatedAt: 'desc' },
    // Over-fetch: duplicates and finished titles are filtered out below.
    take: limit * 4,
    select: {
      seconds: true,
      episode: {
        select: {
          id: true,
          number: true,
          runtime: true,
          season: {
            select: {
              number: true,
              title: { select: TITLE_SELECT },
            },
          },
        },
      },
    },
  });

  const finished = new Set<string>();
  const claimed = new Set<string>();
  const out: ContinueRow[] = [];

  for (const row of rows) {
    const title = row.episode.season.title;
    if (finished.has(title.id) || claimed.has(title.id)) continue;

    const total = row.episode.runtime ? row.episode.runtime * 60 : row.seconds;
    if (total <= 0) continue;
    const ratio = Math.min(1, row.seconds / total);

    if (ratio >= DONE_RATIO) {
      finished.add(title.id);
      continue;
    }
    if (ratio <= 0.01) continue;

    claimed.add(title.id);
    out.push({
      progress: { seconds: row.seconds, ratio },
      episode: { id: row.episode.id, number: row.episode.number },
      seasonNumber: row.episode.season.number,
      title,
    });
    if (out.length >= limit) break;
  }

  return out;
}

/** Convenience for server components that just want the current user. */
export { getSessionUser };

/** Titles the user has saved to a list, newest save first. */
export async function getLibraryTitles(kind: LibraryKind, userId: string, limit = 60) {
  const rows =
    kind === 'favorites'
      ? await prisma.favorite.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { title: { select: TITLE_SELECT } },
        })
      : await prisma.watchlist.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: { title: { select: TITLE_SELECT } },
        });

  return rows.map((r) => r.title);
}
