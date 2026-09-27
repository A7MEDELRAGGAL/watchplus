import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale } from '@/lib/i18n/server';
import { dir } from '@/lib/i18n/config';

export const metadata: Metadata = {
  title: {
    default: 'WatchBox',
    template: '%s — WatchBox',
  },
  description: 'أفلام ومسلسلات وأنمي في مكان واحد.',
  applicationName: 'WatchBox',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#23262e' },
  ],
};

/**
 * The document language follows the same cookie as the dictionary, so the page
 * renders server-side in the right language with no flash and no mismatch
 * between `dir` and the content. Reading a cookie opts this into dynamic
 * rendering, which every data page already needs anyway.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();

  return (
    <html lang={locale} dir={dir(locale)} suppressHydrationWarning>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
