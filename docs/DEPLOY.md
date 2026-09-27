# دليل النشر — Deploy Guide

الهدف: الموقع شغال على **Vercel**، الداتابيز على **Neon**، والسكابر يشتغل أوتوماتيك كل 6 ساعات من **GitHub Actions**.
كله مجاني، ومفيش بطاقة بنكية مطلوبة.

الترتيب مهم: Neon الأول، لأنه Vercel و GitHub Actions بيقروا من نفس الداتابيز.

---

## 1. Neon — قاعدة البيانات (مجاني)

1. ادخل [console.neon.tech](https://console.neon.tech) وسجّل دخول بـ GitHub.
2. **Create a project** باسم مثل `watchbox`، والمنطقة `AWS US East (Ohio)`.
3. اختار **Free plan** (0.5 GB — كفاية لآلاف العناوين).
4. من **Connection Details** انسخ الـ connection string. هتلاقي **petite** أو `-pooler` في الـ hostname:
   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   - الـ `-pooler` ده اللي تستخدمه للتطبيق والسكابر (بيدعم aggregation).
5. اعمل **branch** جديد اسمه `dev` (Neon بيعمله مجاناً): من **Branches → Add** → `dev`.
   ده اللي تربطه بجهازك لو حبيت تشغّل محلياً، عشان ما تلمسش بيانات الإنتاج.
6. انسخ الـ connection string بتاع الـ `dev` branch كمان (من غير `-pooler`، عشان migrations).

> **ليه Postgres مش SQLite؟** Vercel filesystem مؤقت، فلو deploy بـ SQLite هتلاقي البيانات بتختفي مع كل deployment. الـ schema دلوقتي postgresql، ومفيش حاجة رجعت لـ SQLite.

---

## 2. GitHub — ارفع الكود

```bash
cd anime-movies-site
git init
git add .
git commit -m "feat: scraper engine, UI shell and free deploy setup"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

لازم يكون الـ repo **public** عشان Actions المجاني يبقى مفعّل بلا حدود.
لو محببش يكون private، Github Actions برضه بيشتغل لكن بحدود أقل (2,000 دقيقة/شهر للـ private) — ودي كفاية للمشروع ده.

---

## 3. GitHub Actions — تشغيل السكابر (مجاني)

الملف `.github/workflows/scrape.yml` موجود وشغال كل **6 ساعات**، بالجدول `11 */6 * *` بتوقيت UTC.

**قبل ما تشغله، لازم تعدّل سطر واحد:**
`.github/workflows/scrape.yml` → السطر ده:
```yaml
if: github.repository_owner == 'YOUR_GITHUB_USERNAME' || github.event_name == 'workflow_dispatch'
```
غيّر `YOUR_GITHUB_USERNAME` لاسم المستخدم بتاعك على GitHub. الشرط ده موجود عشان ما تتحملش طلبات من حسابك لو الـ repo اتعمل fork.

**بعدين أضف الـ Secrets** من `Settings → Secrets and variables → Actions`:

| الاسم | القيمة |
|---|---|
| `DATABASE_URL` | connection string بتاع Neon (الـ `-pooler`) |
| `DIRECT_DATABASE_URL` | نفس الـ string بس بالـ hostname المباشر (من غير `-pooler`) — عشان `prisma db push` |
| `AUTH_SECRET` | ناتج `openssl rand -base64 32` |
| `SCRAPER_PROVIDERS` | `anilist,jikan` (أو `anilist,jikan,tmdb`) |
| `TMDB_API_KEY` | اختياري — من [themoviedb.org](https://www.themoviedb.org/settings/api) |
| `SOURCES_JSON` | اختياري — لمصادر HTML إضافية |

لتشغيله يدوي أول مرة: **Actions → scrape → Run workflow**.

> **ليه مش Vercel Cron؟** الخطة المجانية بتشغّل cron **مرة واحدة في اليوم** بس، وكمان كل function محدود بـ 300 ثانية. ده قليل جداً لزحف على الكتالوج. الـ workflow مافيش حد زمني وده اللي خلّى الاختيار ده.

---

## 4. Vercel — الموقع (مجاني)

1. ادخل [vercel.com](https://vercel.com) وسجّل دخول بـ GitHub.
2. **Add New → Project** واختار الـ repo بتاعك، سيب framework `Next.js` متعرّف عليه أوتوماتيك.
3. **Environment Variables** — ضيف نفس المفاتيح دي:
   - `DATABASE_URL` ← نفس بتاع Neon
   - `AUTH_SECRET` ← نفس الـ secret
   - `NEXT_PUBLIC_SITE_URL` ← بعد ما يطلعلك الدومين، مثلاً `https://watchbox.vercel.app`
   - `ADMIN_USERS` و `ADMIN_PASSWORD` — حساب الأدمن
   - `IMAGE_PROXY_TTL` = `86400` (اختياري)
4. **Deploy**.

الإعدادات في `vercel.json` بتتظبط لوحدها: `buildCommand: prisma generate && next build`، و region `iad1` (نفس منطقة Neon عشان تقل latency).

### أول ما يعمل deploy
افتح الموقع. الصفحة الرئيسية بتقرأ من الداتابيز مباشرة وبتعرض 3 أرقام:
- **العناوين** — لو 0، القاعدة فاضية (مفيش scrape لسه)
- **الحلقات** — نفس الفكرة
- **آخر تشغيل** — لو التاريخ ظاهر، السكابر اشتغل

لو الأرقام ظهرت، يبقى الـ connection string والـ pooler والـ schema كلهم مظبوطين. لو ظهر error 500، غالباً `DATABASE_URL` ناقص أو الـ schema اتعمل لـ SQLite — راجع الخطوات فوق.

---

## 5. (اختياري) دومين خاص

من Vercel: **Project → Settings → Domains → Add**. اربطه بـ Cloudflare أو Namecheap. مش ضروري للمشروع ده — الـ `.vercel.app` subdomain كافي تمامًا.

---

## ملاحظات مهمة

**البيانات نضيفة على طول**
`ScrapeRun` بيتسجل في كل تشغيل. لو شفت `partial` مع وجود errors، ده **عادي** — AniList و Jikan بيرفضوا الطلبات لما تطلع بسرعة، والـ retry بيحاول تاني. الـ workflow مش بيحمر بسبب ده، لأنه بعتبره نجاح طالما استورد حاجة.

**`prisma db push` مقابل migrations**
الـ workflow بيستخدم `db push` لأن المشروع لسه مافيهوش migration history. أول ما تبدأ تغيّر الـ schema بانتظام، اعمل migrations و commitها:
```bash
npx prisma migrate dev --name init
npx prisma migrate deploy   # في الـ workflow بدل db push
```

**Sources الإضافية**
لسه مافيش مصادر HTML مربوطة (اختّرت تأجّل). لما تقرر، شوف README → "Adding a new source" واعمل config JSON، وحطه في `SOURCES_JSON` secret.

## الخطوات الجاية

الواجهة كاملة ومبنية: الرئيسية، التصفح بالفلاتر، صفحات التفاصيل، المشغّل (HLS/MP4/iframe) مع استكمال المشاهدة، البحث، الحسابات، والمكتبة. كل الصفحات server-rendered.

اللي اتعمل:

- **حسابات**: تسجيل/دخول/خروج بـ `jose` (HS256 cookie) و `bcryptjs`. مافيش خدمة auth خارجية عشان نفضل على الـ free tier.
- **المكتبة**: `/favorites` و `/watchlist` و `/continue` (اللي بدأه من الحلقات).
- **متابعة المشاهدة**: `PlayProgress` بيتكتب كل 10 ثواني + `sendBeacon` عند الإغلاق، والمشغّل يعمل resume.
- **لوحة الأدمن** `/admin`: إحصائيات المحتوى، حالة كل provider (rate، آخر run، الأخطاء)، وسجل آخر 20 عملية سكابر.
- **الـ scraper بقى أسهل**: `npm run probe -- <url>` يطلّع config جاهز، و `npm run robots -- <url>` يقولك الموقع سماح بالزحف ولا لأ.

اللي فاضل:

- **اختبار حقيقي على Neon**: مافيش instance شغال، فالـ runtime queries (خصوصاً فلتر التصنيف بالـ `LIKE` على JSON text) محتاجين أول deploy يجاوب. صمّمته defensively بس ده جملة واحدة أغيرها لو ال LIKE طلع بطيء على الكتالوج الكبير.
- **مفيش مصادر HTML مربوطة**: شوف README → "Adding a new source". الـ workflow بيشغّل AniList + Jikan حالياً.
- **تعدد اللغات بمسارات** (`/en/...`): التبديل شغال بالـ cookie، بس مافيش URL مختلف لكل لغة.

---

## troubleshooting سريع

| المشكلة | السبب | الحل |
|---|---|---|
| `error: P1001 Can't reach database` | الـ URL غلط أو الـ pooler مش صح | تأكد إن `DATABASE_URL` فيه `-pooler` و `sslmode=require` |
| `Error: P1012 schema is empty` | الـ tables متعملتش | شغّل الـ workflow مرة، أو `npx prisma db push` |
| الأرقام 0 على الموقع | مافيش scrape اشتغل | Actions → scrape → Run workflow |
| `HTTP 429` كتير | scraper سريع أوي | نزّل `SCRAPER_MAX_PAGES`، وخلي `SCRAPER_PROVIDERS` provider واحد |
| `HTTP 504` من Jikan | Jikan بيرفض التوازي | الـ concurrency متظبطة 2 بالفعل، استنى وشغّل تاني |
| Build فشل على Vercel | `prisma generate` محتاج `DATABASE_URL` | موجود في build env vars برضو — شيله لو مش محتاج |
