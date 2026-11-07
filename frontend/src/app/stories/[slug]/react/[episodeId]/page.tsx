import Link from "next/link";
import ReactionPanel from "./reaction-panel";

export default async function EpisodeReactionPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  return <ReactionPanel slug={slug} episodeId={episodeId} />;
}
