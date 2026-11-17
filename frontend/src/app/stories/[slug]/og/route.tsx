import { getStory } from "../../../../lib/stories";
import { renderShareCard } from "../../../../lib/share-card";

// Link-preview card for one story: cover (when it is a PNG or JPEG) beside title, author and tagline.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const result = await getStory(slug);
    if (!result) return renderShareCard();
    const episodeId = new URL(request.url).searchParams.get("episode");
    const episode = episodeId ? result.episodes.find((item) => item.id === episodeId) : null;
    if (episodeId && !episode) return renderShareCard();
    return renderShareCard({
      title: episode ? episode.title : result.story.title,
      author: result.story.author_name,
      tagline: episode?.synopsis || result.story.tagline,
      genres: result.story.genres,
      coverUrl: result.story.cover_url,
    });
  } catch {
    return renderShareCard();
  }
}
