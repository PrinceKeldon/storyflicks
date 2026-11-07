import Link from "next/link";
import ReviewRoom from "./review-room";

export default async function EpisodeReviewRoomPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  if (slug !== "the-priest") {
    return <main className="reader-state"><p className="eyebrow">STORY NOT FOUND</p><h1>This story isn’t here.</h1><Link href="/">Back to Discover</Link></main>;
  }
  return <ReviewRoom episodeId={episodeId} />;
}
