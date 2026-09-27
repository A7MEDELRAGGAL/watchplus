# WatchBox

Movies, series and anime in one place. Arabic-first with an English toggle.

Metadata comes from open APIs; playback links come from whatever sources you
configure and are licensed to use. See **Legal** at the bottom.

## Stack

| | |
|---|---|
| Framework | Next.js 14 (App Router, React Server Components) |
| Database | PostgreSQL via Prisma — Neon free tier |
| Styling | Tailwind CSS, logical properties so RTL needs no extra classes |
| Player | native `<video>` + hls.js for `.m3u8`, `<iframe>` for embeds |
| Auth | jose-signed httpOnly cookie (bcryptjs for passwords) |
| Scraping | own engine: retry, rate limiting, cache, incremental upserts |
| Deploy | Vercel (site) + GitHub Actions (scraper) + Neon (data) — all free |

## Getting started

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL (Neon) and AUTH_SECRET
npx prisma db push        # create tables
npm run db:seed           # create the admin user
npm run dev
```

Local work should point at the **dev branch** of your Neon project, not the main
one, so a `db push` cannot damage production.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | `prisma generate` + production build |
| `npm test` | offline self-test of the robots matcher and URL helpers |
| `npm run scrape` | run every configured provider |
| `npm run scrape -- anilist --pages 3` | one provider, N listing pages |
| `npm run scrape -- anilist --ids 21,16498` | re-fetch specific ids |
| `npm run scrape:dry` | report what would be written, write nothing |
| `npm run probe -- <url>` | inspect a listing page, print a starter source config |
| `npm run robots -- <url>` | show what an origin's robots.txt permits |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | create/update the admin user |

`scripts/inspect.ts` prints a few titles and the table counts; `scripts/runs.ts`
prints the request log of the last scrape run. Both are dev conveniences.

## Layout

```
prisma/schema.prisma          data model
src/app/                      routes (all server-rendered on demand)
  page.tsx                    home: hero + rows per type
  browse/                     catalogue with type/genre/year/sort facets
  title/[slug]/               detail: cast, genres, seasons, save buttons
  watch/[slug]/[s]/[e]/       player + episode picker + resume
  search/                     full-text search over searchBlob
  login/  register/           account
  favorites/  watchlist/  continue/   the signed-in user's library
  admin/                      source health + scrape run history
  api/auth/{login,register,logout}/
  api/library/                favorites + watchlist toggle
  api/progress/               watch-position writes
  api/img/                    image proxy (SSRF-guarded)
  api/search/                 typeahead JSON
src/components/               header, cards, player, forms, locale toggle
src/lib/queries.ts            every read the catalogue performs
src/lib/auth.ts               session signing, password hashing, guards
src/lib/library.ts            favourites, watchlist, progress, continue row
src/lib/i18n/                 ar/en dictionaries; server-only half in server.ts
src/lib/scraper/              the scraping engine
  core/                       http, html, rate limiting, robots, registry
  providers/                  anilist, jikan, tmdb, generic-css
  pipeline/                   run orchestration, upsert
docs/DEPLOY.md                step-by-step deploy
```

## Accounts

No third-party auth service: a `jose` HS256 token in an httpOnly cookie, with
`bcryptjs` for passwords. That keeps the whole thing on the free tier and avoids
an OAuth round trip for what is a username and a password.

The token is stateless, so signing out cannot revoke a token that was already
issued — it only clears the cookie. The 30-day expiry bounds that, and admin
access is checked against the database on every request rather than trusted from
the token. If you ever need real revocation, the fix is a `Session` table with a
`jti` column and a denylist lookup, not a longer-lived cookie.

Watch position is reported from the `<video>` element every 10 seconds and once
more on pause, via `navigator.sendBeacon` so the last write survives a page
close. An `<iframe>` embed runs someone else's player, so its progress is not
observable — embed-only episodes rely on the next-episode link instead.

## i18n

Arabic is the source of truth for the dictionary, so a key added there and
forgotten in English is a type error. The locale lives in a cookie and the page
renders on the server in the target language — the toggle sets the cookie and
refreshes, so there is no flash and no dictionary shipped to the browser.

To add a language: add it to `LOCALES` in `src/lib/i18n/config.ts` and translate
the `en` entry. RTL is driven by the `dir` attribute plus Tailwind logical
properties (`ms-*`, `pe-*`, `start-*`), so a new RTL language needs no CSS work.

## Adding a new source

Any site with a predictable URL shape works as config — no new code. You do not
have to write the selectors by hand.

### 1. Check the site permits crawling

```bash
npm run robots -- https://example.com/browse
```

This prints the origin's `robots.txt` and the verdict for your crawler token. If
the path is disallowed, either target a different path or — if the site is yours
— set `"ignoreRobots": true` in the config. The provider obeys `robots.txt` and
any `Crawl-delay` by default, for the same reason Jikan answers `504` instead of
`429` when you go too fast: a well-behaved crawler is the one that keeps working.

### 2. Generate a first draft

```bash
npm run probe -- https://example.com/browse
```

The probe fetches the page and reports what it finds: JSON-LD blocks and their
types, which repeating element is a catalogue card (with the three parsed rows
printed so a wrong guess is obvious), the title/link/poster selectors inside it,
and the pagination template. It ends with a config ready to paste.

It guesses. Read the output before trusting it, and run the probe on **one detail
page** too, since that is where the overview, genres and episode list come from.

### 3. Review, enable, and test on a small run

```json
[
  {
    "id": "example",
    "name": "Example",
    "baseUrl": "https://example.com",
    "type": "movie",
    "enabled": true,
    "priority": 50,
    "list": {
      "url": "https://example.com/browse?page={page}",
      "item": "div.card",
      "title": { "selector": "h2.title" },
      "urlField": { "selector": "a", "attr": "href" },
      "minItems": 6
    },
    "detail": {
      "title": { "selector": "h1" },
      "overview": { "selector": "div.synopsis" },
      "poster": { "selector": "img.poster", "attr": "src" },
      "year": { "selector": "span.year" },
      "genres": "a.genre"
    },
    "episodes": [
      {
        "item": "div.episode",
        "season": 1,
        "number": { "selector": "span.n" },
        "title": { "selector": "span.t" }
      }
    ]
  }
]
```

Selectors are standard Cheerio. `::text` and `::attr(name)` also work as
selectors. An array field collects many values. `{page}`, `{start}` and
`{query}` are substituted in the list URL. `minItems` is the "we have hit the
end" threshold — a page with fewer items than that ends the crawl.

Leave fields out and the provider falls back to JSON-LD, so a usable config is
often just `{ "list": { "url": ..., "item": ... } }`.

Then run it small before running it wide:

```bash
npm run scrape -- example --pages 2 --dry
```

For anything that needs real logic, write a provider file instead: implement
`discover()` and `fetchDetail()`, and return a `rateLimit` reflecting what the
origin tolerates. `maxConcurrency` exists because some origins answer `504`
rather than `429` when hit in parallel.

## Legal

This project aggregates **metadata** from open APIs (AniList, Jikan, TMDB). It
ships no copyrighted media and contains no links to infringing streams.

Playback rows (`EpisodeSource`) are whatever the operators configure. Only point
`sources` at content you have the right to use, and only link to material you
are authorised to distribute. Operating a public catalogue of unlicensed streams
is copyright infringement in essentially every jurisdiction, and it is also the
fastest way to have a domain seized.
