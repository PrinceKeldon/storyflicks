import ReadingRoom from "./reading-room";

export default async function ReadingPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  return <ReadingRoom slug={slug} episodeId={episodeId} />;
}
