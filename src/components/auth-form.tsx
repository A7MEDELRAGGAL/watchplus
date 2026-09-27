'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function AuthForm({
  mode,
  labels,
}: {
  mode: 'login' | 'register';
  labels: {
    username: string;
    password: string;
    submit: string;
    toRegister: string;
    toLogin: string;
    haveAccount: string;
    noAccount: string;
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: data.get('username'),
          password: data.get('password'),
        }),
      });
      const payload = (await res.json()) as { error?: string };

      if (!res.ok) {
        setError(payload.error ?? 'Something went wrong.');
        setBusy(false);
        return;
      }
      // A full refresh so the server re-renders the header with the new session.
      router.push('/');
      router.refresh();
    } catch {
      setError('Network error. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="block text-sm font-medium">
          {labels.username}
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-900"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium">
          {labels.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-ink-700 dark:bg-ink-900"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? '…' : labels.submit}
      </button>

      <p className="text-center text-sm text-ink-500 dark:text-ink-400">
        {mode === 'login' ? labels.noAccount : labels.haveAccount}{' '}
        <Link
          href={mode === 'login' ? '/register' : '/login'}
          className="font-semibold text-brand-600 hover:underline"
        >
          {mode === 'login' ? labels.toRegister : labels.toLogin}
        </Link>
      </p>
    </form>
  );
}
