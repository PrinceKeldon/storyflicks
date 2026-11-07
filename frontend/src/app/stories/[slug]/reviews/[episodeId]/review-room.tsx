"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type ReactionTag = { code: string; statement: string; emoji: string; category: string };
type Review = {
  id: string;
  user_id: string;
  headline: string | null;
  body: string;
  submitted_at: string | null;
  author: { id: string; username: string | null; display_name: string | null; avatar_path: string | null } | null;
  reaction_tags: ReactionTag[];
  helpful_count: number;
  helpful_by_me: boolean;
  author_reply: { id: string; body: string; created_at: string; creator: { username: string | null; display_name: string | null } | null } | null;
};
type Reaction = { code: string; statement: string; emoji: string; category: string; count: number };
type AuthorNote = { id: string; title: string | null; body: string; is_pinned: boolean; published_at: string | null; author: { username: string | null; display_name: string | null } | null };
type AvailableEpisode = { id: string; title: string; sequence_number: number };
type Payload = {
  story: { id: string; slug: string; title: string };
  episode: { id: string; title: string; sequence_number: number };
  reaction_summary: Reaction[];
  reviews: Review[];
  review_count: number;
  author_notes: AuthorNote[];
  available_episodes: AvailableEpisode[];
};
type SortMode = "featured" | "newest" | "helpful";
type Status = "loading" | "signed-out" | "ready" | "error";

const categoryNames: Record<string, string> = {
  positive: "Loved it", surprise: "Plot twists", intellectual: "Made me think",
  emotional: "Emotional impact", humour: "Unexpectedly entertaining",
  curiosity: "Questions & theories", mixed: "Mixed feelings", critical: "Not for me",
};

function displayName(person: { username?: string | null; display_name?: string | null } | null | undefined) {
  return person?.display_name?.trim() || (person?.username ? `@${person.username}` : "STORYFLICKS reader");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S";
}

function dateLabel(value: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function ReviewRoom({ slug, episodeId }: { slug: string; episodeId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [sort, setSort] = useState<SortMode>("featured");
  const [category, setCategory] = useState("all");
  const [revealed, setRevealed] = useState<string[]>([]);
  const [voting, setVoting] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl) { setStatus("error"); setError("The Review Room is not configured yet."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setStatus("signed-out"); return; }
    setUserId(session.user.id);
    try {
      const response = await fetch(`${apiUrl}/episodes/${episodeId}/review-room`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "We couldn’t load this discussion.");
      }
      setData(await response.json() as Payload);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setStatus("error");
    }
  }, [apiUrl, episodeId]);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    return data.reviews.flatMap((review) => review.reaction_tags)
      .filter((tag) => {
        if (seen.has(tag.category)) return false;
        seen.add(tag.category);
        return true;
      })
      .map((tag) => tag.category);
  }, [data]);

  const visibleReviews = useMemo(() => {
    if (!data) return [];
    const filtered = data.reviews.filter((review) => category === "all" || review.reaction_tags.some((tag) => tag.category === category));
    return [...filtered].sort((a, b) => {
      if (sort === "helpful") return b.helpful_count - a.helpful_count || (b.submitted_at || "").localeCompare(a.submitted_at || "");
      if (sort === "featured") {
        const aScore = a.helpful_count + (a.author_reply ? 3 : 0);
        const bScore = b.helpful_count + (b.author_reply ? 3 : 0);
        return bScore - aScore || (b.submitted_at || "").localeCompare(a.submitted_at || "");
      }
      return (b.submitted_at || "").localeCompare(a.submitted_at || "");
    });
  }, [data, category, sort]);

  async function toggleHelpful(review: Review) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl || !data || voting) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setStatus("signed-out"); return; }
    setVoting(review.id);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/reviews/${review.id}/helpful`, {
        method: review.helpful_by_me ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "Your vote could not be saved.");
      setData((current) => current ? {
        ...current,
        reviews: current.reviews.map((item) => item.id === review.id
          ? { ...item, helpful_by_me: !review.helpful_by_me, helpful_count: result.helpful_count ?? item.helpful_count }
          : item),
      } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setVoting(null);
    }
  }

  if (status === "loading") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p>Opening the conversation…</p></main>;
  if (status === "signed-out") return <main className="reader-state"><span className="reader-state-mark">SF.</span><h1>Join the conversation.</h1><p>Sign in to read and take part in the Review Room.</p><Link className="primary-button" href={`/sign-in?next=/stories/${slug}/reviews/${episodeId}`}>Sign in to continue <span>↗</span></Link></main>;
  if (status === "error" || !data) return <main className="reader-state"><span className="reader-state-mark">SF.</span><h1>The conversation isn’t available.</h1><p>{error}</p><Link href={`/stories/${slug}`}>Back to {data?.story.title || "the story"}</Link></main>;

  return (
    <main className="review-room-shell">
      <header className="review-room-header">
        <Link className="reader-brand" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <div className="reader-location"><Link href={`/stories/${slug}`}>{data.story.title}</Link><span>/</span><span>REVIEW ROOM</span></div>
        <Link className="reader-exit" href={`/stories/${slug}`}>Exit</Link>
      </header>
      <section className="review-room-content">
        <Link className="review-back-link" href={`/stories/${slug}`}>← {data.story.title} · EPISODE GUIDE</Link>
        <p className="eyebrow">THE READER CONVERSATION · EPISODE {String(data.episode.sequence_number).padStart(2, "0")}</p>
        <h1>Inside the story<span>.</span></h1>
        <p className="review-room-deck"><strong>{data.episode.title}</strong> — every reader brings a different perspective. Here’s what stayed with them.</p>
        {data.available_episodes.length > 1 && <div className="review-episode-filter"><label htmlFor="review-episode">EPISODE</label><select id="review-episode" value={episodeId} onChange={(event) => router.push(`/stories/${slug}/reviews/${event.target.value}`)}>{data.available_episodes.map((episode) => <option value={episode.id} key={episode.id}>{String(episode.sequence_number).padStart(2, "0")} · {episode.title}</option>)}</select></div>}

        <div className="review-room-stats">
          <div><strong>{data.review_count}</strong><span>PUBLIC REVIEWS</span></div>
          <div><strong>{data.reaction_summary.reduce((sum, item) => sum + item.count, 0)}</strong><span>QUICK REACTIONS</span></div>
          <Link href={`/stories/${slug}/react/${episodeId}`}>Add your take <span>↗</span></Link>
        </div>

        <section className="review-room-reactions">
          <div className="review-room-section-heading"><div><p className="eyebrow">THE ROOM’S MOOD</p><h2>What readers felt.</h2></div><span>REACTIONS FROM THE COMMUNITY</span></div>
          <div className="review-room-reaction-list">
            {data.reaction_summary.filter((item) => item.count > 0).map((item) => (
              <button type="button" key={item.code} className={category === item.category ? "active" : ""} onClick={() => setCategory(category === item.category ? "all" : item.category)}>
                <span>{item.emoji}</span><strong>{item.statement}</strong><small>{item.count}</small>
              </button>
            ))}
            {data.reaction_summary.every((item) => item.count === 0) && <p className="review-room-empty-note">The first reactions are still arriving.</p>}
          </div>
        </section>

        {data.author_notes.length > 0 && <section className="review-author-notes"><div className="review-room-section-heading"><div><p className="eyebrow">A WORD FROM THE AUTHOR</p><h2>Behind the story.</h2></div><span>OFFICIAL AUTHOR NOTES</span></div>{data.author_notes.map((note) => <article className="review-author-note" key={note.id}>{note.is_pinned && <span className="review-note-pinned">PINNED NOTE</span>}<h3>{note.title || "A note from the author"}</h3><p>{note.body}</p><small>{displayName(note.author)} · {dateLabel(note.published_at)}</small></article>)}</section>}

        <section className="review-feed">
          <div className="review-feed-heading"><div><p className="eyebrow">THE CONVERSATION</p><h2>Reader reviews <span>({visibleReviews.length})</span></h2></div>
            <div className="review-feed-controls">
              <label htmlFor="review-filter">FILTER</label>
              <select id="review-filter" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="all">All reactions</option>
                {categories.map((item) => <option value={item} key={item}>{categoryNames[item] || item}</option>)}
              </select>
              <label htmlFor="review-sort">SORT</label>
              <select id="review-sort" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                <option value="featured">Featured</option><option value="newest">Newest</option><option value="helpful">Most helpful</option>
              </select>
            </div>
          </div>
          <p className="review-spoiler-note">Reader reviews may discuss plot details. Reveal each review before reading.</p>

          {visibleReviews.length === 0 ? <div className="review-feed-empty"><span>✳</span><h3>{data.review_count ? "No reviews in this reaction yet." : "A little quiet in here."}</h3><p>{data.review_count ? "Try another filter, or be the first to write about this reaction." : "Be the first to share a public review of this episode."}</p><Link href={`/stories/${slug}/react/${episodeId}`}>Write the first review <span>↗</span></Link></div> : (
            <div className="review-cards">
              {visibleReviews.map((review) => {
                const author = displayName(review.author);
                const isRevealed = revealed.includes(review.id);
                const isOwn = review.user_id === userId;
                return (
                  <article className="review-card" key={review.id}>
                    <div className="review-card-meta">
                      <span className="review-avatar">{initials(author)}</span>
                      <div className="review-author"><strong>{author}{isOwn ? " · You" : ""}</strong><span>{dateLabel(review.submitted_at)}</span></div>
                      {review.author_reply && <span className="author-response-label">AUTHOR RESPONDED</span>}
                    </div>
                    {review.reaction_tags.length > 0 && <div className="review-card-tags">{review.reaction_tags.map((tag) => <span key={tag.code}>{tag.emoji} {tag.statement}</span>)}</div>}
                    <div className="review-card-content">
                      {isRevealed ? <><h3>{review.headline || "A reader’s take"}</h3><p>{review.body}</p></> : <button type="button" className="review-reveal" onClick={() => setRevealed((current) => [...current, review.id])}><span>◌</span><strong>{review.headline || "A reader has shared their thoughts"}</strong><small>Reveal review · may contain spoilers</small></button>}
                    </div>
                    {review.author_reply && isRevealed && <div className="review-author-reply"><div><span>↳</span><strong>{displayName(review.author_reply.creator)} · AUTHOR</strong></div><p>{review.author_reply.body}</p><small>{dateLabel(review.author_reply.created_at)}</small></div>}
                    <div className="review-card-actions">
                      <button type="button" disabled={isOwn || voting === review.id} className={review.helpful_by_me ? "voted" : ""} onClick={() => void toggleHelpful(review)}>
                        {review.helpful_by_me ? "✓ Helpful" : "♡ Helpful"} <span>{review.helpful_count}</span>
                      </button>
                      <span>{isRevealed ? "SPOILERS REVEALED" : "SPOILER-GATED"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        {error && <p className="review-room-error" role="alert">{error}</p>}
        <div className="review-room-bottom"><Link href={`/stories/${slug}`}>← Back to story</Link><Link href={`/stories/${slug}/react/${episodeId}`}>Share your take ↗</Link></div>
      </section>
      <footer className="reader-footer"><span>STORYFLICKS</span><span>Stories worth staying for.</span><span>© 2026</span></footer>
    </main>
  );
}
