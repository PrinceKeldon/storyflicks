import { getStory } from "../../../../lib/stories";
import { renderShareCard } from "../../../../lib/share-card";

// Link-preview card for one story: cover (when it is a PNG or JPEG) beside title, author and tagline.
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const story = (await getStory(slug))?.story;
  if (!story) return renderShareCard();
  return renderShareCard({
    title: story.title,
    author: story.author_name,
    tagline: story.tagline,
    genres: story.genres,
    coverUrl: story.cover_url,
  });
}
