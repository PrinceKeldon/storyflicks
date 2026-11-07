import Link from "next/link";
import ReactionPanel from "./reaction-panel";

export default async function EpisodeReactionPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  if (slug !== "the-priest") {
    return <main className="reader-state"><p className="eyebrow">STORY NOT FOUND</p><h1>This story isn’t here.</h1><Link href="/">Back to Discover</Link></main>;
  }
  return <ReactionPanel episodeId={episodeId} />;
}
