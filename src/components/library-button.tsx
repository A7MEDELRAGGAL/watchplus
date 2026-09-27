'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Kind = 'favorites' | 'watchlist';

/**
 * The save button on a title page.
 *
 * Optimistic on purpose: the round trip is a database write, and a watchlist
 * toggle that waits feels broken. Rolled back if the server disagrees, which
 * also covers "signed out" — that redirects to /login rather than showing an
 * error on a page the user is trying to read.
 */
export function LibraryButton({
  kind,
  titleId,
  initialInLibrary,
  labels,
}: {
  kind: Kind;
  titleId: string;
  initialInLibrary: boolean;
  labels: { add: string; remove: string };
}) {
  const router = useRouter();
  const [inLibrary, setInLibrary] = useState(initialInLibrary);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const previous = inLibrary;
    setBusy(true);
    setInLibrary(!previous);

    try {
      const res = await fetch(`/api/library?kind=${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titleId }),
      });

      if (res.status === 401) {
        setInLibrary(previous);
        router.push('/login');
        return;
      }
      if (!res.ok) {
        setInLibrary(previous);
        return;
      }

      const payload = (await res.json()) as { inLibrary: boolean };
      setInLibrary(payload.inLibrary);
      startTransition(() => router.refresh());
    } catch {
      setInLibrary(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy || pending}
      aria-pressed={inLibrary}
      className={
        inLibrary
          ? 'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60'
          : 'inline-flex items-center gap-2 rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold transition hover:bg-ink-100 disabled:opacity-60 dark:border-ink-700 dark:hover:bg-ink-800'
      }
    >
      <span aria-hidden="true">{inLibrary ? '✓' : '+'}</span>
      {inLibrary ? labels.remove : labels.add}
    </button>
  );
}

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
        router.push('/');
        router.refresh();
      }}
      className="text-sm font-medium text-ink-500 transition hover:text-ink-900 disabled:opacity-60 dark:text-ink-400 dark:hover:text-ink-50"
    >
      {label}
    </button>
  );
}
