export type TitleBlock = { type?: string; text?: string; sectionTitle?: boolean; [key: string]: unknown };

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
const LABEL = new RegExp(`^(?:(?:chapter|episode|part|section|book)\\s+(?:\\d{1,3}|[ivxlcdm]+|${NUMBER_WORDS}))\\s*[:.\\-–—]?\\s*`, "i");

/** "Chapter 1: A Deadly Ambush" -> "A Deadly Ambush"; "3. The Road" -> "The Road". */
export function cleanChapterTitle(value: string): string {
  const trimmed = value.trim();
  const stripped = trimmed.replace(LABEL, "").replace(/^\d{1,3}[.)]\s*/, "").trim();
  return stripped || trimmed;
}

function key(value: string): string {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

export type TitleSplit = {
  /** Body blocks without the leading title block(s). */
  blocks: TitleBlock[];
  /** The title found in the document, cleaned of "Chapter N" labels, or null. */
  title: string | null;
  /** True when a leading title block was removed from the body. */
  removed: boolean;
  /** Text of the removed block(s), for showing the author what changed. */
  removedText: string | null;
};

/**
 * Separates a chapter's title from its body after a DOCX/text import.
 * The first non-empty block is the title when it is a heading, is flagged as a section title,
 * is a "Chapter N" style label, or repeats the current title. A lone "Chapter 1" label followed by
 * a short title line is treated as a two-line title. Otherwise the document is left untouched.
 */
export function splitChapterTitle(blocks: TitleBlock[], currentTitle = ""): TitleSplit {
  const none: TitleSplit = { blocks, title: null, removed: false, removedText: null };
  const textOf = (block: TitleBlock) => (typeof block.text === "string" ? block.text.trim() : "");
  const first = blocks.findIndex((block) => textOf(block) !== "");
  if (first < 0 || first > 3) return none;
  const head = textOf(blocks[first]);
  if (head.length > 160) return none;
  const kind = String(blocks[first].type || "paragraph").toLowerCase();
  const isLabel = LABEL.test(head) || /^\d{1,3}[.)]\s+\S/.test(head);
  const repeatsCurrent = !!currentTitle.trim() && [key(currentTitle)].includes(key(cleanChapterTitle(head)));
  const isTitle = kind === "heading" || kind === "title" || blocks[first].sectionTitle === true || isLabel || repeatsCurrent;
  if (!isTitle) return none;

  let end = first;
  let title = cleanChapterTitle(head);
  // "CHAPTER 1" on one line and the real title on the next.
  if (title === head && /^(?:chapter|episode|part|section)\s+(?:\d{1,3}|[ivxlcdm]+)\.?$/i.test(head)) {
    const next = blocks.findIndex((block, index) => index > first && textOf(block) !== "");
    if (next >= 0 && next - first <= 2 && textOf(blocks[next]).length <= 120 && String(blocks[next].type || "paragraph") !== "quote") {
      end = next;
      title = textOf(blocks[next]);
    }
  } else if (!title || title === head && kind !== "heading" && !repeatsCurrent && !isLabel) {
    return none;
  }
  const rest = blocks.slice(end + 1);
  const removedText = blocks.slice(first, end + 1).map(textOf).filter(Boolean).join(" — ");
  return { blocks: rest.length ? rest : [{ type: "paragraph", text: "" }], title, removed: true, removedText };
}
