/** هيكل تحميل التصفح: ترويسة + شبكة بطاقات بنبض. */
export default function Loading() {
  return (
    <div className="container-page space-y-8 py-8">
      <div className="h-36 animate-pulse rounded-3xl bg-ink-200 dark:bg-ink-800" />
      <div className="h-32 animate-pulse rounded-2xl bg-ink-200 dark:bg-ink-800" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] animate-pulse rounded-2xl bg-ink-200 dark:bg-ink-800" />
        ))}
      </div>
    </div>
  );
}
