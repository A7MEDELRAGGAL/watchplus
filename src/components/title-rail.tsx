'use client';

import { useRef } from 'react';
import Link from 'next/link';

/** سكة أفقية بأسهم (نتفليكس-ستايل) — البطاقات children من السيرفر. */
export function TitleRail({
  heading,
  href,
  viewAll,
  children,
}: {
  heading: string;
  href: string;
  viewAll: string;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLUListElement>(null);

  const scroll = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-lg font-black tracking-tight sm:text-xl">
          <span aria-hidden className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700" />
          {heading}
        </h2>
        <div className="flex items-center gap-2">
          <div className="hidden gap-1.5 md:flex">
            <button
              type="button"
              onClick={() => scroll(-1)}
              aria-label="previous"
              className="grid h-8 w-8 place-items-center rounded-full border border-ink-200 transition hover:border-brand-500 hover:text-brand-500 dark:border-ink-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scroll(1)}
              aria-label="next"
              className="grid h-8 w-8 place-items-center rounded-full border border-ink-200 transition hover:border-brand-500 hover:text-brand-500 dark:border-ink-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <Link
            href={href}
            className="shrink-0 rounded-full bg-ink-100 px-3 py-1 text-xs font-bold transition hover:bg-brand-600 hover:text-white dark:bg-ink-800 dark:hover:bg-brand-600"
          >
            {viewAll}
          </Link>
        </div>
      </div>

      <ul
        ref={trackRef}
        className="rail -mx-4 flex snap-x gap-3 overflow-x-auto scroll-smooth px-4 pb-2"
      >
        {children}
      </ul>
    </section>
  );
}
