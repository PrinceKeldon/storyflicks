"use client";

import Link from "next/link";
import { useState } from "react";

type SearchStory = {
  id: string;
  slug: string;
  title: string;
  author_name?: string | null;
  tagline: string | null;
  synopsis: string | null;
  genres: string[];
  completion_status?: string | null;
  cover_url?: string | null;
};

export default function SearchResults({
  initialItems,
  initialCursor,
  query,
  genre,
}: {
  initialItems: SearchStory[];
  initialCursor: string | null;
  query: string;
  genre: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadMore() {
    if (!cursor || loading) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\\/$/, "");
    if (!apiUrl) {
      setError("The catalogue is temporarily unavailable.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "24", cursor });
      if (query) params.set("q", query);
      if (genre) params.set("genre", genre);
      const response = await fetch(apiUrl + "/stories?" + params.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load more stories.");
      const data = await response.json() as { items?: SearchStory[]; next_cursor?: string | null };
      const nextItems = Array.isArray(data.items) ? data.items : [];
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !known.has(item.id))];
      });
      setCursor(data.next_cursor || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more stories.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {items.length ? (
        <div className="search-results">
          {items.map((item) => (
            <Link key={item.id || item.slug} className="search-result-card" href={"/stories/" + item.slug}>
              <div className={item.cover_url ? "search-result-art has-cover" : "search-result-art"} aria-label={item.title + " book cover artwork"}>
                {item.cover_url ? <img className="catalogue-cover-image" src={item.cover_url} alt={item.title + " book cover"} /> : <><span>{item.title}</span><small>STORYFLICKS ORIGINAL</small></>}
              </div>
              <div className="search-result-copy">
                <p className="eyebrow">{item.genres?.join(" · ") || "STORYFLICKS ORIGINAL"} <span>·</span> {item.completion_status || "EPISODIC"}</p>
                <h3>{item.title}</h3>
                {item.author_name && <p className="catalogue-author-byline">By {item.author_name}</p>}
                <p>{item.tagline || item.synopsis || "Discover this STORYFLICKS original."}</p>
                <span className="text-button">Explore story <span>↗</span></span>
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      {error ? <p role="alert" className="search-load-error">{error}</p> : null}
      {cursor ? (
        <div className="search-load-more">
          <button className="outline-button" type="button" onClick={loadMore} disabled={loading}>
            {loading ? "Loading stories…" : "Load more stories"}
          </button>
        </div>
      ) : null}
    </>
  );
}
