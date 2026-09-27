'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  label,
  exact = false,
}: {
  href: string;
  label: string;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-lg bg-ink-100 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:bg-ink-800 dark:text-white'
          : 'rounded-lg px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-white'
      }
    >
      {label}
    </Link>
  );
}
