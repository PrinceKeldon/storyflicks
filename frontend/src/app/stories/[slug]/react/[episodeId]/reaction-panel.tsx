"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Reaction = {
  id: string;
  code: string;
  statement: string;
  emoji: string;
  category: string;
  count: number;
  selected_by_me: boolean;
};
type OwnReview = { id: string; headline: string | null; body: string; visibility: "public" | "private"; status: string; submitted_at?: string | null };
type NextEpisode = { id: string; title: string; sequence_number: number; publication_status: string; unlocked: boolean; grant_reason?: string | null };
type ReviewRoomPayload = {
  episode: { id: string; title: string; sequence_number: number };
  reaction_summary: Reaction[];
  review_count: number;
  has_qualified: boolean;
  qualifying_contribution: string | null;
  my_review: OwnReview | null;
  next_episode: NextEpisode | null;
};
type UnlockPayload = { qualified?: boolean; already_qualified?: boolean; unlock?: { granted?: boolean; newly_granted?: boolean; next_episode?: { id: string; title: string; publication_status: string; access_status: string } | null } | null };

const categoryLabels: Record<string, string> = {
  positive: "Loved it",
  surprise: "Plot twists",
  intellectual: "Made me think",
  emotional: "Emotional impact",
  humour: "Unexpectedly entertaining",
  curiosity: "Questions & theories",
  mixed: "Mixed feelings",
  critical: "Not for me",
};

export default function ReactionPanel({ episodeId }: { episodeId: string }) {
  const [data, setData] = useState<ReviewRoomPayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"reaction" | "review" | null>(null);
  const [unlock, setUnlock] = useState<NextEpisode | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl) { setStatus("error"); setError("Reader contributions are not configured yet."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setStatus("signed-out"); return; }
    try {
      const response = await fetch(`${apiUrl}/episodes/${episodeId}/review-room`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "We couldn’t load your episode response.");
      }
      const result = await response.json() as ReviewRoomPayload;
      setData(result);
      setSelected(result.reaction_summary.filter((item) => item.selected_by_me).map((item) => item.code));
      if (result.my_review) {
        setHeadline(result.my_review.headline || "");
        setBody(result.my_review.body);
        setVisibility(result.my_review.visibility);
      }
      if (result.has_qualified && result.next_episode?.unlocked) setUnlock(result.next_episode);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setStatus("error");
    }
  }, [apiUrl, episodeId]);

  useEffect(() => { void load(); }, [load]);

  async function submitContribution(kind: "reaction" | "review") {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl || !data) return;
    if (kind === "reaction" && selected.length === 0) { setError("Choose at least one reaction, or write a review instead."); return; }
    if (kind === "review" && !body.trim()) { setError("Write a few words before submitting your review."); return; }
    setBusy(kind); setError(""); setNotice("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setStatus("signed-out"); return; }
      const response = await fetch(`${apiUrl}/episodes/${episodeId}/${kind === "reaction" ? "reactions" : "reviews"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(kind === "reaction"
          ? { reaction_codes: selected }
          : { headline: headline.trim() || null, body: body.trim(), visibility }),
      });
      const result = await response.json().catch(() => ({})) as UnlockPayload & { detail?: string };
      if (!response.ok) throw new Error(result.detail || "Your contribution could not be saved. Please try again.");
      const unlocked = result.unlock?.next_episode;
      if (unlocked) {
        setUnlock({
          id: unlocked.id,
          title: unlocked.title,
          sequence_number: 0,
          publication_status: unlocked.publication_status,
          unlocked: true,
        });
      }
      setData((current) => current ? {
        ...current,
        has_qualified: true,
        qualifying_contribution: kind,
        my_review: kind === "review" ? {
          id: current.my_review?.id || "saved",
          headline: headline.trim() || null,
          body: body.trim(),
          visibility,
          status: "submitted",
        } : current.my_review,
      } : current);
      setNotice(kind === "reaction"
        ? "Your reaction is saved. That’s enough to unlock the next episode."
        : `Your ${visibility} review is saved. That’s enough to unlock the next episode.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  function toggleReaction(code: string) {
    setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    setError("");
  }

  if (status === "loading") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p>Gathering your thoughts…</p></main>;
  if (status === "signed-out") return <main className="reader-state"><span className="reader-state-mark">SF.</span><h1>Sign in to share your take.</h1><Link className="primary-button" href={`/sign-in?next=/stories/the-priest/react/${episodeId}`}>Sign in to continue <span>↗</span></Link></main>;
  if (status === "error" || !data) return <main className="reader-state"><span className="reader-state-mark">SF.</span><h1>We couldn’t load this page.</h1><p>{error}</p><Link href="/stories/the-priest">Back to THE PRIEST</Link></main>;

  return (
    <main className="contribution-shell">
      <header className="contribution-header">
        <Link className="reader-brand" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <div className="reader-location"><Link href="/stories/the-priest">THE PRIEST</Link><span>/</span><span>YOUR TAKE</span></div>
        <Link className="reader-exit" href="/stories/the-priest">Exit</Link>
      </header>
      <section className="contribution-content">
        <p className="eyebrow">END OF EPISODE {String(data.episode.sequence_number).padStart(2, "0")}</p>
        <h1>So, what did you think?</h1>
        <p className="contribution-deck">Every reader takes something different from a story. Tell us what stayed with you.</p>
        <p className="contribution-rule">A reaction OR a review is enough to unlock the next episode. You can also do both, or skip and return later.</p>

        <section className="reaction-section">
          <div className="contribution-section-heading"><div><p className="eyebrow">THE QUICK TAKE</p><h2>Pick the reactions that fit.</h2></div><span>CHOOSE UP TO 8</span></div>
          <div className="reaction-grid">
            {data.reaction_summary.map((reaction) => (
              <button type="button" key={reaction.code} className={`reaction-choice ${selected.includes(reaction.code) ? "is-selected" : ""}`} onClick={() => toggleReaction(reaction.code)} aria-pressed={selected.includes(reaction.code)}>
                <span className="reaction-emoji">{reaction.emoji}</span>
                <span className="reaction-copy"><strong>{reaction.statement}</strong><small>{categoryLabels[reaction.category] || reaction.category}</small></span>
                <span className="reaction-check">{selected.includes(reaction.code) ? "✓" : "+"}</span>
              </button>
            ))}
          </div>
          <div className="contribution-action-row">
            <p>{selected.length} selected <span>·</span> A reaction on its own unlocks the next episode.</p>
            <button className="primary-button" type="button" disabled={busy !== null || selected.length === 0} onClick={() => void submitContribution("reaction")}>{busy === "reaction" ? "Saving…" : "Save my reactions"} <span>→</span></button>
          </div>
        </section>

        <div className="contribution-divider"><span>OR, IF YOU HAVE MORE TO SAY</span></div>

        <section className="review-compose">
          <p className="eyebrow">YOUR TAKE, IN YOUR WORDS</p>
          <h2>Write a review.</h2>
          <p className="review-compose-intro">A sentence, a theory, a full debrief. It’s your space.</p>
          <label htmlFor="review-headline">HEADLINE <span>OPTIONAL</span></label>
          <input id="review-headline" value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="Give your thoughts a title…" maxLength={300} />
          <label htmlFor="review-body">YOUR REVIEW</label>
          <textarea id="review-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="What surprised you? What did you feel? What are you thinking now?" rows={7} />
          <div className="review-visibility">
            <div><strong>Who can read this?</strong><p>Private reviews stay yours. Public reviews join the conversation.</p></div>
            <div className="visibility-options"><button type="button" className={visibility === "public" ? "selected" : ""} onClick={() => setVisibility("public")}>Public</button><button type="button" className={visibility === "private" ? "selected" : ""} onClick={() => setVisibility("private")}>Private</button></div>
          </div>
          <div className="contribution-action-row review-submit-row">
            <p>A submitted review — public or private — also unlocks the next episode.</p>
            <button className="primary-button" type="button" disabled={busy !== null || !body.trim()} onClick={() => void submitContribution("review")}>{busy === "review" ? "Submitting…" : data.my_review ? "Update my review" : "Submit my review"} <span>→</span></button>
          </div>
        </section>

        {error && <p className="contribution-error" role="alert">{error}</p>}
        {notice && <p className="contribution-notice" role="status">{notice}</p>}

        {data.has_qualified && <section className="unlock-panel">
          <p className="eyebrow">YOU’VE DONE YOUR PART</p>
          <h2>{unlock ? "Your next episode is unlocked." : data.next_episode ? "Your contribution is recorded." : "You’re all caught up."}</h2>
          {unlock ? <>
            <p><strong>{unlock.title}</strong> is now in your library{unlock.publication_status !== "published" ? " and will be ready when it is published" : ""}.</p>
            {unlock.publication_status === "published" && <Link className="primary-button" href={`/stories/the-priest/read/${unlock.id}`}>Read next episode <span>↗</span></Link>}
            {unlock.publication_status !== "published" && <p className="unlock-waiting">We’ll keep your access ready. Come back when the episode is released.</p>}
          </> : data.next_episode ? <p>Your contribution is saved. If the next episode has not opened yet, your access will be ready when it is published.</p> : <p>Your response is recorded. There isn’t another episode available just yet.</p>}
        </section>}

        <div className="contribution-bottom-links"><Link href="/stories/the-priest">Skip for now · Back to THE PRIEST</Link><Link href={`/stories/the-priest/reviews/${episodeId}`}>Reader discussion ↗</Link><Link href="/stories/the-priest#episodes">Episode guide ↗</Link></div>
      </section>
      <footer className="reader-footer"><span>STORYFLICKS</span><span>Stories worth staying for.</span><span>© 2026</span></footer>
    </main>
  );
}
