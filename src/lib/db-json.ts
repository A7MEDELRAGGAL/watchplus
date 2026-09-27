/**
 * JSON-in-a-text-column helpers.
 *
 * These columns are `String?` holding JSON text rather than Prisma's `Json`
 * type. That was forced by SQLite, but it is kept deliberately: the queries read
 * the same on either engine and the blobs are only ever decoded here, never
 * queried into. The searchable copy of this data lives in `Title.searchBlob`.
 *
 * If the schema ever grows a real `TitleGenre` join table, genres become real
 * rows and this file shrinks to the fields with no better home.
 */

/** Serialise for storage. Returns undefined for anything unserialisable. */
export function toJsonText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Parse a stored column, falling back to `fallback` on anything unexpected. */
export function fromJsonText<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** Same as fromJsonText but for nullable fields — returns undefined on failure. */
export function fromJsonTextOpt<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}
