/**
 * Custom image loader.
 *
 * Every remote image is routed through `/api/img`, so a scraped poster can come
 * from any CDN without ever adding a host to `next.config.js`. The proxy is also
 * the only place that needs to enforce the allowlist.
 */
export default function imageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}) {
  if (src.startsWith('/') || src.startsWith('data:')) return src;

  const absolute = src.startsWith('//') ? `https:${src}` : src;
  const params = new URLSearchParams({ url: absolute, w: String(width) });
  params.set('q', String(quality ?? 75));

  return `/api/img?${params.toString()}`;
}
