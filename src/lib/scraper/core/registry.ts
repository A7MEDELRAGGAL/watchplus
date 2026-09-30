import type { Provider } from '../types';
import { tmdbProvider } from '../providers/tmdb';
import { anilistProvider } from '../providers/anilist';
import { jikanProvider } from '../providers/jikan';
import { csvImportProvider } from '../providers/csv-import';
import { createProvider, loadSourceConfigs } from '../providers/generic-css';

/**
 * Every provider the engine can run, lowest `priority` first.
 *
 * The three built-ins cover the catalogue. Anything declared in
 * sources.config.json / SOURCES_JSON is turned into an HTML provider at load
 * time, so adding a site never means touching this file.
 */
function buildRegistry(): Provider[] {
  const builtIn = [anilistProvider, tmdbProvider, jikanProvider, csvImportProvider];
  const custom = loadSourceConfigs().map(createProvider);
  return [...builtIn, ...custom];
}

let cached: Provider[] | null = null;

function registry(): Provider[] {
  if (!cached) cached = buildRegistry();
  return cached;
}

export function allProviders(): Provider[] {
  return [...registry()].sort((a, b) => a.priority - b.priority);
}

export function getProvider(key: string): Provider | undefined {
  return registry().find((p) => p.key === key);
}

/** Forget the cached registry — used after SOURCES_JSON changes in dev. */
export function resetRegistry() {
  cached = null;
}

/** Providers selected by name, falling back to everything currently usable. */
export function selectedProviders(keys?: string[]): Provider[] {
  const raw = keys?.length ? keys : (process.env.SCRAPER_PROVIDERS ?? '').split(',');
  const list = raw.map((k) => k.trim()).filter(Boolean);

  const all = allProviders();

  if (!list.length || list.includes('*') || list.includes('all')) {
    return all.filter((p) => p.isConfigured());
  }

  const picked = list
    .map((k) => all.find((p) => p.key === k))
    .filter((p): p is Provider => Boolean(p));

  const missing = list.filter((k) => !all.some((p) => p.key === k));
  if (missing.length) {
    console.warn(
      `[registry] unknown provider(s): ${missing.join(', ')}. Available: ${all.map((p) => p.key).join(', ')}`,
    );
  }

  return picked.filter((p) => p.isConfigured());
}
