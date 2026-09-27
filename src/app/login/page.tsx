import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
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
        <div className="w-full max-w-sm space-y-6">
          <h1 className="text-center text-2xl font-bold tracking-tight">{dict.auth.signIn}</h1>
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
    </div>
  );
}
