import RemoteImage from "@/components/remote-image";
import Link from "next/link";
import PersonalisedShelf from "./personalised-shelf";
import CreatorStudioNavLink from "./creator-studio-nav-link";
import AccountNavigation from "./account-navigation";
import LegalLinks from "./legal-links";
import { coverTone, isRecent } from "@/lib/cover-tone";

type DiscoverStory = {
  id: string;
  slug: string;
  title: string;
  author_name?: string | null;
  section_label?: string | null;
  section_label_plural?: string | null;
  tagline: string | null;
  synopsis: string | null;
  genres: string[];
  completion_status: string | null;
  origin_type?: "storyflicks_original" | "previously_published" | "independent" | null;
  content_format?: "standalone" | "series" | null;
  published_at?: string | null;
  cover_url?: string | null;
};

const navItems = ["Discover", "My Library"];

async function getCatalogue(): Promise<{ stories: DiscoverStory[]; unavailable: boolean; curated: { story: DiscoverStory | null; kicker: string } | null }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");
  if (!apiUrl) return { stories: [], unavailable: true, curated: null };

  try {
    const [response, featuredResponse] = await Promise.all([
      fetch(apiUrl + "/stories", { next: { revalidate: 60 } }),
      fetch(apiUrl + "/discovery/featured", { next: { revalidate: 60 } }),
    ]);
    if (!response.ok) throw new Error("Catalogue request failed.");
    const data = await response.json();
    const featuredData = featuredResponse.ok ? await featuredResponse.json() : null;
    return {
      stories: Array.isArray(data.items) ? data.items : [],
      unavailable: false,
      curated: featuredData && featuredData.story ? featuredData : null,
    };
  } catch {
    return { stories: [], unavailable: true, curated: null };
  }
}

function storyDescription(story: DiscoverStory) {
  return story.synopsis || story.tagline || "Explore the story and discover its world.";
}
function originLabel(story: DiscoverStory) {
  if (story.origin_type === "storyflicks_original") return story.content_format === "series" ? "A STORYFLICKS ORIGINAL SERIES" : "A STORYFLICKS ORIGINAL STORY";
  if (story.origin_type === "previously_published") return "PREVIOUSLY PUBLISHED";
  return "INDEPENDENT STORY";
}
function formatLabel(story: DiscoverStory) {
  return story.content_format === "series" ? "SERIES" : "STANDALONE STORY";
}

export default async function DiscoverPage() {
  const { stories, unavailable, curated } = await getCatalogue();
  const featured = curated?.story ?? stories[0] ?? null;
  const moreStories = stories.filter((story) => story.slug !== featured?.slug);
  const publishedCount = stories.length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="STORYFLICKS home">STORY<span>FLICKS</span><i>.</i></Link>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item, index) => <Link className={index === 0 ? "nav-link active" : "nav-link"} href={index === 0 ? "/" : "/library"} key={item}>{item}</Link>)}
          <CreatorStudioNavLink />
        </nav>
        <div className="account-actions">
          <Link className="icon-button" href="/search" aria-label="Search"><span className="search-icon" /></Link>
          <AccountNavigation />
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <h1>Stories worth <em>staying for.</em></h1>
          <p className="welcome-note"><span>A good story pulls you in.</span> <mark>A great one keeps you coming back.</mark></p>
        </div>
      </section>

      {featured ? (
        <section className="featured" aria-labelledby="featured-title">
          <div className="featured-copy">
            <div className="feature-kicker"><span className="live-dot" /> {curated?.kicker || "FEATURED STORY"}</div>
            <p className="feature-overline">{originLabel(featured)}</p>
            <h2 id="featured-title">{featured.title}</h2>
            {featured.author_name && <p className="feature-author-byline">By {featured.author_name}</p>}
            {featured.tagline && <p className="feature-tagline">{featured.tagline}</p>}
            <p className="feature-synopsis">{storyDescription(featured)}</p>
            <p className="feature-meta">{featured.genres?.join(" · ").toUpperCase() || "STORY"} <b>·</b> {(featured.completion_status || "ONGOING").toUpperCase()} <b>·</b> {formatLabel(featured)}</p>
            <div className="feature-actions">
              <Link className="primary-button" href={"/stories/" + featured.slug}>Explore the story <span>↗</span></Link>
              <Link className="text-button" href={"/stories/" + featured.slug + "#episodes"}>View {(featured.section_label_plural || "Chapters").toLowerCase()} guide <span>→</span></Link>
            </div>
          </div>
          <div className={featured.cover_url ? "feature-art has-cover" : "feature-art"} role="img" aria-label={featured.title + " book cover artwork"}>
            {featured.cover_url ? <RemoteImage className="feature-cover-image" src={featured.cover_url} alt={featured.title + " book cover"} fill sizes="(max-width: 900px) 80vw, 420px" priority /> : null}
            <div className="art-grain" />
            <div className="art-cross" />
            <div className="art-caption">STORIES THAT STAY<br />WITH YOU</div>
            <div className="art-title"><strong>{featured.title}</strong></div>
            <div className="art-index">{originLabel(featured)}</div>
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
          <div className="search-results catalogue-rail">
            {moreStories.slice(0, 6).map((story) => (
              <Link key={story.id || story.slug} className="search-result-card" data-tone={coverTone(story.slug)} href={"/stories/" + story.slug}>
                <div className={story.cover_url ? "search-result-art has-cover" : "search-result-art"} role="img" aria-label={story.title + " book cover artwork"}>
                  {isRecent(story.published_at) && <b className="new-badge">NEW</b>}
                  {story.cover_url ? <RemoteImage className="catalogue-cover-image" src={story.cover_url} alt={story.title + " book cover"} fill sizes="(max-width: 640px) 45vw, 200px" /> : <><span>{story.title}</span><small>{originLabel(story)}</small></>}
                </div>
                <div className="search-result-copy">
                  <p className="eyebrow">{story.genres?.join(" · ") || "STORY"} <span>·</span> {(story.completion_status || "ONGOING").toUpperCase()} <span>·</span> {formatLabel(story)}</p>
                  <h3>{story.title}</h3>
                  {story.author_name && <p className="catalogue-author-byline">By {story.author_name}</p>}
                  <p>{storyDescription(story)}</p>
                  <span className="text-button">Explore story <span>↗</span></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="browse-row">
        <div><p className="eyebrow">FIND YOUR KIND OF STORY</p><h2>What are you in the <span>mood</span> for?</h2></div>
        <div className="genre-list"><Link href="/search?genre=Drama">Drama <span>↗</span></Link><Link href="/search?genre=Thriller">Thriller <span>↗</span></Link><Link href="/search?genre=Romance">Romance <span>↗</span></Link><Link href="/search?genre=Mystery">Mystery <span>↗</span></Link></div>
      </section>

      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© 2026 STORYFLICKS</span><LegalLinks /></footer>
    </main>
  );
}
