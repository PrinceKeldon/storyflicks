import Link from "next/link";

type SearchStory = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  synopsis: string | null;
  genres: string[];
  completion_status?: string | null;
};

const previewStory: SearchStory = {
  id: "",
  slug: "the-priest",
  title: "THE PRIEST",
  tagline: "Two lives. One secret. A confession that changes everything.",
  synopsis: "For over twenty years, Father James has kept his priestly life separate from the man he secretly becomes beyond the collar. But when Sophia enters his world, questions of faith, desire and identity begin to blur — and some secrets may be impossible to keep.",
  genres: ["Drama"],
  completion_status: "ongoing",
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; genre?: string }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const genre = typeof params.genre === "string" ? params.genre.trim().slice(0, 40) : "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  let items: SearchStory[] = [];
  let unavailable = false;

  if (apiUrl) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (genre) search.set("genre", genre);
    try {
      const response = await fetch(apiUrl + "/stories?" + search.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("Catalogue request failed.");
      const data = await response.json();
      items = Array.isArray(data.items) ? data.items : [];
    } catch {
      unavailable = true;
    }
  } else {
    const haystack = (previewStory.title + " " + previewStory.tagline + " " + previewStory.synopsis).toLowerCase();
    const queryMatches = !query || haystack.includes(query.toLowerCase());
    const genreMatches = !genre || previewStory.genres.some((item) => item.toLowerCase() === genre.toLowerCase());
    if (queryMatches && genreMatches) items = [previewStory];
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="STORYFLICKS home">STORY<span>FLICKS</span><i>.</i></Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link className="nav-link" href="/">Discover</Link>
          <Link className="nav-link" href="/library">My Library</Link>
          <Link className="nav-link" href="/creator-studio">Creator Studio</Link>
        </nav>
        <div className="account-actions">
          <Link className="sign-in" href="/sign-in?next=/library">Sign in</Link>
          <Link className="join-button" href="/sign-in?mode=signup">Join free <span>↗</span></Link>
        </div>
      </header>

      <section className="search-page">
        <p className="eyebrow">THE STORYFLICKS CATALOGUE</p>
        <h1>Find your next <em>obsession.</em></h1>
        <p className="search-intro">Search stories by title, tagline or synopsis, or browse by genre.</p>
        <form action="/search" method="GET" className="search-page-form">
          <input type="search" name="q" defaultValue={query} placeholder="Search stories, themes and ideas…" aria-label="Search stories" />
          {genre ? <input type="hidden" name="genre" value={genre} /> : null}
          <button className="primary-button" type="submit">Search <span>↗</span></button>
        </form>

        <div className="search-filter-row">
          <span className="eyebrow">{genre ? "GENRE" : "BROWSE GENRES"}</span>
          {genre ? <Link href={query ? "/search?q=" + encodeURIComponent(query) : "/search"} className="search-clear">Clear genre ×</Link> : null}
          <div className="search-genre-chips">
            {["Drama", "Thriller", "Romance", "Mystery"].map((item) => (
              <Link key={item} href={"/search?genre=" + encodeURIComponent(item)} className={genre.toLowerCase() === item.toLowerCase() ? "genre-chip active" : "genre-chip"}>{item}</Link>
            ))}
          </div>
        </div>

        <div className="search-results-heading">
          <div>
            <p className="eyebrow">{query || genre ? "YOUR RESULTS" : "AVAILABLE STORIES"}</p>
            <h2>{query ? "Results for “" + query + "”" : genre ? genre + " stories" : "Explore the catalogue"}</h2>
          </div>
          <span className="search-result-count">{items.length} {items.length === 1 ? "story" : "stories"}</span>
        </div>

        {unavailable ? (
          <div className="empty-shelf"><div className="empty-mark">↗</div><div><h3>The catalogue is temporarily unavailable.</h3><p>Please try again when the STORYFLICKS API is connected.</p></div></div>
        ) : items.length ? (
          <div className="search-results">
            {items.map((item) => (
              <Link key={item.id || item.slug} className="search-result-card" href={"/stories/" + item.slug}>
                <div className="search-result-art" aria-label={item.title + " title artwork"}>
                  <span>{item.title}</span>
                  <small>STORYFLICKS ORIGINAL</small>
                </div>
                <div className="search-result-copy">
                  <p className="eyebrow">{item.genres?.join(" · ") || "STORYFLICKS ORIGINAL"} <span>·</span> {item.completion_status || "EPISODIC"}</p>
                  <h3>{item.title}</h3>
                  <p>{item.tagline || item.synopsis || "Discover this STORYFLICKS original."}</p>
                  <span className="text-button">Explore story <span>↗</span></span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-shelf"><div className="empty-mark">⌕</div><div><h3>No stories found just yet.</h3><p>Try another title, theme or genre. The catalogue will grow as new stories are published.</p></div><Link href="/" className="outline-button">Back to Discover <span>↗</span></Link></div>
        )}
      </section>
    </main>
  );
}
