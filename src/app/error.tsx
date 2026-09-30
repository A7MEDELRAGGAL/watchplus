'use client';

import Link from 'next/link';

/** حدّ خطأ عام: رسالة أنيقة وزر رجوع بدل شاشة بيضاء. */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container-page grid min-h-dvh place-content-center gap-4 text-center">
      <p className="tabular text-6xl font-black text-brand-600">!</p>
      <h1 className="text-2xl font-black tracking-tight">حدث خطأ غير متوقع</h1>
      <p className="text-sm text-ink-500 dark:text-ink-400">
        حاول مرة أخرى، أو ارجع للرئيسية.
      </p>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-brand-500"
        >
          إعادة المحاولة
        </button>
        <Link
          href="/"
          className="rounded-xl border border-ink-200 px-5 py-2.5 text-sm font-semibold transition hover:border-brand-500 dark:border-ink-700"
        >
          الرئيسية
        </Link>
      </div>
    </main>
  );
}
