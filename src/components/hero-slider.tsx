'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { displayTitle, type TitleCardData } from '@/lib/queries';
import type { Locale } from '@/lib/i18n/config';

const AUTOPLAY_MS = 7000;

/**
 * سينمائي علوي: يعرض الأبرز بخلفية عريضة وتدرجات، تنقّل تلقائي كل 7 ثوانٍ
 * مع أسهم ونقاط. يحترم تقليل الحركة عبر CSS العام.
 *
 * يستقبل نصوصًا مسطّحة فقط (لا كامل `dict` — فيه دوال لا تُسلسل لعميل).
 */
export function HeroSlider({
  items,
  locale,
  labels,
  typeNames,
}: {
  items: TitleCardData[];
  locale: Locale;
  labels: { slider: string; watch: string; details: string };
  typeNames: Record<string, string>;
}) {
  const slides = items.slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + slides.length) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    if (paused || slides.length < 2) return;
    const t = setTimeout(() => go(1), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, paused, slides.length, go]);

  if (!slides.length) return null;
  const current = slides[index];
  const name = displayTitle(current, locale);
  const bg = current.backdropUrl || current.posterUrl;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={labels.slider}
      className="relative overflow-hidden rounded-3xl border border-ink-200 bg-ink-950 dark:border-ink-800"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative aspect-[16/10 sm:aspect-[16/7] lg:aspect-[16/6]">
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={current.id}
            src={`/api/img?url=${encodeURIComponent(bg)}&w=1600&q=70`}
            alt=""
            className="absolute inset-0 h-full w-full animate-fade-in object-cover"
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-ink-950/10" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950/70 via-transparent to-transparent rtl:bg-gradient-to-l" />

        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
          <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
            <span className="rounded-md bg-brand-600 px-2 py-0.5 text-white">
              {typeNames[current.type] ?? current.type}
            </span>
            {typeof current.rating === 'number' ? (
              <span className="tabular rounded-md bg-black/60 px-2 py-0.5 text-amber-300">
                ★ {current.rating.toFixed(1)}
              </span>
            ) : null}
            {current.releaseYear ? (
              <span className="tabular rounded-md bg-black/60 px-2 py-0.5 text-white">
                {current.releaseYear}
              </span>
            ) : null}
          </p>
          <h2 className="max-w-2xl text-2xl font-black tracking-tight text-white sm:text-4xl">
            {name}
          </h2>
          {current.overview ? (
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-ink-200">
              {current.overview}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href={`/title/${current.slug}`}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-card transition hover:bg-brand-500"
            >
              {labels.watch}
            </Link>
            <Link
              href={`/title/${current.slug}`}
              className="rounded-xl border border-white/30 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10"
            >
              {labels.details}
            </Link>
          </div>
        </div>

        {slides.length > 1 ? (
          <>
            <div className="absolute bottom-5 end-5 flex items-center gap-1.5 sm:bottom-8 sm:end-8">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`slide ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={
                    i === index
                      ? 'h-1.5 w-6 rounded-full bg-brand-500'
                      : 'h-1.5 w-1.5 rounded-full bg-white/40 transition hover:bg-white/70'
                  }
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="previous"
              className="absolute start-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur transition hover:bg-brand-600 sm:block"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="next"
              className="absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white backdrop-blur transition hover:bg-brand-600 sm:block"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
