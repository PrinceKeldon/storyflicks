import RemoteImage from "@/components/remote-image";
import Link from "next/link";
import { notFound } from "next/navigation";
import BookmarkButton from "./bookmark-button";
import SupportStoryButton from "./support-story-button";
import LegalLinks from "../../legal-links";
import type { Metadata } from "next";
import { SITE_URL, cardVersion, getStory, shortText, type StoryResponse } from "../../../lib/stories";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  let story: StoryResponse["story"] | undefined;
  try {
    story = (await getStory(slug))?.story;
  } catch {
    return { title: "Story temporarily unavailable", robots: { index: false, follow: false } };
  }
  if (!story) return { title: "Story not found", robots: { index: false, follow: true } };
  const description = shortText(story.tagline && story.synopsis ? `${story.tagline} ${story.synopsis}` : story.tagline || story.synopsis)
    || "A story on STORYFLICKS.";
  const card = `/stories/${encodeURIComponent(slug)}/og?v=${cardVersion(story.title, story.author_name, story.tagline, story.cover_url)}`;
  const byline = story.author_name ? `${story.title} by ${story.author_name}` : story.title;
  return {
    title: story.title,
    description,
    alternates: { canonical: `/stories/${encodeURIComponent(slug)}` },
    openGraph: {
      type: "book",
      siteName: "STORYFLICKS",
      title: byline,
      description,
      url: `/stories/${encodeURIComponent(slug)}`,
      images: [{ url: card, width: 1200, height: 630, alt: `${story.title} on STORYFLICKS` }],
      ...(story.author_name ? { authors: [story.author_name] } : {}),
      ...(story.genres?.length ? { tags: story.genres } : {}),
    },
    twitter: { card: "summary_large_image", title: byline, description, images: [card] },
  };
}

export default async function StoryDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getStory(slug);
  if (!result) notFound();
  const story = result.story;
  const episodes = result.episodes;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "CreativeWorkSeries",
    name: story.title,
    url: `${SITE_URL}/stories/${encodeURIComponent(slug)}`,
    ...(story.author_name ? { author: { "@type": "Person", name: story.author_name } } : {}),
    ...(shortText(story.synopsis || story.tagline, 500) ? { description: shortText(story.synopsis || story.tagline, 500) } : {}),
    ...(story.genres?.length ? { genre: story.genres } : {}),
    ...(story.cover_url ? { image: story.cover_url } : {}),
    ...(episodes.length ? { hasPart: episodes.map((episode) => ({ "@type": "CreativeWork", name: episode.title, url: `${SITE_URL}/stories/${encodeURIComponent(slug)}#episode-${episode.id}`, ...(episode.synopsis ? { description: shortText(episode.synopsis, 300) } : {}), datePublished: episode.published_at })) } : {}),
  };
  const sectionLabel = story.section_label || "Episode";
  const sectionLabelPlural = story?.section_label_plural || "Episodes";
  const isChapterGuide = sectionLabel.trim().toLowerCase() === "chapter";
  const frontMatter = (result?.materials || []).filter(item => item.placement === "front_matter");
  const backMatter = (result?.materials || []).filter(item => item.placement === "back_matter");
  const preferredGenreOrder = ["drama", "forbidden romance", "psychological drama", "mystery & suspense"];
  const displayedGenres = [...(story?.genres || [])].sort((a, b) => {
    const aIndex = preferredGenreOrder.indexOf(a.trim().toLowerCase());
    const bIndex = preferredGenreOrder.indexOf(b.trim().toLowerCase());
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return (
    <main className="app-shell detail-shell">
      {structuredData && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />}
      <header className="detail-top"><Link href="/" className="back-link">← Back to Discover</Link><span className="detail-label">STORYFLICKS ORIGINAL</span></header>
      <section className="story-intro">
        <div className={story?.cover_url ? "story-poster has-cover" : "story-poster"} aria-label={`${story?.title ?? "Story"} book cover artwork`}>
          {story?.cover_url ? <RemoteImage className="story-cover-image" src={story.cover_url} alt={`${story.title} book cover`} fill sizes="(max-width: 700px) 80vw, 360px" priority /> : <><span className="poster-kicker">{"A STORYFLICKS ORIGINAL"}</span><span className="poster-title">{story.title}</span><span className="poster-foot">STORYFLICKS ORIGINAL</span></>}
        </div>
        <div className="story-info">
          
          <h1>{story.title}</h1>
          {story?.author_name && <p className="story-author-byline">By {story.author_name}</p>}
          <p className="story-tagline">{story.tagline || "A new STORYFLICKS original."}</p>
          <p className="story-synopsis">{story.synopsis || "Story details are coming soon."}</p>
          <div className="story-facts"><span>{episodes.length} PUBLISHED {sectionLabelPlural.toUpperCase()}</span><span>{(story?.completion_status || "ongoing").toUpperCase()}</span><span>{story?.first_episode_free === false ? "ACCESS REQUIRED" : "FREE READING · UNLOCK THE NEXT EPISODE WITH YOUR REACTION"}</span></div>
          {displayedGenres.length ? <p className="story-genres">{displayedGenres.join(" · ")}</p> : null}
          <div className="story-primary-actions">{episodes[0]?.id && <Link href={`/stories/${slug}/read/${episodes[0].id}`} className="primary-button">Read first {sectionLabel.toLowerCase()} <span>→</span></Link>}<a href="#episodes" className={episodes[0]?.id ? "outline-button" : "primary-button"}>Explore {sectionLabelPlural.toLowerCase()} <span>↓</span></a>{story?.id && <BookmarkButton storyId={story.id} slug={slug} />}</div>
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
              <Link href={`/stories/${slug}/read/${episode.id}`} className={isChapterGuide ? "episode-row chapter-guide-row" : "episode-row"} key={episode.id} id={`episode-${episode.id}`}>
                {episode.image_url && <RemoteImage className="episode-thumb episode-thumb-portrait" src={episode.image_url} alt={episode.image_alt || `${episode.title} ${sectionLabel.toLowerCase()} artwork`} width={116} height={174} sizes="116px" />}
                <span className="episode-number">{String(episode.sequence_number).padStart(2, "0")}</span>
                <div className="episode-copy"><h3>{episode.title}</h3>{episode.synopsis?.trim() && <p>{episode.synopsis}</p>}</div>
                {!isChapterGuide && <><span className="episode-status">PUBLISHED</span><span className="episode-arrow">↗</span></>}
              </Link>
            ) : (
              <article className={isChapterGuide ? "episode-row chapter-guide-row" : "episode-row"} key={episode.sequence_number}>
                {episode.image_url && <RemoteImage className="episode-thumb episode-thumb-portrait" src={episode.image_url} alt={episode.image_alt || `${episode.title} ${sectionLabel.toLowerCase()} artwork`} width={116} height={174} sizes="116px" />}
                <span className="episode-number">{String(episode.sequence_number).padStart(2, "0")}</span>
                <div className="episode-copy"><h3>{episode.title}</h3>{episode.synopsis?.trim() && <p>{episode.synopsis}</p>}</div>
                {!isChapterGuide && <><span className="episode-status">PUBLISHED</span><span className="episode-arrow">↗</span></>}
              </article>
            )
          ))}
        </div>
        <p className="episode-note">{story?.completion_status === "completed" ? "This story is complete. Enjoy the full journey." : `More ${sectionLabelPlural.toLowerCase()} are in the works. Follow the story as it unfolds.`}</p>
      </section>
      {backMatter.length>0&&<section className="episode-guide sf-reader-material-guide"><div className="section-heading"><div><p className="eyebrow">AFTER THE STORY</p><h2>Closing pages<span>.</span></h2></div><span className="guide-count">{backMatter.length} SECTIONS</span></div><div className="episode-list">{backMatter.map(item=><Link href={`/stories/${slug}/material/${item.id}`} className="episode-row chapter-guide-row" key={item.id}><span className="episode-number">·</span><div className="episode-copy"><h3>{item.title}</h3></div><span className="episode-arrow">↗</span></Link>)}</div></section>}
      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© {new Date().getFullYear()} STORYFLICKS</span><LegalLinks /></footer>
    </main>
  );
}