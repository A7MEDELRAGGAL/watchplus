import Image from 'next/image';
import Link from 'next/link';
import { TitleRail } from '@/components/title-rail';
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
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-ink-200 shadow-card transition duration-300 group-hover:-translate-y-1 group-hover:shadow-card-hover dark:bg-ink-800">
        {title.posterUrl ? (
          <Image
            src={title.posterUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 40vw, (max-width: 1024px) 22vw, 15vw"
            className="object-cover transition duration-500 group-hover:scale-[1.07]"
            priority={priority}
          />
        ) : (
          <div className="grid h-full place-items-center bg-gradient-to-br from-brand-900 to-ink-900 p-3 text-center text-xs text-white">
            {name}
          </div>
        )}

        {/* cinematic bottom fade with the title baked onto the artwork */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />

        {rating ? (
          <span className="tabular absolute end-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-bold text-amber-300 backdrop-blur">
            ★ {rating}
          </span>
        ) : null}

        {title.isOngoing ? (
          <span className="absolute start-1.5 top-1.5 rounded-md bg-brand-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {dict.detail.ongoing}
          </span>
        ) : null}

        {/* hover play */}
        <span className="absolute inset-0 grid place-items-center opacity-0 transition duration-300 group-hover:opacity-100">
          <span className="grid h-12 w-12 scale-75 place-items-center rounded-full bg-brand-600/95 text-white shadow-card transition duration-300 group-hover:scale-100">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ms-0.5">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="line-clamp-2 text-[13px] font-bold leading-snug text-white">{name}</p>
          <p className="tabular mt-0.5 text-[11px] text-ink-300">
            {[year, dict.browse.types[title.type] ?? title.type].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
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
  if (title.length === 0) {
    return (
      <p className="card p-6 text-sm text-ink-500 dark:text-ink-400">{dict.common.empty}</p>
    );
  }
  return (
    <TitleRail heading={heading} href={href} viewAll={dict.common.viewAll}>
      {title.map((t, i) => (
        <li
          key={t.id}
          className="w-[38vw] max-w-[170px] shrink-0 snap-start sm:w-[23vw] md:w-[18vw] lg:w-[13.5vw] lg:max-w-none"
        >
          <TitleCard title={t} locale={locale} dict={dict} priority={i < 6} />
        </li>
      ))}
    </TitleRail>
  );
}
