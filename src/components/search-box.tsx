'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Locale } from '@/lib/i18n/config';

interface Hit {
  id: string;
  slug: string;
  title: string;
  type: string;
  year: number | null;
  posterUrl: string | null;
}

/** بحث حي في الهيدر: اقتراحات بالبوستر أثناء الكتابة (debounce 300ms). */
export function SearchBox({ locale, placeholder }: { locale: Locale; placeholder: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=6&locale=${locale}`);
        const j = (await r.json()) as { results?: Hit[] };
        setHits(j.results ?? []);
        setOpen(true);
      } catch {
        /* offline — stay silent */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, locale]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative hidden md:block">
      <form
        action="/search"
        method="get"
        role="search"
        onSubmit={() => setOpen(false)}
        className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25 dark:border-ink-700 dark:bg-ink-900"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0 text-ink-400">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-36 bg-transparent text-sm outline-none transition-all placeholder:text-ink-400 focus:w-52"
        />
      </form>

      {open && hits.length > 0 ? (
        <ul className="absolute end-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-card-hover dark:border-ink-700 dark:bg-ink-900">
          {hits.map((h) => (
            <li key={h.id}>
              <Link
                href={`/title/${h.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 p-2.5 transition hover:bg-ink-100 dark:hover:bg-ink-800"
              >
                {h.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={h.posterUrl} alt="" className="h-12 w-9 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="h-12 w-9 shrink-0 rounded-md bg-ink-200 dark:bg-ink-700" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{h.title}</span>
                  <span className="tabular block text-[11px] text-ink-500 dark:text-ink-400">
                    {[h.type, h.year].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
