export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Arabic is the default; the document renders RTL. */
export const DEFAULT_LOCALE: Locale = 'ar';

export const LOCALE_COOKIE = 'wb_locale';

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export const dir = (locale: Locale) => (locale === 'ar' ? 'rtl' : 'ltr');

// ─────────────────────────────────────────────────────────────────────────────
// Dictionary
//
// `ar` is the source of truth and `Dict` is derived from it, so a key added to
// Arabic and forgotten in English is a type error rather than a runtime blank.
// ─────────────────────────────────────────────────────────────────────────────

const ar = {
  siteName: 'WatchBox',
  tagline: 'أفلام ومسلسلات وأنمي',

  nav: {
    home: 'الرئيسية',
    browse: 'تصفح',
    search: 'بحث',
    watchlist: 'قائمة المشاهدة',
    favorites: 'المفضلة',
    history: 'السجل',
  },

  common: {
    loading: 'جارِ التحميل…',
    empty: 'لا يوجد شيء هنا بعد',
    retry: 'إعادة المحاولة',
    viewAll: 'عرض الكل',
    back: 'رجوع',
    from: 'من',
    min: 'دقيقة',
    episode: 'حلقة',
    season: 'موسم',
    seasonOf: 'الموسم',
    noStreams: 'لا يوجد مصدر تشغيل متاح',
    switchLanguage: 'English',
  },

  home: {
    popular: 'الأكثر شعبية',
    latest: 'أضيف مؤخراً',
    topRated: 'الأعلى تقييماً',
    anime: 'أنمي',
    movies: 'أفلام',
    series: 'مسلسلات',
    emptyDb:
      'قاعدة البيانات فارغة. شغّل workflow السكابر من Actions، أو اتركه يعمل كل 6 ساعات.',
  },

  browse: {
    title: 'تصفح',
    type: 'النوع',
    genre: 'التصنيف',
    year: 'السنة',
    sort: 'الترتيب',
    all: 'الكل',
    types: {
      MOVIE: 'أفلام',
      SERIES: 'مسلسلات',
      ANIME: 'أنمي',
      DOCUMENTARY: 'وثائقيات',
    } as Record<string, string>,
    sorts: {
      popular: 'الأكثر شعبية',
      newest: 'الأحدث',
      rating: 'الأعلى تقييماً',
      year: 'الأحدث سنة',
    } as Record<string, string>,
    results: (n: number) => `${n} نتيجة`,
  },

  detail: {
    cast: 'طاقم التمثيل',
    studios: 'الاستوديوهات',
    genres: 'التصنيفات',
    overview: 'القصة',
    noOverview: 'لا يوجد ملخص لهذا العمل.',
    episodes: 'الحلقات',
    watchNow: 'شاهد الآن',
    continueWatching: 'أكمل المشاهدة',
    notAired: 'لم تبث بعد',
    ongoing: 'مستمر',
    ended: 'انتهى',
    sourceCount: (n: number) => (n === 1 ? 'مصدر واحد' : `${n} مصادر`),
  },

  watch: {
    title: 'المشاهدة',
    noEpisodes: 'لا توجد حلقات مسجلة لهذا العمل.',
    pickEpisode: 'اختر حلقة',
    backToDetail: 'صفحة العمل',
    nextEpisode: 'الحلقة التالية',
    previousEpisode: 'الحلقة السابقة',
    autoplay: 'تشغيل التالي تلقائيًا',
    unavailable: 'هذا المصدر غير متاح حالياً',
    openSource: 'فتح المصدر',
    servers: 'سيرفرات المشاهدة',
    downloads: 'روابط التحميل',
    showDead: 'إظهار السيرفرات المعطلة',
    hideDead: 'إخفاء السيرفرات المعطلة',
    report: 'إبلاغ',
    reportTitle: 'الإبلاغ عن مشكلة',
    repDeadVideo: 'فيديو لا يعمل',
    repAudio: 'مشكلة في الصوت',
    repSubtitle: 'مشكلة في الترجمة',
    reportSent: 'وصل بلاغك — السيرفر الآن مشتبه ويُفحص الليلة.',
    reportFailed: 'تعذّر إرسال البلاغ',
    noServers: 'لا تتوفر روابط لهذه الحلقة حاليًا',
    allDead: 'كل سيرفرات هذه الحلقة معطلة حاليًا',
    recheckAt: 'موعد إعادة الفحص',
    needsRefresh: 'الرابط يحتاج تحديثًا',
    requestRefresh: 'طلب تجديد',
    refreshQueued: 'طُلب التجديد — سيُفحص الليلة',
    downloadNow: 'تحميل',
    colHost: 'المضيف',
    colQuality: 'الجودة',
    colSize: 'الحجم',
    colSource: 'المصدر',
    colStatus: 'الحالة',
    colAction: 'تحميل',
    comments: 'التعليقات والتقييم',
    loginToComment: 'سجّل دخولك للتعليق وتقييم الحلقة.',
    commentPh: 'اكتب تعليقك…',
    commentSend: 'إرسال',
    noComments: 'لا تعليقات بعد — كن أول من يعلّق.',
    yourRating: 'تقييمك',
  },

  search: {
    title: 'البحث',
    placeholder: 'ابحث عن فيلم أو مسلسل…',
    submit: 'ابحث',
    resultsFor: (q: string) => `نتائج البحث عن «${q}»`,
    noResults: (q: string) => `مفيش نتائج لـ «${q}»`,
    hint: 'اكتب حرفين على الأقل',
  },

  auth: {
    signIn: 'تسجيل الدخول',
    signUp: 'إنشاء حساب',
    username: 'اسم المستخدم',
    password: 'كلمة المرور',
    toRegister: 'إنشاء حساب جديد',
    toLogin: 'تسجيل الدخول',
    haveAccount: 'عندك حساب بالفعل؟',
    noAccount: 'معندكش حساب؟',
    signedInAs: 'مسجّل باسم',
    signOut: 'خروج',
    signInToSave: 'سجّل دخولك للحفظ',
  },

  library: {
    addFavorite: 'أضف للمفضلة',
    removeFavorite: 'في المفضلة',
    addWatchlist: 'أضف لقائمة المشاهدة',
    removeWatchlist: 'في قائمة المشاهدة',
    favorites: 'المفضلة',
    watchlist: 'قائمة المشاهدة',
    continueWatching: 'أكمل المشاهدة',
    emptyFavorites: 'لسه مافيش حاجات في المفضلة.',
    emptyWatchlist: 'لسه مافيش حاجات في قائمة المشاهدة.',
    emptyContinue: 'مافيش حاجات بدأتها. ابدأ أي حلقة وهرجعلك هنا.',
    progress: (pct: number) => `${Math.round(pct)}%`,
    resume: 'أكمل من حيث توقفت',
  },

  admin: {
    title: 'لوحة الأدمن',
    overview: 'نظرة عامة',
    content: 'المحتوى',
    titles: 'الأعمال',
    episodes: 'الحلقات',
    sources: 'مصادر التشغيل',
    users: 'المستخدمين',
    recentRuns: 'آخر عمليات السكابر',
    noRuns: 'لسه مافيش عمليات سكابر.',
    providers: 'المزوّدون',
    library: 'المكتبة',
    account: 'حسابي',
  },

  footer: {
    rights: 'كل الحقوق محفوظة',
    about: 'الموقع بيجمع بيانات من مصادر مفتوحة.',
  },
};

export type Dict = typeof ar;

const en: Dict = {
  siteName: 'WatchBox',
  tagline: 'Movies, series and anime',

  nav: {
    home: 'Home',
    browse: 'Browse',
    search: 'Search',
    watchlist: 'Watchlist',
    favorites: 'Favorites',
    history: 'History',
  },

  common: {
    loading: 'Loading…',
    empty: 'Nothing here yet',
    retry: 'Try again',
    viewAll: 'View all',
    back: 'Back',
    from: 'from',
    min: 'min',
    episode: 'Episode',
    season: 'Season',
    seasonOf: 'Season',
    noStreams: 'No playable source available',
    switchLanguage: 'العربية',
  },

  home: {
    popular: 'Most popular',
    latest: 'Recently added',
    topRated: 'Top rated',
    anime: 'Anime',
    movies: 'Movies',
    series: 'Series',
    emptyDb: 'The database is empty. Run the scrape workflow from Actions, or let it run every 6 hours.',
  },

  browse: {
    title: 'Browse',
    type: 'Type',
    genre: 'Genre',
    year: 'Year',
    sort: 'Sort',
    all: 'All',
    types: {
      MOVIE: 'Movies',
      SERIES: 'Series',
      ANIME: 'Anime',
      DOCUMENTARY: 'Documentaries',
    },
    sorts: {
      popular: 'Most popular',
      newest: 'Newest',
      rating: 'Top rated',
      year: 'Newest year',
    },
    results: (n: number) => `${n} result${n === 1 ? '' : 's'}`,
  },

  detail: {
    cast: 'Cast',
    studios: 'Studios',
    genres: 'Genres',
    overview: 'Storyline',
    noOverview: 'No synopsis available for this title.',
    episodes: 'Episodes',
    watchNow: 'Watch now',
    continueWatching: 'Resume',
    notAired: 'Not aired yet',
    ongoing: 'Ongoing',
    ended: 'Ended',
    sourceCount: (n: number) => `${n} source${n === 1 ? '' : 's'}`,
  },

  watch: {
    title: 'Watch',
    noEpisodes: 'No episodes have been recorded for this title.',
    pickEpisode: 'Pick an episode',
    backToDetail: 'Title page',
    nextEpisode: 'Next episode',
    previousEpisode: 'Previous episode',
    autoplay: 'Autoplay next',
    unavailable: 'This source is currently unavailable',
    openSource: 'Open source',
    servers: 'Watch servers',
    downloads: 'Download links',
    showDead: 'Show disabled servers',
    hideDead: 'Hide disabled servers',
    report: 'Report',
    reportTitle: 'Report a problem',
    repDeadVideo: 'Dead video',
    repAudio: 'Audio problem',
    repSubtitle: 'Subtitle problem',
    reportSent: 'Report received — the server is now suspect and will be checked tonight.',
    reportFailed: 'Could not send the report',
    noServers: 'No links available for this episode right now',
    allDead: 'All servers for this episode are currently down',
    recheckAt: 'Next recheck',
    needsRefresh: 'Link needs a refresh',
    requestRefresh: 'Request refresh',
    refreshQueued: 'Refresh requested — will be checked tonight',
    downloadNow: 'Download',
    colHost: 'Host',
    colQuality: 'Quality',
    colSize: 'Size',
    colSource: 'Source',
    colStatus: 'Status',
    colAction: 'Get',
    comments: 'Comments & rating',
    loginToComment: 'Sign in to comment and rate this episode.',
    commentPh: 'Write a comment…',
    commentSend: 'Send',
    noComments: 'No comments yet — be the first.',
    yourRating: 'Your rating',
  },

  search: {
    title: 'Search',
    placeholder: 'Search for a movie or series…',
    submit: 'Search',
    resultsFor: (q: string) => `Results for “${q}”`,
    noResults: (q: string) => `No results for “${q}”`,
    hint: 'Type at least two characters',
  },

  auth: {
    signIn: 'Sign in',
    signUp: 'Create account',
    username: 'Username',
    password: 'Password',
    toRegister: 'create an account',
    toLogin: 'sign in',
    haveAccount: 'Already have an account?',
    noAccount: 'No account yet?',
    signedInAs: 'Signed in as',
    signOut: 'Sign out',
    signInToSave: 'Sign in to save',
  },

  library: {
    addFavorite: 'Add to favorites',
    removeFavorite: 'In favorites',
    addWatchlist: 'Add to watchlist',
    removeWatchlist: 'In watchlist',
    favorites: 'Favorites',
    watchlist: 'Watchlist',
    continueWatching: 'Continue watching',
    emptyFavorites: 'Nothing in your favorites yet.',
    emptyWatchlist: 'Nothing in your watchlist yet.',
    emptyContinue: 'Nothing started yet. Start an episode and it will show up here.',
    progress: (pct: number) => `${Math.round(pct)}%`,
    resume: 'Resume',
  },

  admin: {
    title: 'Admin',
    overview: 'Overview',
    content: 'Content',
    titles: 'Titles',
    episodes: 'Episodes',
    sources: 'Playback sources',
    users: 'Users',
    recentRuns: 'Recent scrape runs',
    noRuns: 'No scrape runs recorded yet.',
    providers: 'Providers',
    library: 'Library',
    account: 'My account',
  },

  footer: {
    rights: 'All rights reserved',
    about: 'This site aggregates metadata from open sources.',
  },
};

const DICTIONARIES: Record<Locale, Dict> = { ar, en };

export function getDictionary(locale: Locale): Dict {
  return DICTIONARIES[locale];
}

/** `ar-EG` style tag for `Intl`/`toLocaleDateString`. */
export const intlLocale = (locale: Locale) => (locale === 'ar' ? 'ar-EG' : 'en-US');
