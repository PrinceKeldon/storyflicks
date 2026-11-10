"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

type RunFormatting = { color?: string; highlight?: string; fontSizePt?: number; fontFamily?: string; smallCaps?: boolean; allCaps?: boolean };
type ContentRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; superscript?: boolean; subscript?: boolean; formatting?: RunFormatting };
type Block = {
  type?: string;
  text?: string;
  content?: string;
  bold?: boolean;
  italic?: boolean;
  indent?: number;
  indentLeft?: number;
  indentRight?: number;
  indentFirstLine?: number;
  indentHanging?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  lineSpacingMode?: "auto" | "exact" | "atLeast";
  align?: "left" | "center" | "right" | "justify";
  pageBreakBefore?: boolean;
  sectionTitle?: boolean;
  runs?: ContentRun[];
};
type Payload = {
  story: { title: string; slug: string };
  material: { title: string; section_type: string; placement: string; content: unknown };
};

function blocksOf(value: unknown): Block[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { return value.split(/\r?\n/).map((text) => ({ type: "paragraph", text })); }
  }
  if (Array.isArray(parsed)) return parsed as Block[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { blocks?: unknown }).blocks)) {
    return (parsed as { blocks: Block[] }).blocks;
  }
  return [];
}

function blockText(block: Block) {
  if (typeof block.text === "string") return block.text;
  if (typeof block.content === "string") return block.content;
  return "";
}

function renderRuns(block: Block): ReactNode {
  if (!block.runs?.length) {
    const text = blockText(block);
    return block.bold && block.italic ? <strong><em>{text}</em></strong> : block.bold ? <strong>{text}</strong> : block.italic ? <em>{text}</em> : text;
  }
  return block.runs.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.superscript) node = <sup>{node}</sup>;
    if (run.subscript) node = <sub>{node}</sub>;
    if (run.underline) node = <u>{node}</u>;
    if (run.strike) node = <s>{node}</s>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    const formatting = run.formatting;
    return <span key={index} style={{
      color: formatting?.color,
      backgroundColor: formatting?.highlight?.toLowerCase(),
      fontSize: typeof formatting?.fontSizePt === "number" ? formatting.fontSizePt + "pt" : undefined,
      fontFamily: formatting?.fontFamily,
      fontVariant: formatting?.smallCaps ? "small-caps" : undefined,
      textTransform: formatting?.allCaps ? "uppercase" : undefined,
    }}>{node}</span>;
  });
}

function manuscriptBlockStyle(block: Block) {
  const legacyIndent = typeof block.indent === "number" ? block.indent * 0.75 : 0;
  return {
    marginLeft: typeof block.indentLeft === "number" ? block.indentLeft + "em" : undefined,
    marginRight: typeof block.indentRight === "number" ? block.indentRight + "em" : undefined,
    textIndent: typeof block.indentFirstLine === "number" ? block.indentFirstLine + "em" : typeof block.indentHanging === "number" ? "-" + block.indentHanging + "em" : legacyIndent ? legacyIndent + "em" : undefined,
    textAlign: block.align,
    marginTop: typeof block.spacingBefore === "number" ? block.spacingBefore + "pt" : undefined,
    marginBottom: typeof block.spacingAfter === "number" ? block.spacingAfter + "pt" : undefined,
    lineHeight: 1.6,
    breakBefore: block.pageBreakBefore ? "page" as const : undefined,
  };
}

export default function MaterialReadingRoom({ slug, materialId }: { slug: string; materialId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!api) { setError("Reading is not configured."); setLoading(false); return; }
    fetch(api + "/stories/" + encodeURIComponent(slug) + "/materials/" + encodeURIComponent(materialId), { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || "This section is unavailable.");
        setData(body as Payload);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not open this section."))
      .finally(() => setLoading(false));
  }, [slug, materialId]);

  if (loading) return <main className="reader-state"><span className="reader-state-mark">SF.</span><p>Preparing your reading room…</p></main>;
  if (error || !data) return <main className="reader-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">A SMALL INTERRUPTION</p><h1>This section isn’t available.</h1><p>{error}</p><Link className="text-button" href={"/stories/" + slug}>← Back to the story</Link></main>;

  const blocks = blocksOf(data.material.content);
  const sourceTitleIndex = blocks.findIndex((block) => block.sectionTitle === true);
  const sourceTitleBlock = sourceTitleIndex >= 0 ? blocks[sourceTitleIndex] : undefined;
  const sourceTitleRuns = sourceTitleBlock?.runs || [];
  const sourceTitleRunFormat = sourceTitleRuns[0]?.formatting;
  const leadingBlocks = sourceTitleIndex > 0 ? blocks.slice(0, sourceTitleIndex) : [];

  return (
    <main className="reading-room theme-paper">
      <header className="reader-toolbar">
        <Link className="reader-brand" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <div className="reader-location"><Link href={"/stories/" + slug}>{data.story.title}</Link><span>/</span><span>{data.material.section_type.replace(/_/g, " ").toUpperCase()}</span></div>
        <Link className="reader-exit" href={"/stories/" + slug}>Back to story</Link>
      </header>
      <article className="reading-page reading-width-comfortable">
        <div className="reading-kicker">{data.story.title} <span>·</span> {data.material.section_type.replace(/_/g, " ").toUpperCase()}</div>
        {leadingBlocks.length > 0 && <div className="manuscript">{leadingBlocks.map((block, index) => <p key={"leading-" + index} style={manuscriptBlockStyle(block)}>{renderRuns(block)}</p>)}</div>}
        <h1 style={{
          ...manuscriptBlockStyle(sourceTitleBlock || {}),
          fontWeight: sourceTitleBlock?.bold || (sourceTitleRuns.length > 0 && sourceTitleRuns.every((run) => run.bold)) ? 700 : undefined,
          fontStyle: sourceTitleBlock?.italic || (sourceTitleRuns.length > 0 && sourceTitleRuns.every((run) => run.italic)) ? "italic" : undefined,
          textAlign: sourceTitleBlock?.align || "left",
          fontFamily: sourceTitleRunFormat?.fontFamily,
          fontSize: typeof sourceTitleRunFormat?.fontSizePt === "number" ? sourceTitleRunFormat.fontSizePt + "pt" : undefined,
          color: sourceTitleRunFormat?.color,
        }}>{data.material.title}</h1>
        <div className="reading-rule"><span>✦</span></div>
        <div className="manuscript">
          {blocks.map((block, index) => {
            const text = blockText(block);
            const kind = String(block.type || "paragraph").toLowerCase();
            if (sourceTitleIndex >= 0 && index <= sourceTitleIndex) return null;
            if (kind === "spacer") return <div className="manuscript-spacer" key={index} />;
            if (kind.includes("separator") || kind === "divider" || kind === "scene_break") return <div className="manuscript-divider" key={index}>✦</div>;
            if (!text && kind !== "paragraph") return null;
            const style = manuscriptBlockStyle(block);
            if (kind.includes("heading") || kind === "title") return <h2 key={index} style={style}>{renderRuns(block)}</h2>;
            if (kind.includes("quote")) return <blockquote key={index} style={style}>{renderRuns(block)}</blockquote>;
            return <p key={index} style={style}>{renderRuns(block)}</p>;
          })}
        </div>
        <div className="reading-rule"><span>✦</span></div>
        <Link className="text-button" href={"/stories/" + slug}>← Return to {data.story.title}</Link>
      </article>
    </main>
  );
}
