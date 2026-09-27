import Image from 'next/image';
import Link from 'next/link';
import { displayTitle, type TitleCardData } from '@/lib/queries';
import type { Dict, Locale } from '@/lib/i18n/config';

function score(t: TitleCardData): string | null {
  return typeof t.rating === 'number' ? t.rating.toFixed(1) : null;
}

export function TitleCard({
  title,
  locale,
  dict,
  priority = false,
}: {
  title: TitleCardData;
  locale: Locale;
  dict: Dict;
  /** only the first row of images should be eager */
  priority?: boolean;
}) {
  const name = displayTitle(title, locale);
  const rating = score(title);
  const year = title.releaseYear;

  return (
    <Link
      href={`/title/${title.slug}`}
      className="group block w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-ink-200 dark:bg-ink-800">
        {title.posterUrl ? (
          <Image
            src={title.posterUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 40vw, (max-width: 1024px) 22vw, 15vw"
            className="object-cover transition duration-300 group-hover:scale-[1.04]"
            priority={priority}
          />
        ) : (
          <div className="grid h-full place-items-center p-3 text-center text-xs text-ink-500">
            {name}
          </div>
        )}

        {rating ? (
          <span className="tabular absolute end-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-amber-300 backdrop-blur">
            {rating}
          </span>
        ) : null}

        {title.isOngoing ? (
          <span className="absolute bottom-1.5 start-1.5 rounded-md bg-brand-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {dict.detail.ongoing}
          </span>
        ) : null}
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug group-hover:text-brand-600 dark:group-hover:text-brand-400">
        {name}
      </p>
      {year ? <p className="tabular text-xs text-ink-500 dark:text-ink-400">{year}</p> : null}
    </Link>
  );
}

export function TitleRow({
  title,
  heading,
  href,
  locale,
  dict,
}: {
  title: TitleCardData[];
  heading: string;
  href: string;
  locale: Locale;
  dict: Dict;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold tracking-tight sm:text-xl">{heading}</h2>
        <Link
          href={href}
          className="shrink-0 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          {dict.common.viewAll}
        </Link>
      </div>

      {title.length === 0 ? (
        <p className="card p-6 text-sm text-ink-500 dark:text-ink-400">{dict.common.empty}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {title.map((t, i) => (
            <li key={t.id}>
              <TitleCard title={t} locale={locale} dict={dict} priority={i < 6} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
