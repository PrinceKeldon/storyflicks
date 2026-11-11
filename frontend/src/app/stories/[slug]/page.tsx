import Link from "next/link";
import BookmarkButton from "./bookmark-button";
import SupportStoryButton from "./support-story-button";
import LegalLinks from "../../legal-links";

type Episode = {
  id: string;
  sequence_number: number;
  title: string;
  synopsis?: string | null;
  publication_status: string;
  image_url?: string | null;
  image_alt?: string | null;
};

type StoryResponse = {
  story: {
    id: string;
    slug: string;
    title: string;
    author_name?: string | null;
    section_label?: string | null;
    section_label_plural?: string | null;
    tagline?: string | null;
    synopsis?: string | null;
    genres?: string[];
    completion_status?: string | null;
    first_episode_free?: boolean;
    cover_url?: string | null;
  };
  episodes: Episode[];
  materials?: {id:string;title:string;section_type:string;placement:"front_matter"|"back_matter";position:number}[];
};

const knownEpisodes: Episode[] = [
  { id: "", sequence_number: 1, title: "The Confession", publication_status: "published" },
  { id: "", sequence_number: 2, title: "Sins of Coffee-ssion", publication_status: "published" },
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
  const result = await getStory(slug);
  if (!result && slug !== "the-priest") {
    return <main className="app-shell detail-shell"><Link href="/" className="back-link">← Discover</Link><p className="eyebrow">STORY NOT FOUND</p><h1 className="detail-heading">This story isn’t here.</h1></main>;
  }
  const story = result?.story;
  const episodes = result?.episodes ?? (slug === "the-priest" ? knownEpisodes : []);
  const sectionLabel = story?.section_label || "Episode";
  const sectionLabelPlural = story?.section_label_plural || "Episodes";
  const isChapterGuide = sectionLabel.trim().toLowerCase() === "chapter";
  const frontMatter = (result?.materials || []).filter(item => item.placement === "front_matter");
  const backMatter = (result?.materials || []).filter(item => item.placement === "back_matter");

  return (
    <main className="app-shell detail-shell">
      <header className="detail-top"><Link href="/" className="back-link">← Back to Discover</Link><span className="detail-label">STORYFLICKS ORIGINAL / 001</span></header>
      <section className="story-intro">
        <div className={story?.cover_url ? "story-poster has-cover" : "story-poster"} aria-label={`${story?.title ?? "Story"} book cover artwork`}>
          {story?.cover_url ? <img className="story-cover-image" src={story.cover_url} alt={`${story.title} book cover`} /> : <><span className="poster-kicker">{story?.genres?.join(" · ").toUpperCase() || (slug === "the-priest" ? "A STORY ABOUT FAITH, DESIRE & SECRETS" : "A STORYFLICKS ORIGINAL")}</span><span className="poster-title">{story?.title ?? "The Priest"}</span><span className="poster-foot">STORYFLICKS ORIGINAL</span></>}
        </div>
        <div className="story-info">
          <p className="eyebrow">{story?.genres?.join(" · ").toUpperCase() || "STORYFLICKS ORIGINAL"} · {(story?.completion_status || "ongoing").toUpperCase()} · {sectionLabelPlural.toUpperCase()}</p>
          <h1>{story?.title ?? (slug === "the-priest" ? "The Priest" : "Story")}</h1>
          {story?.author_name && <p className="story-author-byline">By {story.author_name}</p>}
          <p className="story-tagline">{story?.tagline ?? (slug === "the-priest" ? "Two lives. One secret. A confession that changes everything." : "A new STORYFLICKS original.")}</p>
          <p className="story-synopsis">{story?.synopsis ?? (slug === "the-priest" ? "For over twenty years, Father James has kept his priestly life separate from the man he secretly becomes beyond the collar. But when Sophia enters his world, questions of faith, desire and identity begin to blur — and some secrets may be impossible to keep." : "Story details are coming soon.")}</p>
          <div className="story-facts"><span>{episodes.length} PUBLISHED {sectionLabelPlural.toUpperCase()}</span><span>{(story?.completion_status || "ongoing").toUpperCase()}</span><span>{story?.first_episode_free === false ? "ACCESS REQUIRED" : "FIRST EPISODE FREE"}</span></div>
          <div className="story-primary-actions"><a href="#episodes" className="primary-button">Explore {sectionLabelPlural.toLowerCase()} <span>↓</span></a>{story?.id && <BookmarkButton storyId={story.id} slug={slug} />}</div>
          {episodes[0]?.id && <Link href={`/stories/${slug}/reviews/${episodes[0].id}`} className="story-discussion-link">Enter the Review Room <span>↗</span></Link>}
          {story?.id && <SupportStoryButton storyId={story.id} slug={slug} />}
        </div>
      </section>
      {frontMatter.length>0&&<section className="episode-guide sf-reader-material-guide"><div className="section-heading"><div><p className="eyebrow">BEFORE THE STORY</p><h2>Opening pages<span>.</span></h2></div><span className="guide-count">{frontMatter.length} SECTIONS</span></div><div className="episode-list">{frontMatter.map(item=><Link href={`/stories/${slug}/material/${item.id}`} className="episode-row chapter-guide-row" key={item.id}><span className="episode-number">·</span><div className="episode-copy"><h3>{item.title}</h3></div><span className="episode-arrow">↗</span></Link>)}</div></section>}
      <section className="episode-guide" id="episodes">
        <div className="section-heading"><div><p className="eyebrow">THE STORY SO FAR</p><h2>{sectionLabelPlural} guide<span>.</span></h2></div><span className="guide-count">{episodes.length} PUBLISHED</span></div>
        <div className="episode-list">
          {episodes.map((episode) => (
            episode.id ? (
              <Link href={`/stories/${slug}/read/${episode.id}`} className={isChapterGuide ? "episode-row chapter-guide-row" : "episode-row"} key={episode.id}>
                {episode.image_url && <img className="episode-thumb episode-thumb-portrait" src={episode.image_url} alt={episode.image_alt || `${episode.title} ${sectionLabel.toLowerCase()} artwork`} />}
                <span className="episode-number">{String(episode.sequence_number).padStart(2, "0")}</span>
                <div className="episode-copy"><h3>{episode.title}</h3>{episode.synopsis?.trim() && <p>{episode.synopsis}</p>}</div>
                {!isChapterGuide && <><span className="episode-status">PUBLISHED</span><span className="episode-arrow">↗</span></>}
              </Link>
            ) : (
              <article className={isChapterGuide ? "episode-row chapter-guide-row" : "episode-row"} key={episode.sequence_number}>
                {episode.image_url && <img className="episode-thumb episode-thumb-portrait" src={episode.image_url} alt={episode.image_alt || `${episode.title} episode artwork`} />}
                <span className="episode-number">{String(episode.sequence_number).padStart(2, "0")}</span>
                <div className="episode-copy"><h3>{episode.title}</h3>{episode.synopsis?.trim() && <p>{episode.synopsis}</p>}</div>
                {!isChapterGuide && <><span className="episode-status">PUBLISHED</span><span className="episode-arrow">↗</span></>}
              </article>
            )
          ))}
        </div>
        <p className="episode-note">{story?.completion_status === "completed" ? "This story is complete. Enjoy the full journey." : "More ${sectionLabelPlural.toLowerCase()} are in the works. Follow the story as it unfolds."}</p>
      </section>
      {backMatter.length>0&&<section className="episode-guide sf-reader-material-guide"><div className="section-heading"><div><p className="eyebrow">AFTER THE STORY</p><h2>Closing pages<span>.</span></h2></div><span className="guide-count">{backMatter.length} SECTIONS</span></div><div className="episode-list">{backMatter.map(item=><Link href={`/stories/${slug}/material/${item.id}`} className="episode-row chapter-guide-row" key={item.id}><span className="episode-number">·</span><div className="episode-copy"><h3>{item.title}</h3></div><span className="episode-arrow">↗</span></Link>)}</div></section>}
      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© 2026 STORYFLICKS</span><LegalLinks /></footer>
    </main>
  );
}