import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './config';

/**
 * Server-only half of the i18n module.
 *
 * Kept apart from `config.ts` because that file is imported by client components
 * (the locale toggle), and `next/headers` is server-only — bundling it into a
 * client graph fails the build.
 */
export function getLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
