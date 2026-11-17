"use client";

export default function StoryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="app-shell detail-shell" role="alert">
      <p className="eyebrow">A SMALL INTERRUPTION</p>
      <h1 className="detail-heading">We couldn’t load this story.</h1>
      <p className="story-synopsis">Please try again. Your place in the catalogue has not changed.</p>
      <button className="primary-button" type="button" onClick={() => reset()}>Try again <span>↻</span></button>
    </main>
  );
}
