import Link from 'next/link';
import { LocaleToggle } from '@/components/locale-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { SearchBox } from '@/components/search-box';
import { NavLink } from '@/components/nav-link';
import { LogoutButton } from '@/components/library-button';
import type { Session } from '@/lib/auth';
import type { Dict, Locale } from '@/lib/i18n/config';

export function SiteHeader({
  locale,
  dict,
  user = null,
}: {
  locale: Locale;
  dict: Dict;
  user?: Session | null;
}) {
  const links = [
    { href: '/', label: dict.nav.home, exact: true },
    { href: '/browse', label: dict.nav.browse },
    { href: '/search', label: dict.nav.search },
  ];

  // Library links only make sense once there is an account to attach them to.
  const accountLinks = user
    ? [
        { href: '/continue', label: dict.nav.history },
        { href: '/watchlist', label: dict.nav.watchlist },
        { href: '/favorites', label: dict.nav.favorites },
        ...(user.isAdmin ? [{ href: '/admin', label: dict.admin.title }] : []),
      ]
    : [];

  return (
    <header className="sticky top-0 z-40 border-b border-ink-200/80 bg-ink-50/85 backdrop-blur dark:border-ink-800 dark:bg-ink-950/85">
      <div className="container-page flex h-16 items-center gap-2">
        <Link href="/" className="me-2 flex items-center gap-2 font-bold tracking-tight">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-800 text-sm font-black text-white shadow-card"
          >
            W
          </span>
          <span className="hidden sm:inline">{dict.siteName}</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {links.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
        </nav>

        {/* On small screens the account links move to their own row below. */}
        {accountLinks.length > 0 ? (
          <nav className="hidden items-center gap-0.5 lg:flex">
            {accountLinks.map((l) => (
              <NavLink key={l.href} {...l} />
            ))}
          </nav>
        ) : null}

        <div className="ms-auto flex items-center gap-2">
          <SearchBox locale={locale} placeholder={dict.search.placeholder} />
          <ThemeToggle />
          <LocaleToggle locale={locale} label={dict.common.switchLanguage} />
          {user ? (
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-ink-500 sm:inline dark:text-ink-400">
                {user.username}
              </span>
              <LogoutButton label={dict.auth.signOut} />
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              {dict.auth.signIn}
            </Link>
          )}
        </div>
      </div>

      {accountLinks.length > 0 ? (
        <nav className="container-page flex items-center gap-1 overflow-x-auto border-t border-ink-200/60 py-2 lg:hidden dark:border-ink-800/60">
          {accountLinks.map((l) => (
            <NavLink key={l.href} {...l} />
          ))}
        </nav>
      ) : null}
    </header>
  );
}
