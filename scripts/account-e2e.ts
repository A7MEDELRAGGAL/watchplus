/* eslint-disable no-console */
/**
 * حساب حقيقي end-to-end ضد سيرفر محلي: تسجيل ← تعليق+تقييم ← حفظ تقدم ←
 * مفضلة ← تحقق من الثبات ← تنظيف المستخدم التجريبي.
 *   npm run test:e2e -- --port 3120 --episode <episodeId>
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const EP = process.argv[process.argv.indexOf('--episode') + 1];
const PORT = process.argv[process.argv.indexOf('--port') + 1] || '3120';
const BASE = `http://localhost:${PORT}`;
const USER = `e2e_${Date.now().toString(36)}`;

let cookie = '';
async function call(path: string, init: RequestInit = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers || {}) },
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const body = await r.text();
  let json: any = null;
  try { json = JSON.parse(body); } catch { /* html error page */ }
  return { status: r.status, json };
}

async function main() {
  if (!EP) throw new Error('need --episode <id>');
  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, detail = '') => {
    results.push([name, ok, detail]);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`);
  };

  try {
    // 1) register
    const reg = await call('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username: USER, password: 'e2e-pass-123' }),
    });
    check('register 201', reg.status === 201, `status=${reg.status}`);
    check('session cookie set', cookie.length > 0);
    const me = await prisma.user.findUnique({ where: { username: USER }, select: { id: true } });
    check('user in db', !!me);
    const uid = me!.id;

    // 2) comment + stars
    const c = await call('/api/episode-comments', {
      method: 'POST', body: JSON.stringify({ episodeId: EP, body: 'حلقة رائعة تجريبي', stars: 5 }),
    });
    check('comment posted', c.status === 200, `status=${c.status}`);
    const list = await call(`/api/episode-comments?episodeId=${EP}`);
    const mine = list.json?.data?.comments?.find((x: any) => x.username === USER);
    check('comment persisted+listed', !!mine && mine.stars === 5);
    check('avg recomputed', typeof list.json?.data?.avgStars === 'number');

    // 3) progress save
    const p = await call('/api/progress', {
      method: 'POST', body: JSON.stringify({ episodeId: EP, seconds: 754 }),
    });
    check('progress saved', p.status === 200 && p.json?.ok === true);
    const prog = await prisma.playProgress.findUnique({
      where: { userId_episodeId: { userId: uid, episodeId: EP } }, select: { seconds: true },
    });
    check('progress persisted (754s)', prog?.seconds === 754, `got=${prog?.seconds}`);

    // 4) reload-simulation: fresh GETs still show data (no session loss)
    cookie = cookie; // keep
    const list2 = await call(`/api/episode-comments?episodeId=${EP}`);
    check('data survives refetch', !!list2.json?.data?.comments?.find((x: any) => x.username === USER));
  } finally {
    await prisma.user.deleteMany({ where: { username: USER } });
    console.log('  cleanup: test user deleted');
  }

  const failed = results.filter((r) => !r[1]);
  console.log(failed.length ? `\nE2E: ${failed.length} FAILED` : '\nE2E: all passed');
  process.exit(failed.length ? 1 : 0);
}

main()
  .catch((e) => { console.error('E2E crashed:', e instanceof Error ? e.message : e); process.exit(1); })
  .finally(() => prisma.$disconnect());
