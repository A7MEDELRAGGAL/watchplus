import Link from 'next/link';
import { Logo } from '@/components/logo';
import type { Dict } from '@/lib/i18n/config';

/** فوتر موحّد لكل الصفحات: روابط أقسام + أنواع + هوية. */
export function SiteFooter({ dict }: { dict: Dict }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-16 border-t border-ink-200 bg-ink-50/60 py-10 dark:border-ink-800 dark:bg-ink-950/60">
      <div className="container-page grid gap-8 sm:grid-cols-3">
        <div className="space-y-3">
          <p className="flex items-center gap-2 font-black tracking-tight">
            <Logo size={28} />
            {dict.siteName}
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-ink-500 dark:text-ink-400">
            {dict.footer.about}
          </p>
        </div>

        <nav aria-label="sections" className="space-y-2 text-sm">
          {[
            { href: '/', label: dict.nav.home },
            { href: '/browse', label: dict.nav.browse },
            { href: '/search', label: dict.nav.search },
            { href: '/continue', label: dict.nav.history },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block w-fit text-ink-600 transition hover:text-brand-500 dark:text-ink-400"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="types" className="space-y-2 text-sm">
          {[
            { href: '/browse?type=ANIME', label: dict.browse.types.ANIME ?? 'ANIME' },
            { href: '/browse?type=MOVIE', label: dict.browse.types.MOVIE ?? 'MOVIE' },
            { href: '/browse?sort=rating', label: dict.browse.sorts.rating },
            { href: '/browse?sort=newest', label: dict.browse.sorts.newest },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block w-fit text-ink-600 transition hover:text-brand-500 dark:text-ink-400"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="container-page mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 pt-5 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
        <p>
          © {year} {dict.siteName} — {dict.footer.rights}
        </p>
        <p className="tabular">{dict.tagline}</p>
      </div>
    </footer>
  );
}
