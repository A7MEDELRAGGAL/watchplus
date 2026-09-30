CREATE TABLE IF NOT EXISTS "EpisodeComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "episodeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "stars" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EpisodeComment_episodeId_createdAt_idx" ON "EpisodeComment"("episodeId", "createdAt");
