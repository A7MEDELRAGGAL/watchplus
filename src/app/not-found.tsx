import Link from 'next/link';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';

export default function NotFound() {
  const locale = getLocale();
  const dict = getDictionary(locale);

  return (
    <main className="container-page grid min-h-dvh place-content-center gap-4 text-center">
      <p className="tabular bg-gradient-to-b from-brand-500 to-brand-800 bg-clip-text text-6xl font-black text-transparent">
        404
      </p>
      <h1 className="text-2xl font-black tracking-tight">{dict.common.empty}</h1>
      <Link
        href="/"
        className="mx-auto rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-500"
      >
        {dict.nav.home}
      </Link>
    </main>
  );
}
