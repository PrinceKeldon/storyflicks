export type ReviewBlock = { type?: string; text?: string; [key: string]: unknown };
export type ReviewEpisode = { id: string; sequence_number: number; title: string; synopsis?: string | null; content?: unknown; publication_status: string; ready_for_review?: boolean };
export type ReviewMaterial = { id: string; title: string; section_type: string; placement: "front_matter" | "back_matter"; position: number; content?: unknown; publication_status: string; is_visible: boolean };
export type ReviewStory = { title: string; tagline?: string | null; synopsis?: string | null; genres?: string[] | null };

export type ReviewIssue = {
  id: string;
  level: "fix" | "check" | "info";
  message: string;
  /** What the author can open to deal with it. */
  target: { kind: "story" } | { kind: "episode"; id: string } | { kind: "materials" } | { kind: "episodes" };
};

export type ReadingItem = {
  key: string;
  kind: "front" | "chapter" | "back";
  id: string;
  label: string;
  title: string;
  status: string;
  words: number;
  hasContent: boolean;
};

export type BookReview = {
  items: ReadingItem[];
  issues: ReviewIssue[];
  totals: { chapters: number; published: number; ready: number; draft: number; scheduled: number; front: number; back: number; words: number; minutes: number };
};

const SHORT_CHAPTER_WORDS = 80;
const WORDS_PER_MINUTE = 230;

export function blocksOf(content: unknown): ReviewBlock[] {
  if (Array.isArray(content)) return content as ReviewBlock[];
  if (content && typeof content === "object" && Array.isArray((content as { blocks?: unknown }).blocks)) return (content as { blocks: ReviewBlock[] }).blocks;
  return [];
}

export function countWords(content: unknown): number {
  let words = 0;
  for (const block of blocksOf(content)) {
    if (typeof block.text === "string") words += block.text.trim().split(/\s+/).filter(Boolean).length;
  }
  return words;
}

const key = (value: string) => value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

function repeatsTitle(content: unknown, title: string): boolean {
  const first = blocksOf(content).find((block) => typeof block.text === "string" && block.text.trim() !== "");
  return !!first && key(title) !== "" && key(String(first.text)) === key(title);
}

function statusLabel(episode: ReviewEpisode): string {
  return episode.publication_status === "draft" && episode.ready_for_review ? "ready for review" : episode.publication_status;
}

export function analyseBook(story: ReviewStory, coverUrl: string | null | undefined, episodes: ReviewEpisode[], materials: ReviewMaterial[], sectionLabel = "Chapter"): BookReview {
  const chapters = [...episodes].sort((a, b) => a.sequence_number - b.sequence_number);
  const front = materials.filter((m) => m.placement === "front_matter").sort((a, b) => a.position - b.position);
  const back = materials.filter((m) => m.placement === "back_matter").sort((a, b) => a.position - b.position);
  const label = sectionLabel;
  const issues: ReviewIssue[] = [];

  const items: ReadingItem[] = [
    ...front.map((m): ReadingItem => ({ key: "m-" + m.id, kind: "front", id: m.id, label: "FRONT", title: m.title, status: m.publication_status === "published" && m.is_visible ? "published" : m.is_visible ? "draft" : "hidden", words: countWords(m.content), hasContent: countWords(m.content) > 0 })),
    ...chapters.map((e): ReadingItem => ({ key: "e-" + e.id, kind: "chapter", id: e.id, label: String(e.sequence_number).padStart(2, "0"), title: e.title, status: statusLabel(e), words: countWords(e.content), hasContent: countWords(e.content) > 0 })),
    ...back.map((m): ReadingItem => ({ key: "m-" + m.id, kind: "back", id: m.id, label: "BACK", title: m.title, status: m.publication_status === "published" && m.is_visible ? "published" : m.is_visible ? "draft" : "hidden", words: countWords(m.content), hasContent: countWords(m.content) > 0 })),
  ];

  // ----- story
  if (!coverUrl) issues.push({ id: "story-cover", level: "check", message: "No cover image yet. Readers will see a generated cover.", target: { kind: "story" } });
  if (!(story.synopsis || "").trim()) issues.push({ id: "story-synopsis", level: "check", message: "The story has no description for its page.", target: { kind: "story" } });
  if (!(story.tagline || "").trim()) issues.push({ id: "story-tagline", level: "info", message: "No tagline set.", target: { kind: "story" } });
  if (!story.genres || story.genres.length === 0) issues.push({ id: "story-genres", level: "info", message: "No genres set, so the story is harder to find.", target: { kind: "story" } });

  // ----- chapters
  if (chapters.length === 0) {
    issues.push({ id: "no-chapters", level: "fix", message: `There are no ${label.toLowerCase()}s yet.`, target: { kind: "episodes" } });
  } else {
    const numbers = chapters.map((c) => c.sequence_number);
    const missing: number[] = [];
    for (let n = 1; n <= numbers[numbers.length - 1]; n += 1) if (!numbers.includes(n)) missing.push(n);
    if (missing.length) {
      const shown = missing.slice(0, 6).join(", ") + (missing.length > 6 ? "…" : "");
      issues.push({ id: "numbering-gaps", level: "check", message: `${label} numbers skip ${shown}. Use Reorder to renumber 1 to ${chapters.length}.`, target: { kind: "episodes" } });
    }
    const seenTitles = new Map<string, ReviewEpisode>();
    chapters.forEach((chapter, index) => {
      const name = `${label} ${chapter.sequence_number} “${chapter.title}”`;
      const words = countWords(chapter.content);
      if (words === 0) issues.push({ id: "empty-" + chapter.id, level: "fix", message: `${name} has no text.`, target: { kind: "episode", id: chapter.id } });
      else if (words < SHORT_CHAPTER_WORDS) issues.push({ id: "short-" + chapter.id, level: "check", message: `${name} is very short (${words} words).`, target: { kind: "episode", id: chapter.id } });
      if (!(chapter.synopsis || "").trim()) issues.push({ id: "syn-" + chapter.id, level: "check", message: `${name} has no synopsis for the ${label.toLowerCase()} guide.`, target: { kind: "episode", id: chapter.id } });
      if (repeatsTitle(chapter.content, chapter.title)) issues.push({ id: "title-" + chapter.id, level: "info", message: `${name}: the title also appears as the first line of the text. The reader hides the repeat.`, target: { kind: "episode", id: chapter.id } });
      const duplicate = seenTitles.get(key(chapter.title));
      if (duplicate && key(chapter.title)) issues.push({ id: "dup-" + chapter.id, level: "check", message: `${name} has the same title as ${label} ${duplicate.sequence_number}.`, target: { kind: "episode", id: chapter.id } });
      else seenTitles.set(key(chapter.title), chapter);
      const live = chapter.publication_status === "published" || chapter.publication_status === "scheduled";
      if (live) {
        const earlierUnpublished = chapters.slice(0, index).find((c) => c.publication_status !== "published" && c.publication_status !== "scheduled");
        if (earlierUnpublished) issues.push({ id: "gap-" + chapter.id, level: "check", message: `${name} is live but ${label} ${earlierUnpublished.sequence_number} is not, so readers may skip a ${label.toLowerCase()}.`, target: { kind: "episode", id: earlierUnpublished.id } });
      }
    });
    const notReady = chapters.filter((c) => c.publication_status === "draft" && !c.ready_for_review).length;
    if (notReady) issues.push({ id: "not-ready", level: "info", message: `${notReady} draft ${label.toLowerCase()}${notReady === 1 ? " isn’t" : "s aren’t"} marked ready for review.`, target: { kind: "episodes" } });
  }

  // ----- front and back matter
  for (const material of [...front, ...back]) {
    const name = `“${material.title}”`;
    if (countWords(material.content) === 0) issues.push({ id: "mat-empty-" + material.id, level: "check", message: `${name} has no text.`, target: { kind: "materials" } });
    if (!material.is_visible) issues.push({ id: "mat-hidden-" + material.id, level: "check", message: `${name} is hidden from readers.`, target: { kind: "materials" } });
    else if (material.publication_status !== "published") issues.push({ id: "mat-draft-" + material.id, level: "check", message: `${name} is still a draft, so readers won’t see it.`, target: { kind: "materials" } });
  }

  const order = { fix: 0, check: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.level] - order[b.level]);

  const words = items.reduce((sum, item) => sum + item.words, 0);
  const count = (status: string) => chapters.filter((c) => c.publication_status === status).length;
  return {
    items,
    issues,
    totals: {
      chapters: chapters.length,
      published: count("published"),
      scheduled: count("scheduled"),
      ready: chapters.filter((c) => c.publication_status === "draft" && c.ready_for_review).length,
      draft: chapters.filter((c) => c.publication_status === "draft" && !c.ready_for_review).length,
      front: front.length,
      back: back.length,
      words,
      minutes: Math.max(words > 0 ? 1 : 0, Math.round(words / WORDS_PER_MINUTE)),
    },
  };
}
