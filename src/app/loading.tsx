/** هيكل تحميل الرئيسية: سلايدر + صفوف بطاقات بنبض. */
export default function Loading() {
  return (
    <div className="min-h-dvh">
      <div className="container-page space-y-10 py-8">
        <div className="relative aspect-[16/10] animate-pulse overflow-hidden rounded-3xl bg-ink-200 sm:aspect-[16/7] lg:aspect-[16/6] dark:bg-ink-800" />
        {[0, 1].map((r) => (
          <div key={r} className="space-y-3">
            <div className="h-6 w-40 animate-pulse rounded-lg bg-ink-200 dark:bg-ink-800" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[2/3] w-[38vw] max-w-[170px] shrink-0 animate-pulse rounded-2xl bg-ink-200 sm:w-[23vw] md:w-[18vw] lg:w-[13.5vw] lg:max-w-none dark:bg-ink-800"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
