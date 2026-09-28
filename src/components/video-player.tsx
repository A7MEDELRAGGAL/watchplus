'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface PlayableSource {
  id: string;
  provider: string;
  /** human label for this mirror, falls back to `provider` */
  name?: string | null;
  url: string;
  streamUrl: string | null;
  kind: string;
  quality: string | null;
  language: string | null;
}

type Resolved =
  | { type: 'iframe'; src: string }
  | { type: 'file'; src: string; mime: string; hls: boolean };

/**
 * Works out what to actually put in the DOM for a source row.
 *
 * A direct stream beats an embed when both exist: the embed is usually an iframe
 * we cannot measure or theme, while a resolved URL plays in our own player and
 * lets us show quality and resume position.
 */
function resolve(source: PlayableSource): Resolved | null {
  if (source.streamUrl) {
    const isHls = /\.m3u8(\?|$)/i.test(source.streamUrl);
    return {
      type: 'file',
      src: source.streamUrl,
      mime: isHls ? 'application/vnd.apple.mpegurl' : 'video/mp4',
      hls: isHls,
    };
  }
  if (source.url && /^https?:\/\//i.test(source.url)) {
    return { type: 'iframe', src: source.url };
  }
  return null;
}

export function VideoPlayer({
  sources,
  startAt = 0,
  episodeId,
  signedIn = false,
  labels,
}: {
  sources: PlayableSource[];
  startAt?: number;
  /** When set (and signed in), playback position is reported to /api/progress. */
  episodeId?: string;
  signedIn?: boolean;
  labels: { unavailable: string; openSource: string; noStreams: string };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const source = sources[index];
  const resolved = useMemo(() => (source ? resolve(source) : null), [source]);

  // Attach hls.js only when the browser cannot play HLS natively (Safari can).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !resolved || resolved.type !== 'file' || !resolved.hls) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) return;

    let hls: import('hls.js').default | null = null;
    let cancelled = false;

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError(labels.unavailable);
          return;
        }
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(resolved.src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return;
          // A dead segment is often transient; a dead manifest is not.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad();
          else setError(labels.unavailable);
        });
      })
      .catch(() => setError(labels.unavailable));

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [resolved, labels.unavailable]);

  useEffect(() => {
    setError(null);
  }, [index]);

  /**
   * Resume, once per source. Attached to the element that actually exists,
   * unlike a helper component whose ref would point somewhere else entirely.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || startAt <= 0) return;
    const seek = () => {
      if (Number.isFinite(video.duration) && startAt < video.duration - 5) {
        video.currentTime = startAt;
      }
    };
    video.addEventListener('loadedmetadata', seek);
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [index, startAt, resolved]);

  /**
   * Watch-progress reporting. Only the <video> element reports, because an
   * <iframe> embed runs someone else's player and we cannot read its clock —
   * progress for embed-only sources has to come from the user finishing the
   * episode instead.
   *
   * Fires every 10s of playback and once more on pause/ended/unmount, so a
   * 40-minute episode is a handful of small writes rather than a stream of them.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !episodeId || !signedIn) return;

    let lastSent = -1;
    const send = (final: boolean) => {
      const seconds = Math.floor(video.currentTime || 0);
      // Skip the very start (not real progress) and avoid duplicate writes.
      if (seconds < 10) return;
      if (!final && seconds - lastSent < 10) return;
      lastSent = seconds;

      const body = JSON.stringify({ episodeId, seconds });
      if (final && navigator.sendBeacon) {
        // A beacon survives the page unloading; fetch would be cancelled.
        navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
        return;
      }
      void fetch('/api/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: final,
      }).catch(() => {
        /* progress is best-effort; never interrupt playback over it */
      });
    };

    const onTick = () => send(false);
    const onEnd = () => send(true);
    const onPause = () => send(true);

    video.addEventListener('timeupdate', onTick);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnd);
    return () => {
      video.removeEventListener('timeupdate', onTick);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnd);
      send(true);
    };
  }, [episodeId, signedIn, index, resolved]);

  if (!sources.length) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-2xl bg-ink-900 text-sm text-ink-400">
        {labels.noStreams}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        {!resolved ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-400">
            {labels.unavailable}
          </div>
        ) : resolved.type === 'iframe' ? (
          <iframe
            key={resolved.src}
            src={resolved.src}
            title="player"
            className="h-full w-full"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            key={resolved.src}
            ref={videoRef}
            controls
            playsInline
            className="h-full w-full"
            poster={undefined}
            onError={() => setError(labels.unavailable)}
          >
            <source src={resolved.src} type={resolved.mime} />
          </video>
        )}
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {sources.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          {sources.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-pressed={i === index}
              className={
                i === index
                  ? 'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white'
                  : 'rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'
              }
            >
              {s.name || s.provider}
              {s.quality ? ` · ${s.quality}` : ''}
            </button>
          ))}
        </div>
      ) : source ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-block text-xs font-medium text-ink-500 underline hover:text-ink-800 dark:text-ink-400"
        >
          {labels.openSource} · {source.provider}
        </a>
      ) : null}
    </div>
  );
}
