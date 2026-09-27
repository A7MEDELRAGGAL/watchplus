import { PrismaClient } from '@prisma/client';

/**
 * One client, the pooled endpoint.
 *
 * There is no direct/non-pooled variant, and that is deliberate. The scraper's
 * upserts used to run inside one interactive transaction, and a transaction-mode
 * pooler is free to hand that connection to another session mid-callback — when
 * it does, Postgres reports the transaction as closed ("Transaction not found
 * ... obtained before disconnecting") and the items in flight are lost.
 *
 * Rather than route the scraper at a direct endpoint, which the free compute
 * will not even accept connections on while suspended, the writes were made
 * pooler-safe: each statement is atomic on its own and keyed on a unique
 * constraint. Long-held sessions are the thing to avoid on a serverless
 * database, not something to route around.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
