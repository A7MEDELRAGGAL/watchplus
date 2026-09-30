import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { HeroSlider } from '@/components/hero-slider';
import { TitleCard, TitleRow } from '@/components/title-card';
import { TitleRail } from '@/components/title-rail';
import { getDictionary, intlLocale } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';
import { getRows } from '@/lib/queries';
import { getContinueWatching } from '@/lib/library';

// The whole page is per-visitor (locale cookie, fresh catalogue), so never cache it.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const locale = getLocale();
  const dict = getDictionary(locale);
  const user = await getSessionUser();
  const [popular, latest, topRated, anime, movies] = await getRows(20);
  const continueRows = user ? await getContinueWatching(user.id, 12) : [];
  // الأقسام الفارغة تُتخطى بدل عرض بطاقة "لا يوجد شيء" — لا فراغ في الرئيسية.
  const sections = [
    { items: popular, heading: dict.home.popular, href: '/browse?sort=popular' },
    { items: latest, heading: dict.home.latest, href: '/browse?sort=newest' },
    { items: topRated, heading: dict.home.topRated, href: '/browse?sort=rating' },
    { items: anime, heading: dict.home.anime, href: '/browse?type=ANIME' },
    { items: movies, heading: dict.home.movies, href: '/browse?type=MOVIE' },
  ].filter((s) => s.items.length > 0);
  const isEmpty = sections.length === 0;

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} user={user} />

      <main className="container-page space-y-10 py-8">
        {isEmpty ? (
          <section className="card p-8">
            <h1 className="text-2xl font-bold tracking-tight">{dict.siteName}</h1>
            <p className="mt-2 max-w-2xl text-ink-600 dark:text-ink-400">{dict.home.emptyDb}</p>
            <p className="tabular mt-4 text-sm text-ink-500 dark:text-ink-400">
              {new Date().toLocaleDateString(intlLocale(locale))}
            </p>
          </section>
        ) : (
          <>
            {popular.length > 0 ? (
              <HeroSlider
                items={popular}
                locale={locale}
                labels={{
                  slider: dict.home.popular,
                  watch: dict.detail.watchNow,
                  details: dict.detail.overview,
                }}
                typeNames={dict.browse.types}
              />
            ) : null}
            {continueRows.length > 0 ? (
              <TitleRail
                heading={dict.library.continueWatching}
                href="/continue"
                viewAll={dict.common.viewAll}
              >
                {continueRows.map(({ title }) => (
                  <li
                    key={title.id}
                    className="w-[38vw] max-w-[170px] shrink-0 snap-start sm:w-[23vw] md:w-[18vw] lg:w-[13.5vw] lg:max-w-none"
                  >
                    <TitleCard title={title} locale={locale} dict={dict} />
                  </li>
                ))}
              </TitleRail>
            ) : null}
            {sections.map((s) => (
              <TitleRow
                key={s.href}
                title={s.items}
                heading={s.heading}
                href={s.href}
                locale={locale}
                dict={dict}
              />
            ))}
          </>
        )}
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
