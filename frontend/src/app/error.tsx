"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="app-shell detail-shell" role="alert">
      <p className="eyebrow">A SMALL INTERRUPTION</p>
      <h1 className="detail-heading">Something went wrong.</h1>
      <p className="story-synopsis">Please try again. If it keeps happening, come back in a few minutes.</p>
      <button className="primary-button" type="button" onClick={() => reset()}>Try again <span>↻</span></button>
    </main>
  );
}
