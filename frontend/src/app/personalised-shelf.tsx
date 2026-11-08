"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Episode = { id: string; sequence_number: number; title: string };
type Progress = { episode_id: string; progress_percent: number; completed_at: string | null; updated_at: string };
type StoryCard = {
  story: { id: string; slug: string; title: string; tagline: string | null; synopsis: string | null; completion_status: string; cover_url: string | null };
  last_read_episode: Episode | null;
  latest_published_episode: Episode;
  first_published_episode: Episode;
  published_episode_count: number;
  completed_episode_count: number;
  reading_progress: Progress[];
  available_episode: Episode | null;
};
type LibraryData = { continue_reading: StoryCard[]; caught_up: StoryCard[]; saved: StoryCard[]; not_started: StoryCard[] };
type ShelfState = "loading" | "signed-out" | "ready" | "error";

function episodeTarget(card: StoryCard) {
  return card.available_episode || card.last_read_episode || card.first_published_episode || card.latest_published_episode;
}
function readingPercent(card: StoryCard) {
  const active = [...card.reading_progress]
    .filter((item) => !item.completed_at)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
  return card.published_episode_count
    ? Math.min(100, Math.max(0, ((card.completed_episode_count + (active?.progress_percent || 0) / 100) / card.published_episode_count) * 100))
    : 0;
}

export default function PersonalisedShelf() {
  const [cards, setCards] = useState<StoryCard[]>([]);
  const [status, setStatus] = useState<ShelfState>("loading");
  const [error, setError] = useState("");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl) {
      setStatus("signed-out");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      setStatus("signed-out");
      return;
    }
    try {
      const response = await fetch(apiUrl + "/library", {
        headers: { Authorization: "Bearer " + session.access_token },
        cache: "no-store",
      });
      if (response.status === 401) {
        setStatus("signed-out");
        return;
      }
      if (!response.ok) throw new Error("Your reading progress is temporarily unavailable.");
      const data = await response.json() as LibraryData;
      setCards(data.continue_reading?.length ? data.continue_reading : data.caught_up || []);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
      setStatus("error");
    }
  }, [apiUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = cards[0] || null;
  const target = card ? episodeTarget(card) : null;
  const percent = card ? readingPercent(card) : 0;

  return (
    <section className="shelf-section personalised-shelf">
      <div className="section-heading">
        <div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>{status === "ready" && card ? "Your story continues" : "Keep the story going"}<span>.</span></h2></div>
        <Link href="/library" className="subtle-link">Your library <span>→</span></Link>
      </div>
      {status === "loading" ? (
        <div className="empty-shelf"><div className="empty-mark">…</div><div><h3>Gathering your stories.</h3><p>Your personal reading shelf is loading.</p></div></div>
      ) : status === "error" ? (
        <div className="empty-shelf" role="status"><div className="empty-mark">↗</div><div><h3>Your reading shelf is unavailable.</h3><p>{error}</p></div><button className="outline-button" onClick={() => void load()}>Try again</button></div>
      ) : status === "signed-out" ? (
        <div className="empty-shelf"><div className="empty-mark">↗</div><div><h3>Your next chapter is waiting.</h3><p>Sign in to keep your progress, or explore stories and find your next read.</p></div><Link href="/sign-in?next=/library" className="outline-button">Sign in <span>↗</span></Link></div>
      ) : card && target ? (
        <article className="personalised-story-card">
          <Link className={"personalised-story-art" + (card.story.cover_url ? " has-cover" : "")} href={"/stories/" + card.story.slug} aria-label={"Explore " + card.story.title}>
            {card.story.cover_url ? <img className="personalised-cover-image" src={card.story.cover_url} alt={card.story.title + " book cover"} /> : <><span>STORYFLICKS ORIGINAL</span><strong>{card.story.title}</strong><i>{card.story.completion_status === "completed" ? "COMPLETE" : "ONGOING"}</i></>}
          </Link>
          <div className="personalised-story-copy">
            <p className="eyebrow">{card.story.completion_status === "completed" ? "YOUR COMPLETED STORY" : "YOUR READING JOURNEY"}</p>
            <h3>{card.story.title}</h3>
            <p>{card.story.tagline || card.story.synopsis || "An original STORYFLICKS story."}</p>
            <div className="personalised-progress-meta"><span>{card.completed_episode_count} OF {card.published_episode_count} EPISODES READ</span><span>{Math.round(percent)}%</span></div>
            <div className="personalised-progress-track"><span style={{ width: percent + "%" }} /></div>
            <div className="personalised-story-footer"><span>EP. {String(target.sequence_number).padStart(2, "0")} · {target.title}</span><Link href={"/stories/" + card.story.slug + "/read/" + target.id}>{card.available_episode ? "Continue reading" : card.last_read_episode ? "Return to episode" : "Start reading"} <span>↗</span></Link></div>
          </div>
        </article>
      ) : (
        <div className="empty-shelf"><div className="empty-mark">✳</div><div><h3>Ready when you are.</h3><p>Start a story and your reading progress will appear here automatically.</p></div><Link href="/search" className="outline-button">Find a story <span>↗</span></Link></div>
      )}
    </section>
  );
}
