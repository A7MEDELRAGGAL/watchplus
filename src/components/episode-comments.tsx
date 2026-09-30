'use client';

import { useEffect, useState } from 'react';

interface Comment {
  id: string;
  body: string;
  stars: number | null;
  createdAt: string;
  username: string;
}

/** تعليقات وتقييم الحلقة — القراءة للكل، والكتابة للمسجلين. */
export function EpisodeComments({
  episodeId,
  signedIn,
  labels,
}: {
  episodeId: string;
  signedIn: boolean;
  labels: {
    title: string;
    loginToComment: string;
    placeholder: string;
    send: string;
    noComments: string;
    yourRating: string;
  };
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [avg, setAvg] = useState<number | null>(null);
  const [body, setBody] = useState('');
  const [stars, setStars] = useState(0);
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const r = await fetch(`/api/episode-comments?episodeId=${episodeId}`);
      const j = (await r.json()) as { ok: boolean; data?: { comments: Comment[]; avgStars: number | null } };
      if (j.ok && j.data) {
        setComments(j.data.comments);
        setAvg(j.data.avgStars);
      }
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  const send = async () => {
    if ((!body.trim() && !stars) || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/episode-comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeId, body: body.trim(), stars: stars || null }),
      });
      if (r.ok) {
        setBody('');
        setStars(0);
        await load();
      }
    } catch {
      /* silent */
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card space-y-4 p-4 !bg-ink-900 dark:!border-ink-800 sm:p-5">
      <h2 className="flex items-center gap-2 font-black">
        <span aria-hidden className="h-6 w-1.5 rounded-full bg-gradient-to-b from-brand-400 to-brand-700" />
        {labels.title}
        {avg !== null ? (
          <span className="tabular rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-black text-amber-400">
            ★ {avg.toFixed(1)}
          </span>
        ) : null}
      </h2>

      {signedIn ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1" role="radiogroup" aria-label={labels.yourRating}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setStars(stars === n ? 0 : n)}
                aria-label={`${n}`}
                className={`text-xl transition ${stars >= n ? 'text-amber-400' : 'text-ink-700 hover:text-ink-500'}`}
              >
                ★
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={labels.placeholder}
              maxLength={500}
              className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none transition focus:border-brand-500"
            />
            <button
              type="button"
              onClick={send}
              disabled={sending || (!body.trim() && !stars)}
              className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-500 disabled:opacity-50"
            >
              {labels.send}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-500">{labels.loginToComment}</p>
      )}

      {comments.length === 0 ? (
        <p className="text-sm text-ink-500">{labels.noComments}</p>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-ink-800 px-3 py-2">
              <p className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-bold text-ink-200">{c.username}</span>
                <span className="tabular shrink-0 text-ink-600">
                  {c.stars ? `★${c.stars} · ` : ''}
                  {new Date(c.createdAt).toLocaleDateString('ar-EG')}
                </span>
              </p>
              {c.body ? <p className="mt-1 text-sm text-ink-300">{c.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
