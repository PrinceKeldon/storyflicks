"use client";

import { useEffect, useMemo, useState } from "react";
import ReadingRoom from "../stories/[slug]/read/[episodeId]/reading-room";
import { analyseBook, blocksOf, type ReadingItem, type ReviewEpisode, type ReviewIssue, type ReviewMaterial, type ReviewStory } from "../../lib/book-review";

type Asset = { id: string; episode_id?: string | null; asset_type: string; public_url?: string | null; alt_text?: string | null; position?: number };
type Req = (path: string, options?: RequestInit) => Promise<unknown>;
type Target = ReviewIssue["target"];

export default function BookReview({ storyId, slug, story, coverUrl, episodes, assets, sectionLabel, sectionLabelPlural, request, onOpen }: {
  storyId: string; slug: string; story: ReviewStory & { id: string }; coverUrl: string | null; episodes: ReviewEpisode[]; assets: Asset[];
  sectionLabel: string; sectionLabelPlural: string; request: Req; onOpen: (target: Target) => void;
}) {
  const [materials, setMaterials] = useState<ReviewMaterial[] | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setMaterials(null);
    setError("");
    request("/creator/stories/" + storyId + "/materials")
      .then((data) => { if (live) setMaterials(((data as { materials?: ReviewMaterial[] }).materials) || []); })
      .catch((e) => { if (live) { setMaterials([]); setError(e instanceof Error ? e.message : "Could not load front and back matter."); } });
    return () => { live = false; };
  }, [storyId, request]);

  const review = useMemo(() => analyseBook(story, coverUrl, episodes, materials || [], sectionLabel), [story, coverUrl, episodes, materials, sectionLabel]);
  const t = review.totals;
  const hasText = review.items.filter((item) => item.hasContent);

  function previewPayload(item: ReadingItem) {
    const chapter = item.kind === "chapter" ? episodes.find((e) => e.id === item.id) : null;
    const material = item.kind !== "chapter" ? (materials || []).find((m) => m.id === item.id) : null;
    return {
      story: { id: storyId, slug, title: story.title, section_label: item.kind === "chapter" ? sectionLabel : (material?.title || "Section"), section_label_plural: sectionLabelPlural },
      episode: {
        id: item.id,
        sequence_number: chapter ? chapter.sequence_number : 0,
        title: chapter ? chapter.title || "Untitled" : (material?.title || "Untitled"),
        synopsis: chapter?.synopsis || null,
        content: { blocks: blocksOf(chapter ? chapter.content : material?.content) },
        assets: chapter ? assets.filter((a) => a.episode_id === chapter.id && a.asset_type === "inline_image" && a.public_url).map((a) => ({ id: a.id, asset_type: a.asset_type, public_url: a.public_url, alt_text: a.alt_text, position: a.position ?? 0 })) : [],
      },
      next_episode: null, previous_episode: null, reading_progress: null,
    };
  }

  const current = reading !== null ? hasText[reading] : null;
  const levelLabel = { fix: "FIX", check: "CHECK", info: "NOTE" } as const;
  const fixes = review.issues.filter((i) => i.level === "fix").length;
  const checks = review.issues.filter((i) => i.level === "check").length;

  return (
    <section className="studio-content book-review">
      <div className="studio-block-heading"><div><span>BOOK REVIEW</span><small>Read the whole book in order and fix what is left before you publish.</small></div>
        <button type="button" className="primary-button" disabled={hasText.length === 0} onClick={() => setReading(0)}>Read the whole book <span>→</span></button></div>

      <div className="book-review-tiles">
        <div><strong>{t.chapters}</strong><span>{t.chapters === 1 ? sectionLabel : sectionLabelPlural}</span></div>
        <div><strong>{t.published}</strong><span>published</span></div>
        <div><strong>{t.ready}</strong><span>ready for review</span></div>
        <div><strong>{t.draft}</strong><span>drafts</span></div>
        <div><strong>{t.words.toLocaleString()}</strong><span>words</span></div>
        <div><strong>{t.minutes}</strong><span>min read</span></div>
      </div>

      <h3 className="book-review-heading">Before you publish</h3>
      {materials === null ? <p className="studio-muted">Checking your book…</p> : review.issues.length === 0 ? <p className="book-review-clear">Nothing to fix. This book is ready.</p> : <>
        <p className="studio-muted">{fixes} to fix, {checks} to check.</p>
        <ul className="book-review-issues">{review.issues.map((issue) => (
          <li key={issue.id} data-level={issue.level}><span className="book-review-level">{levelLabel[issue.level]}</span><span>{issue.message}</span>
            <button type="button" className="text-button" onClick={() => onOpen(issue.target)}>Open</button></li>))}</ul></>}
      {error && <p className="studio-muted">{error}</p>}

      <h3 className="book-review-heading">Reading order</h3>
      <ol className="book-review-order">{review.items.map((item) => {
        const index = hasText.findIndex((h) => h.key === item.key);
        return (
          <li key={item.key} data-kind={item.kind}>
            <span className="book-review-num">{item.label}</span>
            <span className="book-review-title">{item.title || "Untitled"}</span>
            <span className="studio-status-tag" data-status={item.status}>{item.status.toUpperCase()}</span>
            <span className="book-review-words">{item.words.toLocaleString()} words</span>
            <button type="button" className="text-button" disabled={index < 0} onClick={() => setReading(index)}>Preview</button>
            <button type="button" className="text-button" onClick={() => onOpen(item.kind === "chapter" ? { kind: "episode", id: item.id } : { kind: "materials" })}>Edit</button>
          </li>);
      })}</ol>

      {current && reading !== null && (
        <div className="studio-reader-preview" role="dialog" aria-modal="true" aria-label="Whole book preview">
          <ReadingRoom key={current.key} preview slug={slug} episodeId="preview" initialStatus="ready" onClosePreview={() => setReading(null)}
            initialPayload={previewPayload(current)}
            previewNav={{
              position: `${reading + 1} of ${hasText.length}`,
              onPrevious: reading > 0 ? () => setReading(reading - 1) : undefined,
              previousLabel: reading > 0 ? hasText[reading - 1].title || "Previous" : undefined,
              onNext: reading < hasText.length - 1 ? () => setReading(reading + 1) : undefined,
              nextLabel: reading < hasText.length - 1 ? hasText[reading + 1].title || "Next" : undefined,
            }} />
        </div>
      )}
    </section>
  );
}
