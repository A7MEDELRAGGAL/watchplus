import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { toJsonText } from '@/lib/db-json';
import type { NormalizedEpisode, NormalizedSeason, NormalizedTitle } from '../normalize';
import type { Provider } from '../types';

export interface UpsertResult {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * `Title.slug` is unique and is a public URL, so it must never be handed out
 * twice. Providers already namespace ids by source, but a source with dirty ids
 * (or a rename) can still collide; rather than letting the unique constraint
 * abort the whole run, suffix the slug until it is free.
 */
async function claimSlug(
  tx: Prisma.TransactionClient,
  desired: string,
  providerKey: string,
  providerId: string,
): Promise<string> {
  const taken = await tx.title.findUnique({ where: { slug: desired }, select: { key: true } });
  if (!taken || taken.key === `${providerKey}:${providerId}`) return desired;

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${desired}-${n}`;
    const clash = await tx.title.findUnique({ where: { slug: candidate }, select: { key: true } });
    if (!clash || clash.key === `${providerKey}:${providerId}`) return candidate;
  }
  return `${desired}-${providerKey}-${providerId}`;
}

/**
 * Write one normalised title, replacing its seasons/episodes/links wholesale.
 *
 * Wholesale replacement is deliberate: the source is authoritative for the rows
 * it owns, and delete-then-insert is what stops stale episodes from lingering
 * after a source renumbers them. Everything happens inside one transaction, so
 * a failure part-way leaves the previous season set intact.
 *
 * The upsert is keyed on `key` (provider:providerId), so two providers scraping
 * the same film produce two rows; the merge step is what decides they are one
 * title.
 */
export async function upsertTitle(
  data: NormalizedTitle,
  provider: Provider,
  stats: UpsertResult,
): Promise<string> {
  const existing = await prisma.title.findUnique({
    where: { key: data.key },
    select: { id: true },
  });

  const providerId = data.key.slice(provider.key.length + 1);

  const scalars = {
    originalTitle: data.originalTitle,
    titleAr: data.titleAr,
    titleEn: data.titleEn,
    overview: data.overview,
    tagline: data.tagline,
    posterUrl: data.posterUrl,
    backdropUrl: data.backdropUrl,
    releaseDate: data.releaseDate,
    runtimeMin: data.runtimeMin,
    showStatus: data.showStatus,
    cast: toJsonText(data.cast),
    genres: toJsonText(data.genres),
    studios: toJsonText(data.studios),
    countries: toJsonText(data.countries),
    extra: toJsonText(data.extra),
    rating: data.rating,
    votesCount: data.votesCount,
    popularity: data.popularity,
    totalSeasons: data.totalSeasons,
    totalEpisodes: data.totalEpisodes,
    latestEpisode: data.latestEpisode,
    nextEpisodeAt: data.nextEpisodeAt,
    isOngoing: data.isOngoing,
    siteRank: data.siteRank,
    searchBlob: data.searchBlob,
  };

  const titleId = await prisma.$transaction(async (tx) => {
    const title = existing
      ? await tx.title.update({
          where: { key: data.key },
          data: { ...scalars, releaseYear: data.releaseYear ?? undefined },
        })
      : await tx.title.create({
          data: {
            key: data.key,
            type: data.type,
            slug: await claimSlug(tx, data.slug, provider.key, providerId),
            ...scalars,
            releaseYear: data.releaseYear,
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        });

    await tx.titleSource.upsert({
      where: { provider_providerId: { provider: provider.key, providerId } },
      create: {
        titleId: title.id,
        provider: provider.key,
        providerId,
        url: data.sourceUrl,
        lastSyncedAt: new Date(),
      },
      update: { url: data.sourceUrl, lastSyncedAt: new Date(), isDead: false },
    });

    // A movie has no seasons, but the player needs somewhere to hang its links.
    // Season 0 / episode 1 gives it a home and keeps the player code uniform.
    const seasons: NormalizedSeason[] =
      data.movieStreams.length > 0
        ? [
            {
              number: 0,
              name: 'Full movie',
              overview: null,
              posterUrl: null,
              airDate: null,
              episodes: [movieAsEpisode(data)],
            },
          ]
        : data.seasons;

    if (seasons.length) {
      await tx.season.deleteMany({ where: { titleId: title.id } });
      for (const season of seasons) {
        await writeSeason(tx, title.id, season, provider);
      }
    }

    return title.id;
  });

  if (existing) stats.updated += 1;
  else stats.created += 1;

  return titleId;
}

function movieAsEpisode(data: NormalizedTitle): NormalizedEpisode {
  return {
    number: 1,
    name: data.originalTitle,
    overview: data.overview,
    stillUrl: null,
    runtime: data.runtimeMin,
    airDate: data.releaseDate,
    durationS: data.runtimeMin ? data.runtimeMin * 60 : null,
    streams: data.movieStreams,
  };
}

async function writeSeason(
  tx: Prisma.TransactionClient,
  titleId: string,
  season: NormalizedSeason,
  provider: Provider,
) {
  const created = await tx.season.create({
    data: {
      titleId,
      number: season.number,
      name: season.name,
      overview: season.overview,
      posterUrl: season.posterUrl,
      airDate: season.airDate,
    },
  });

  for (const episode of season.episodes) {
    await writeEpisode(tx, created.id, episode, provider);
  }
}

async function writeEpisode(
  tx: Prisma.TransactionClient,
  seasonId: string,
  episode: NormalizedEpisode,
  provider: Provider,
) {
  const created = await tx.episode.create({
    data: {
      seasonId,
      number: episode.number,
      name: episode.name,
      overview: episode.overview,
      stillUrl: episode.stillUrl,
      runtime: episode.runtime,
      airDate: episode.airDate,
      durationS: episode.durationS,
    },
  });

  for (const stream of episode.streams) {
    const providerKey = stream.provider || provider.key;
    const providerId = stream.providerId || `${providerKey}-${episode.number}`;

    await tx.episodeSource.upsert({
      where: {
        episodeId_provider_providerId: {
          episodeId: created.id,
          provider: providerKey,
          providerId,
        },
      },
      create: {
        episodeId: created.id,
        provider: providerKey,
        providerId,
        url: stream.url,
        streamUrl: stream.streamUrl,
        kind: stream.kind,
        quality: stream.quality,
        language: stream.language,
        headers: toJsonText(stream.headers),
      },
      update: {
        url: stream.url,
        streamUrl: stream.streamUrl,
        kind: stream.kind,
        quality: stream.quality,
        language: stream.language,
        headers: toJsonText(stream.headers),
        isDead: false,
        lastSyncedAt: new Date(),
      },
    });
  }
}
