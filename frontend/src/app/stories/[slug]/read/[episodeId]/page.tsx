import type { Metadata } from "next";
import ReadingRoom from "./reading-room";
import { SITE_URL, cardVersion, getStory, shortText } from "../../../../../lib/stories";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; episodeId: string }> }): Promise<Metadata> {
  const { slug, episodeId } = await params;
  try {
    const result = await getStory(slug);
    if (!result) return { title: "Episode not found", robots: { index: false, follow: true } };
    const episode = result.episodes.find((item) => item.id === episodeId);
    if (!episode) return { title: "Episode not found", robots: { index: false, follow: true } };
    const title = `${episode.title} | ${result.story.title}`;
    const description = shortText(episode.synopsis || result.story.tagline || result.story.synopsis) || `${episode.title} from ${result.story.title} on STORYFLICKS.`;
    const card = `/stories/${encodeURIComponent(slug)}/og?episode=${encodeURIComponent(episodeId)}&v=${cardVersion(result.story.title, episode.title, episode.synopsis, result.story.cover_url)}`;
    return {
      title,
      description,
      alternates: { canonical: `/stories/${encodeURIComponent(slug)}/read/${encodeURIComponent(episodeId)}` },
      robots: { index: false, follow: true },
      openGraph: { type: "article", siteName: "STORYFLICKS", title, description, url: `/stories/${encodeURIComponent(slug)}/read/${encodeURIComponent(episodeId)}`, images: [{ url: card, width: 1200, height: 630, alt: `${episode.title} from ${result.story.title}` }], ...(result.story.author_name ? { authors: [result.story.author_name] } : {}) },
      twitter: { card: "summary_large_image", title, description, images: [card] },
    };
  } catch {
    return { title: "Episode temporarily unavailable", robots: { index: false, follow: false } };
  }
}

export default async function ReadingPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  return <ReadingRoom slug={slug} episodeId={episodeId} />;
}
