'use client';

import { useRouter } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n/config';

/**
 * Switches locale by writing a cookie and refreshing the server render.
 *
 * Going through a cookie rather than client state is deliberate: the whole page
 * is rendered on the server in the target language, so there is no flash of the
 * wrong direction and no need to ship the dictionary to the browser.
 */
export function LocaleToggle({ locale, label }: { locale: Locale; label: string }) {
  const router = useRouter();
  const next: Locale = locale === 'ar' ? 'en' : 'ar';

  function toggle() {
    // A year, so the preference survives the session.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // dir="ltr" keeps the label itself readable when the page is Arabic RTL.
      dir="ltr"
      className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:bg-ink-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
      aria-label={label}
    >
      {label}
    </button>
  );
}
