'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterServers,
  pickDefault,
  sortServers,
  isReportCategory,
  type ClassifiedServer,
} from '@/lib/servers';

export interface EpisodeViewServer extends ClassifiedServer {
  checkedAt: string | null;
}

interface Labels {
  servers: string;
  downloads: string;
  autoplay: string;
  showDead: string;
  hideDead: string;
  report: string;
  reportTitle: string;
  reportSent: string;
  reportFailed: string;
  retry: string;
  noServers: string;
  allDead: string;
  recheckAt: string;
  needsRefresh: string;
  requestRefresh: string;
  refreshQueued: string;
  download: string;
  openPlayer: string;
  unavailable: string;
  host: string;
  quality: string;
  size: string;
  source: string;
  status: string;
  action: string;
  all: string;
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  suspect: 'bg-amber-500/15 text-amber-400',
  expired: 'bg-sky-500/15 text-sky-400',
  dead: 'bg-red-500/15 text-red-400',
};

/**
 * قلب صفحة الحلقة: مشغّل + سيرفرات مشاهدة + تحميل + بلاغ — بلا reload.
 * آخر اختيار يُحفظ لكل حلقة (wpsrv:<id>) ويُسترجع عند العودة.
 */
export function EpisodeView({
  episodeId,
  servers,
  nextHref,
  labels,
  reportLabels,
  locale,
  startAt = 0,
  signedIn = false,
}: {
  episodeId: string;
  servers: EpisodeViewServer[];
  nextHref: string | null;
  labels: Labels;
  reportLabels: { deadVideo: string; audio: string; subtitle: string };
  locale: 'ar' | 'en';
  startAt?: number;
  signedIn?: boolean;
}) {
  const sorted = useMemo(() => sortServers(servers), [servers]);
  // المشاهدة: الكل (mp4 يشتغل أيضًا) — التحميل: المباشر فقط
  const downloads = useMemo(() => sorted.filter((s) => s.isDownload), [sorted]);

  const qualities = useMemo(
    () => [...new Set(servers.map((s) => s.quality).filter((q): q is string => !!q))],
    [servers],
  );
  const sites = useMemo(() => [...new Set(servers.map((s) => s.provider))], [servers]);

  // الاختيار الافتراضي محسوب أثناء الرسم (SSR يتضمن المشغّل فورًا)،
  // ثم يُستبدل المحفوظ من localStorage بعد التحميل
  const [selectedId, setSelectedId] = useState<string | null>(() => pickDefault(sorted)?.id ?? null);
  const [quality, setQuality] = useState<string | null>(null);
  const [site, setSite] = useState<string | null>(null);
  const [showDead, setShowDead] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reportCat, setReportCat] = useState('dead-video');
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [refreshState, setRefreshState] = useState<Record<string, 'idle' | 'queued'>>({});
  const [dlState, setDlState] = useState<string | null>(null);

  // استرجاع آخر سيرفر + تفضيل التشغيل التلقائي
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`wpsrv:${episodeId}`);
      const ok = sorted.find((s) => s.id === saved && (s.status === 'active' || s.status === 'suspect'));
      setSelectedId(ok ? ok.id : (pickDefault(sorted)?.id ?? null));
      setAutoplay(localStorage.getItem('wpauto') === '1');
    } catch {
      setSelectedId(pickDefault(sorted)?.id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const select = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(`wpsrv:${episodeId}`, id);
    } catch {
      /* ignore */
    }
  };

  const toggleAuto = (v: boolean) => {
    setAutoplay(v);
    try {
      localStorage.setItem('wpauto', v ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const visible = useMemo(
    () => filterServers(sorted, { quality, site, showDead }),
    [sorted, quality, site, showDead],
  );
  const visibleDownloads = useMemo(
    () => filterServers(downloads, { quality, site, showDead }),
    [downloads, quality, site, showDead],
  );
  const selected = sorted.find((s) => s.id === selectedId) ?? null;
  const playable = selected && (selected.status === 'active' || selected.status === 'suspect') ? selected : null;
  const deadCount = sorted.filter((s) => s.status === 'dead').length;

  const src = playable ? playable.streamUrl || playable.url : null;
  const isFile = !!playable?.streamUrl && !/\.m3u8(\?|$)/i.test(playable.streamUrl);
  const isHls = !!playable?.streamUrl && /\.m3u8(\?|$)/i.test(playable.streamUrl);
  const videoRef = useRef<HTMLVideoElement>(null);

  // استئناف + تتبّع التقدم للستريم المباشر فقط (iframe له مشغّله الخاص)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || (!isFile && !isHls)) return;
    const seek = () => {
      if (startAt > 0 && Number.isFinite(video.duration) && startAt < video.duration - 5) {
        video.currentTime = startAt;
      }
    };
    video.addEventListener('loadedmetadata', seek);
    if (!signedIn) return () => video.removeEventListener('loadedmetadata', seek);

    let lastSent = -1;
    const send = (final: boolean) => {
      const seconds = Math.floor(video.currentTime || 0);
      if (seconds < 10) return;
      if (!final && seconds - lastSent < 10) return;
      lastSent = seconds;
      const body = JSON.stringify({ episodeId, seconds });
      if (final && navigator.sendBeacon) {
        navigator.sendBeacon('/api/progress', new Blob([body], { type: 'application/json' }));
        return;
      }
      void fetch('/api/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: final,
      }).catch(() => {});
    };
    const onTick = () => send(false);
    const onPause = () => send(true);
    const onEnd = () => {
      send(true);
      if (autoplay && nextHref) window.location.href = nextHref;
    };
    video.addEventListener('timeupdate', onTick);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnd);
    return () => {
      video.removeEventListener('loadedmetadata', seek);
      video.removeEventListener('timeupdate', onTick);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnd);
      send(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, episodeId, signedIn, autoplay, nextHref]);

  const sendReport = async () => {
    if (!reportFor || !isReportCategory(reportCat)) return;
    setReportState('sending');
    try {
      const r = await fetch(`/api/v1/servers/${reportFor}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: reportCat, episode_id: episodeId }),
      });
      if (!r.ok) throw new Error('bad');
      setReportState('sent');
    } catch {
      setReportState('error');
    }
  };

  const requestRefresh = async (id: string) => {
    try {
      await fetch(`/api/v1/servers/${id}/refresh`, { method: 'POST' });
      setRefreshState((m) => ({ ...m, [id]: 'queued' }));
    } catch {
      /* best effort */
    }
  };

  /** تحميل يبقيك في الموقع: blob أولًا، رابط عادي كاحتياط. */
  const downloadFile = async (s: EpisodeViewServer) => {
    const file = s.streamUrl || s.url;
    setDlState(s.id);
    try {
      const r = await fetch(file, { mode: 'cors' });
      if (!r.ok) throw new Error('fetch failed');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `episode-${s.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      const a = document.createElement('a');
      a.href = file;
      a.download = '';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDlState(null);
    }
  };

  if (servers.length === 0) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-3xl border border-ink-800 bg-black p-6 text-center text-sm text-ink-400">
        {labels.noServers}
      </div>
    );
  }

  if (!playable && deadCount === sorted.length) {
    const oldest = sorted
      .map((s) => s.checkedAt)
      .filter((d): d is string => !!d)
      .sort()[0];
    const recheck = oldest
      ? new Date(new Date(oldest).getTime() + 7 * 86400 * 1000).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')
      : '—';
    return (
      <div className="grid aspect-video w-full place-items-center gap-2 rounded-3xl border border-ink-800 bg-black p-6 text-center">
        <p className="text-sm text-ink-300">{labels.allDead}</p>
        <p className="tabular text-xs text-ink-500">
          {labels.recheckAt}: {recheck}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* المشغّل */}
      <div className="overflow-hidden rounded-3xl border border-ink-800 bg-black">
        <div className="relative aspect-video w-full">
          {!playable || !src ? (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-ink-400">
              {labels.unavailable}
            </div>
          ) : isFile || isHls ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={src}
              ref={videoRef}
              controls
              playsInline
              className="h-full w-full"
            >
              <source src={src} />
            </video>
          ) : (
            <iframe
              key={src}
              src={src}
              title={labels.openPlayer}
              className="h-full w-full"
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-presentation"
            />
          )}
        </div>
      </div>

      {/* السيرفرات */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
            <span aria-hidden className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700" />
            {labels.servers}
          </h2>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-400">
            <button
              type="button"
              role="switch"
              aria-checked={autoplay}
              onClick={() => toggleAuto(!autoplay)}
              className={`relative h-5 w-9 rounded-full transition ${autoplay ? 'bg-brand-600' : 'bg-ink-700'}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${autoplay ? (locale === 'ar' ? 'left-0.5' : 'right-0.5') : locale === 'ar' ? 'right-0.5' : 'left-0.5'}`}
              />
            </button>
            {labels.autoplay}
          </label>
        </div>

        {/* شرائح الفلترة */}
        <div className="flex flex-wrap gap-2">
          <FilterChip active={!quality} onClick={() => setQuality(null)} label={labels.all} />
          {qualities.map((q) => (
            <FilterChip key={q} active={quality === q} onClick={() => setQuality(quality === q ? null : q)} label={q} />
          ))}
          <span aria-hidden className="mx-1 h-5 w-px self-center bg-ink-800" />
          <FilterChip active={!site} onClick={() => setSite(null)} label={labels.all} />
          {sites.map((s) => (
            <FilterChip key={s} active={site === s} onClick={() => setSite(site === s ? null : s)} label={s} />
          ))}
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {visible.map((s) => {
            const active = s.id === selectedId;
            const disabled = s.status === 'expired' || s.status === 'dead';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={disabled && s.id !== selectedId}
                  onClick={() => select(s.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start transition ${
                    active
                      ? 'border-brand-500 bg-brand-600/15 shadow-card'
                      : 'border-ink-800 bg-ink-900 hover:border-brand-700'
                  } ${disabled ? 'opacity-60' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-ink-100">
                      {s.label || s.provider}
                      {s.quality ? <span className="tabular font-normal text-ink-400"> · {s.quality}</span> : null}
                    </span>
                    <span className="tabular block truncate text-[11px] text-ink-500" dir="ltr">
                      {s.provider}
                      {s.host && s.host !== s.provider ? ` · ${s.host}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[s.status]}`}>
                      {s.status}
                    </span>
                    {s.status !== 'expired' && s.status !== 'dead' ? (
                      <span
                        role="button"
                        tabIndex={0}
                        title={labels.report}
                        onClick={(e) => {
                          e.stopPropagation();
                          setReportFor(s.id);
                          setReportState('idle');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            setReportFor(s.id);
                            setReportState('idle');
                          }
                        }}
                        className="rounded-md px-1.5 py-0.5 text-sm text-ink-500 transition hover:bg-ink-800 hover:text-amber-400"
                      >
                        ⚑
                      </span>
                    ) : null}
                  </span>
                </button>
                {s.status === 'expired' ? (
                  <button
                    type="button"
                    onClick={() => requestRefresh(s.id)}
                    className="mt-1 w-full rounded-lg border border-sky-800 bg-sky-950 px-3 py-1.5 text-[11px] text-sky-300 transition hover:bg-sky-900"
                  >
                    {refreshState[s.id] === 'queued' ? labels.refreshQueued : `${labels.needsRefresh} — ${labels.requestRefresh}`}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {deadCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowDead((v) => !v)}
            className="text-xs font-bold text-ink-400 transition hover:text-brand-400"
          >
            {showDead ? labels.hideDead : `${labels.showDead} (${deadCount})`}
          </button>
        ) : null}
      </section>

      {downloads.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight">
            <span aria-hidden className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700" />
            {labels.downloads}
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-ink-800">
            <table className="w-full min-w-[560px] text-start text-xs">
              <thead>
                <tr className="border-b border-ink-800 text-ink-500">
                  {[labels.host, labels.quality, labels.size, labels.source, labels.status, labels.action].map((h) => (
                    <th key={h} className="px-3 py-2 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(showDead || quality || site
                  ? visibleDownloads
                  : downloads.filter((d) => d.status !== 'dead')
                ).map((d) => (
                  <tr key={d.id} className="border-b border-ink-800/60 last:border-0">
                    <td className="tabular px-3 py-2 text-ink-200" dir="ltr">
                      {d.host ?? '—'}
                    </td>
                    <td className="tabular px-3 py-2">{d.quality ?? '—'}</td>
                    <td className="tabular px-3 py-2 text-ink-500">—</td>
                    <td className="px-3 py-2">{d.provider}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[d.status]}`}>
                        {d.status === 'expired' ? labels.needsRefresh : d.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {d.status === 'expired' || d.status === 'dead' ? (
                        <span className="text-ink-600">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => downloadFile(d)}
                          disabled={dlState === d.id}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white transition hover:bg-brand-500 disabled:opacity-60"
                        >
                          {dlState === d.id ? '…' : labels.download}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* حوار البلاغ */}
      {reportFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setReportFor(null)}>
          <div
            role="dialog"
            aria-label={labels.reportTitle}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-ink-700 bg-ink-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-black">{labels.reportTitle}</h3>
            <div className="space-y-2">
              {(
                [
                  ['dead-video', reportLabels.deadVideo],
                  ['audio', reportLabels.audio],
                  ['subtitle', reportLabels.subtitle],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 rounded-xl border border-ink-700 px-3 py-2 text-sm transition hover:border-brand-500">
                  <input
                    type="radio"
                    name="report-cat"
                    checked={reportCat === v}
                    onChange={() => setReportCat(v)}
                    className="accent-rose-600"
                  />
                  {label}
                </label>
              ))}
            </div>
            {reportState === 'sent' ? (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{labels.reportSent}</p>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={sendReport}
                  disabled={reportState === 'sending'}
                  className="flex-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-500 disabled:opacity-60"
                >
                  {labels.report}
                </button>
                <button
                  type="button"
                  onClick={() => setReportFor(null)}
                  className="rounded-xl border border-ink-700 px-4 py-2 text-sm transition hover:bg-ink-800"
                >
                  ✕
                </button>
              </div>
            )}
            {reportState === 'error' ? (
              <button type="button" onClick={sendReport} className="text-xs font-bold text-brand-400 hover:underline">
                {labels.reportFailed} — {labels.retry}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
        active
          ? 'border-brand-500 bg-brand-600 text-white'
          : 'border-ink-800 text-ink-400 hover:border-brand-700 hover:text-ink-200'
      }`}
    >
      {label}
    </button>
  );
}
