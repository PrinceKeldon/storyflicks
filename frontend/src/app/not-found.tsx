import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-shell detail-shell">
      <header className="detail-top"><Link href="/" className="back-link">← Back to Discover</Link><span className="detail-label">STORYFLICKS</span></header>
      <section className="story-info">
        <p className="eyebrow">404 · PAGE NOT FOUND</p>
        <h1 className="detail-heading">This page isn’t here.</h1>
        <p className="story-synopsis">The link may be incorrect or the page may have moved.</p>
        <Link href="/" className="primary-button">Explore stories <span>↗</span></Link>
      </section>
    </main>
  );
}
