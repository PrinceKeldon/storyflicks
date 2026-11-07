import Link from "next/link";

type Episode = {
  id: string;
  sequence_number: number;
  title: string;
  synopsis?: string | null;
  publication_status: string;
};

type StoryResponse = {
  story: {
    id: string;
    slug: string;
    title: string;
    tagline?: string | null;
    synopsis?: string | null;
    cover_url?: string | null;
  };
  episodes: Episode[];
};

const knownEpisodes = [
  { sequence_number: 1, title: "The Confession" },
  { sequence_number: 2, title: "Sins of Coffee-ssion" },
];

async function getStory(slug: string): Promise<StoryResponse | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) return null;

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/stories/${slug}`, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as StoryResponse;
  } catch {
    return null;
  }
}

export default async function StoryDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug !== "the-priest") {
    return <main className="app-shell detail-shell"><Link href="/" className="back-link">← Discover</Link><p className="eyebrow">STORY NOT FOUND</p><h1 className="detail-heading">This story isn’t here.</h1></main>;
  }

  const result = await getStory(slug);
  const story = result?.story;
  const episodes = result?.episodes ?? knownEpisodes.map((episode) => ({ ...episode, id: "", publication_status: "published" }));

  return (
    <main className="app-shell detail-shell">
      <header className="detail-top"><Link href="/" className="back-link">← Back to Discover</Link><span className="detail-label">STORYFLICKS ORIGINAL / 001</span></header>
      <section className="story-intro">
        <div className="story-poster" aria-label="THE PRIEST title artwork">
          <span className="poster-kicker">A STORY ABOUT FAITH, DESIRE &amp; SECRETS</span>
          <span className="poster-title">THE<br /><strong>PRIEST</strong></span>
          <span className="poster-foot">STORYFLICKS ORIGINAL</span>
        </div>
        <div className="story-info">
          <p className="eyebrow">DRAMA · ONGOING · EPISODIC</p>
          <h1>{story?.title ?? "THE PRIEST"}</h1>
          <p className="story-tagline">{story?.tagline ?? "Two lives. One secret. A confession that changes everything."}</p>
          <p className="story-synopsis">{story?.synopsis ?? "For over twenty years, Father James has kept his priestly life separate from the man he secretly becomes beyond the collar. But when Sophia enters his world, questions of faith, desire and identity begin to blur — and some secrets may be impossible to keep."}</p>
          <div className="story-facts"><span>12 EPISODES</span><span>ONGOING</span><span>FIRST EPISODE FREE</span></div>
          <a href="#episodes" className="primary-button">Explore episodes <span>↓</span></a>
        </div>
      </section>
      <section className="episode-guide" id="episodes">
        <div className="section-heading"><div><p className="eyebrow">THE STORY SO FAR</p><h2>Episode guide<span>.</span></h2></div><span className="guide-count">{episodes.length} PUBLISHED</span></div>
        <div className="episode-list">
          {episodes.map((episode) => (
            <article className="episode-row" key={episode.id || episode.sequence_number}>
              <span className="episode-number">{String(episode.sequence_number).padStart(2, "0")}</span>
              <div className="episode-copy"><h3>{episode.title}</h3><p>{episode.synopsis || (episode.sequence_number === 1 ? "Every secret has a beginning." : "The confession leaves its mark.")}</p></div>
              <span className="episode-status">PUBLISHED</span>
              <span className="episode-arrow">↗</span>
            </article>
          ))}
        </div>
        <p className="episode-note">More episodes are in the works. Follow the story as it unfolds.</p>
      </section>
      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© 2026 STORYFLICKS</span></footer>
    </main>
  );
}