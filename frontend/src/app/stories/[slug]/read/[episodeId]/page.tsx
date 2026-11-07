import Link from "next/link";
import ReadingRoom from "./reading-room";

export default async function ReadingPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  if (slug !== "the-priest") {
    return <main className="app-shell detail-shell"><Link href="/" className="back-link">← Discover</Link><p className="eyebrow">STORY NOT FOUND</p><h1 className="detail-heading">This story isn’t here.</h1></main>;
  }
  return <ReadingRoom episodeId={episodeId} />;
}
