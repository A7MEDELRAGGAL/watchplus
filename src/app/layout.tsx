import type { Metadata, Viewport } from 'next';
import './globals.css';
import '@fontsource-variable/cairo';
import '@fontsource-variable/inter';
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
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

/**
 * داكن افتراضيًا (مواقع الأنمي العصرية داكنة). السكربت المضمّن يقرأ `wb_theme`
 * قبل الرسم فلا وميض؛ الزر في الهيدر يبدّل ويحفظ.
 */
const THEME_INIT = `(function(){try{var t=localStorage.getItem('wb_theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})();`;

/**
 * The document language follows the same cookie as the dictionary, so the page
 * renders server-side in the right language with no flash and no mismatch
 * between `dir` and the content. Reading a cookie opts this into dynamic
 * rendering, which every data page already needs anyway.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();

  return (
    <html lang={locale} dir={dir(locale)} className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
