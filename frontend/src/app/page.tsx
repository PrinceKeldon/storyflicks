import Link from "next/link";
import PersonalisedShelf from "./personalised-shelf";

type DiscoverStory = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  synopsis: string | null;
  genres: string[];
  completion_status: string | null;
  published_at?: string | null;
  cover_url?: string | null;
};

const previewStory: DiscoverStory = {
  id: "",
  slug: "the-priest",
  title: "The Priest",
  tagline: "Two lives. One secret. A confession that changes everything.",
  synopsis: "For over twenty years, Father James has kept his priestly life separate from the man he secretly becomes beyond the collar. But when Sophia enters his world, questions of faith, desire and identity begin to blur — and some secrets may be impossible to keep.",
  genres: ["Drama"],
  completion_status: "ongoing",
};

const navItems = ["Discover", "My Library", "Creator Studio"];

async function getCatalogue(): Promise<{ stories: DiscoverStory[]; unavailable: boolean }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (!apiUrl) return { stories: [previewStory], unavailable: false };

  try {
    const response = await fetch(apiUrl + "/stories", { next: { revalidate: 60 } });
    if (!response.ok) throw new Error("Catalogue request failed.");
    const data = await response.json();
    return {
      stories: Array.isArray(data.items) ? data.items : [],
      unavailable: false,
    };
  } catch {
    return { stories: [], unavailable: true };
  }
}

function storyDescription(story: DiscoverStory) {
  return story.tagline || story.synopsis || "Discover this STORYFLICKS original.";
}

export default async function DiscoverPage() {
  const { stories, unavailable } = await getCatalogue();
  const featured = stories.find((story) => story.slug === "the-priest") ?? stories[0] ?? null;
  const moreStories = stories.filter((story) => story.slug !== featured?.slug);
  const publishedCount = stories.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="STORYFLICKS home">STORY<span>FLICKS</span><i>.</i></Link>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item, index) => index === 2
            ? <Link className="nav-link" href="/creator-studio" key={item}>{item}</Link>
            : <Link className={index === 0 ? "nav-link active" : "nav-link"} href={index === 0 ? "/" : "/library"} key={item}>{item}</Link>
          )}
        </nav>
        <div className="account-actions">
          <Link className="icon-button" href="/search" aria-label="Search"><span className="search-icon" /></Link>
          <Link className="sign-in" href="/sign-in?next=/library">Sign in</Link>
          <Link className="join-button" href="/sign-in?mode=signup">Join free <span>↗</span></Link>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">YOUR NEXT OBSESSION STARTS HERE</p>
          <h1>Stories worth <em>staying for.</em></h1>
        </div>
        <p className="welcome-note">A good story pulls you in.<br />A great one keeps you coming back.</p>
      </section>

      {featured ? (
        <section className="featured" aria-labelledby="featured-title">
          <div className="featured-copy">
            <div className="feature-kicker"><span className="live-dot" /> {featured.slug === "the-priest" ? "FEATURED STORY" : "DISCOVER THIS STORY"}</div>
            <p className="feature-overline">AN ORIGINAL STORYFLICKS SERIES</p>
            <h2 id="featured-title">{featured.title}</h2>
            <p className="feature-tagline">{storyDescription(featured)}</p>
            <p className="feature-meta">{featured.genres?.join(" · ").toUpperCase() || "STORYFLICKS ORIGINAL"} <b>·</b> {(featured.completion_status || "ONGOING").toUpperCase()} <b>·</b> EPISODIC</p>
            <div className="feature-actions">
              <Link className="primary-button" href={"/stories/" + featured.slug}>Explore the story <span>↗</span></Link>
              <Link className="text-button" href={"/stories/" + featured.slug + "#episodes"}>View episode guide <span>→</span></Link>
            </div>
          </div>
          <div className={featured.cover_url ? "feature-art has-cover" : "feature-art"} role="img" aria-label={featured.title + " book cover artwork"}>
            {featured.cover_url ? <img className="feature-cover-image" src={featured.cover_url} alt={featured.title + " book cover"} /> : null}
            <div className="art-grain" />
            <div className="art-cross" />
            <div className="art-caption">STORIES THAT STAY<br />WITH YOU</div>
            <div className="art-title"><strong>{featured.title}</strong></div>
            <div className="art-index">SF ORIGINAL&nbsp;&nbsp; / &nbsp;&nbsp;001</div>
          </div>
          <div className="feature-index"><span>01</span><i /> {String(publishedCount).padStart(2, "0")}</div>
        </section>
      ) : (
        <section className="empty-shelf" role="status">
          <div className="empty-mark">↗</div>
          <div><h3>{unavailable ? "The catalogue is taking a moment." : "The next story is on its way."}</h3><p>{unavailable ? "We couldn't load the catalogue. Please try again shortly." : "New stories will appear here as soon as they are published."}</p></div>
          <Link href="/search" className="outline-button">Browse catalogue <span>↗</span></Link>
        </section>
      )}

      <PersonalisedShelf />

      {moreStories.length > 0 && (
        <section className="shelf-section catalogue-section">
          <div className="section-heading">
            <div><p className="eyebrow">MORE TO GET INTO</p><h2>Explore the catalogue<span>.</span></h2></div>
            <Link href="/search" className="subtle-link">All stories <span>→</span></Link>
          </div>
          <div className="search-results">
            {moreStories.slice(0, 6).map((story) => (
              <Link key={story.id || story.slug} className="search-result-card" href={"/stories/" + story.slug}>
                <div className={story.cover_url ? "search-result-art has-cover" : "search-result-art"} role="img" aria-label={story.title + " book cover artwork"}>
                  {story.cover_url ? <img className="catalogue-cover-image" src={story.cover_url} alt={story.title + " book cover"} /> : <><span>{story.title}</span><small>STORYFLICKS ORIGINAL</small></>}
                </div>
                <div className="search-result-copy">
                  <p className="eyebrow">{story.genres?.join(" · ") || "STORYFLICKS ORIGINAL"} <span>·</span> {(story.completion_status || "EPISODIC").toUpperCase()}</p>
                  <h3>{story.title}</h3>
                  <p>{storyDescription(story)}</p>
                  <span className="text-button">Explore story <span>↗</span></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="browse-row">
        <div><p className="eyebrow">FIND YOUR KIND OF STORY</p><h2>What are you in the mood for?</h2></div>
        <div className="genre-list"><Link href="/search?genre=Drama">Drama <span>↗</span></Link><Link href="/search?genre=Thriller">Thriller <span>↗</span></Link><Link href="/search?genre=Romance">Romance <span>↗</span></Link><Link href="/search?genre=Mystery">Mystery <span>↗</span></Link></div>
      </section>

      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© 2026 STORYFLICKS</span></footer>
    </main>
  );
}
