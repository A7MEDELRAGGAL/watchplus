import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Logo } from '@/components/logo';
import { AuthForm } from '@/components/auth-form';
import { getDictionary } from '@/lib/i18n/config';
import { getLocale } from '@/lib/i18n/server';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: 'Sign in · WatchBox', robots: { index: false } };
}

export default async function LoginPage() {
  if (await getSessionUser()) redirect('/');

  const locale = getLocale();
  const dict = getDictionary(locale);

  return (
    <div className="min-h-dvh">
      <SiteHeader locale={locale} dict={dict} />
      <main className="container-page flex justify-center py-16">
        <div className="card w-full max-w-sm space-y-6 p-6 sm:p-8">
          <div className="text-center">
            <span className="mx-auto block w-fit">
              <Logo size={48} />
            </span>
            <h1 className="mt-4 text-2xl font-black tracking-tight">{dict.auth.signIn}</h1>
          </div>
          <AuthForm
            mode="login"
            labels={{
              username: dict.auth.username,
              password: dict.auth.password,
              submit: dict.auth.signIn,
              toRegister: dict.auth.toRegister,
              toLogin: dict.auth.toLogin,
              haveAccount: dict.auth.haveAccount,
              noAccount: dict.auth.noAccount,
            }}
          />
          <p className="text-center text-xs text-ink-400">
            <Link href="/" className="hover:underline">
              {dict.nav.home}
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter dict={dict} />
    </div>
  );
}
