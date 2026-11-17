import Link from "next/link";

export default function StoryNotFound() {
  return (
    <main className="app-shell detail-shell">
      <header className="detail-top"><Link href="/" className="back-link">← Back to Discover</Link><span className="detail-label">STORYFLICKS</span></header>
      <section className="story-info">
        <p className="eyebrow">404 · STORY NOT FOUND</p>
        <h1 className="detail-heading">This story isn’t here.</h1>
        <p className="story-synopsis">The story may have been unpublished, moved or the link may be incorrect.</p>
        <Link href="/" className="primary-button">Explore published stories <span>↗</span></Link>
      </section>
    </main>
  );
}
