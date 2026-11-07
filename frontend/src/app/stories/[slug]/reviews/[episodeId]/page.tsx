import ReviewRoom from "./review-room";

export default async function EpisodeReviewRoomPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  return <ReviewRoom slug={slug} episodeId={episodeId} />;
}
