export default function StoryLoading() {
  return (
    <main className="app-shell detail-shell" aria-busy="true" aria-label="Loading story">
      <p className="eyebrow">STORYFLICKS</p>
      <h1 className="detail-heading">Opening the story…</h1>
      <p className="story-synopsis">Loading story details and published sections.</p>
    </main>
  );
}
