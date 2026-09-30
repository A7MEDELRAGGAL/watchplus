/** هيكل تحميل صفحة العمل: بانر + بوستر + نصوص بنبض. */
export default function Loading() {
  return (
    <div className="min-h-dvh">
      <div className="h-56 animate-pulse bg-ink-200 sm:h-72 dark:bg-ink-800" />
      <div className="container-page space-y-10 py-8">
        <div className="-mt-24 grid gap-6 sm:grid-cols-[200px_1fr]">
          <div className="mx-auto aspect-[2/3] w-full max-w-[200px] animate-pulse rounded-2xl bg-ink-300 sm:mx-0 dark:bg-ink-700" />
          <div className="space-y-3 pt-24 sm:pt-28">
            <div className="h-9 w-2/3 animate-pulse rounded-xl bg-ink-200 dark:bg-ink-800" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-6 w-20 animate-pulse rounded-full bg-ink-200 dark:bg-ink-800" />
              ))}
            </div>
            <div className="h-24 w-full animate-pulse rounded-xl bg-ink-200 dark:bg-ink-800" />
          </div>
        </div>
      </div>
    </div>
  );
}
