"use client";

import { useMemo, useRef, useState } from "react";
import { importDocx, type ImportedManuscriptBlock } from "@/lib/docx-import";

type Block = ImportedManuscriptBlock;
type ExistingEpisode = {
  id: string;
  sequence_number: number;
  title: string;
  publication_status: string;
  latest_revision?: { revision_status: string } | null;
};
type Section = {
  id: string;
  title: string;
  blocks: Block[];
  targetEpisodeId: string;
  include: boolean;
  saved: boolean;
};
type Props = {
  storyId: string;
  storyTitle: string;
  episodes: ExistingEpisode[];
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onImported: () => Promise<void>;
};
type Stage = "upload" | "review" | "complete";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const chapterPattern = /^(?:(?:chapter|episode|part|section|book)\s+(?:\d{1,3}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)(?:\s*[:.\-–—]?\s*.*)?|\d{1,3}[.)]\s+.+|(?:prologue|epilogue|foreword|preface|introduction|afterword|acknowledgements|acknowledgments))$/i;

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function wordCount(blocks: Block[]) {
  return blocks.reduce((count, block) => count + (block.text.trim().match(/\S+/g)?.length || 0), 0);
}
function normaliseTitle(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/^(chapter|episode|part|section|book)\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[:.\-–—]?\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function isChapterBoundary(block: Block) {
  const value = block.text.trim();
  return value.length > 0 && value.length < 150 && (block.type === "heading" || chapterPattern.test(value) || /^[ivxlcdm]{1,8}[.)]?$/i.test(value));
}
function titleFromHeading(value: string) {
  const trimmed = value.trim();
  const stripped = trimmed.replace(/^(?:(?:chapter|episode|part|section|book)\s+(?:\d{1,3}|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s*[:.\-–—]?\s*/i, "").replace(/^\d{1,3}[.)]\s*/, "");
  return stripped || trimmed;
}
function detectSections(blocks: Block[]): Section[] {
  const boundaries = blocks.map((block, index) => isChapterBoundary(block) ? index : -1).filter(index => index >= 0);
  if (!boundaries.length) return [{ id: makeId(), title: "Complete manuscript", blocks, targetEpisodeId: "", include: true, saved: false }];
  const starts = [...boundaries];
  if (boundaries[0] > 0 && wordCount(blocks.slice(0, boundaries[0])) > 0) starts.unshift(0);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? blocks.length;
    const isHeadingStart = boundaries.includes(start);
    const heading = isHeadingStart ? blocks[start].text.trim() : "";
    const bodyStart = isHeadingStart ? start + 1 : start;
    const body = blocks.slice(bodyStart, end);
    return {
      id: makeId(),
      title: isHeadingStart ? titleFromHeading(heading) : "Opening material",
      blocks: body.length ? body : [{ type: "paragraph", text: "" }],
      targetEpisodeId: "",
      include: true,
      saved: false,
    };
  });
}
function blockPreview(block: Block, index: number) {
  if (block.type === "separator") return <div key={index} className="sf-manuscript-preview-break">Scene / section break</div>;
  if (block.type === "spacer") return <div key={index} className="sf-manuscript-preview-space" />;
  const Tag = block.type === "heading" ? "h4" : block.type === "quote" ? "blockquote" : "p";
  return <Tag key={index} className={"sf-manuscript-preview-block" + (block.indent ? " is-indented" : "")} style={{ textAlign: block.align || "left", marginLeft: block.indentLeft ? block.indentLeft * 4 : undefined, textIndent: block.indentFirstLine ? block.indentFirstLine * 4 : block.indent ? block.indent * 8 : undefined }}>
    {block.runs?.length ? block.runs.map((run, runIndex) => <span key={runIndex} style={{ fontWeight: run.bold ? 700 : undefined, fontStyle: run.italic ? "italic" : undefined, textDecoration: [run.underline ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined }}>{run.text}</span>) : block.text}
  </Tag>;
}

export default function ManuscriptImportAssistant({ storyId, storyTitle, episodes, request, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("upload");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [sections, setSections] = useState<Section[]>([]);
  const [analysis, setAnalysis] = useState<{ paragraphs: number; words: number; headings: number; formattedRuns: number; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [showAllBlocks, setShowAllBlocks] = useState(false);
  const orderedEpisodes = useMemo(() => [...episodes].sort((a, b) => a.sequence_number - b.sequence_number), [episodes]);
  const included = sections.filter(section => section.include);
  const duplicateTargets = included.filter((section, index) => section.targetEpisodeId && included.findIndex(other => other.targetEpisodeId === section.targetEpisodeId) !== index).map(section => section.targetEpisodeId);
  const canImport = included.length > 0 && included.every(section => section.title.trim() && wordCount(section.blocks) > 0) && duplicateTargets.length === 0 && !busy;

  async function analyseFile(file: File) {
    setError(""); setNotice("");
    if (!/\.(docx|txt)$/i.test(file.name)) { setError("Choose a DOCX or TXT manuscript."); return; }
    if (file.size > MAX_FILE_BYTES) { setError("This manuscript is larger than the 30 MB import limit. Please split or compress the file and try again."); return; }
    if (!file.size) { setError("The selected manuscript is empty."); return; }
    setBusy(true);
    try {
      let blocks: Block[];
      if (/\.docx$/i.test(file.name)) blocks = await importDocx(file);
      else {
        const raw = (await file.text()).replace(/\r\n?/g, "\n");
        const lines = raw.split("\n");
        blocks = [];
        let paragraphLines: string[] = [];
        let paragraphIndent = 0;
        const flushParagraph = () => {
          if (!paragraphLines.length) return;
          blocks.push({ type: "paragraph" as const, text: paragraphLines.join("\n").replace(/[\t ]+$/, ""), ...(paragraphIndent ? { indent: paragraphIndent } : {}) });
          paragraphLines = [];
          paragraphIndent = 0;
        };
        for (const line of lines) {
          if (!line.trim()) {
            flushParagraph();
            blocks.push({ type: "spacer" as const, text: "" });
          } else {
            if (!paragraphLines.length) {
              const leading = line.match(/^[\t ]+/)?.[0] || "";
              paragraphIndent = Math.min(8, Math.floor([...leading].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0) / 2));
            }
            paragraphLines.push(line.replace(/^[\t ]+/, ""));
          }
        }
        flushParagraph();
      }
      if (!blocks.length || wordCount(blocks) === 0) throw new Error("No readable paragraphs were found in this file.");
      const detected = detectSections(blocks);
      const headings = blocks.filter(isChapterBoundary).length;
      const formattedRuns = blocks.reduce((sum, block) => sum + (block.runs?.filter(run => run.bold || run.italic || run.underline || run.strike).length || 0), 0);
      const warnings: string[] = [];
      if (!headings) warnings.push("No clear chapter headings were detected. The manuscript is kept as one section until you split it manually.");
      else if (headings === 1) warnings.push("Only one chapter heading was detected. Check whether additional chapter headings need to be added by splitting sections manually.");
      if (detected.some(section => wordCount(section.blocks) < 40)) warnings.push("One or more detected sections are very short. Check whether a subheading was mistaken for a chapter boundary.");
      if (blocks.filter(block => block.type === "spacer").length > blocks.length * 0.2) warnings.push("The document contains many blank paragraphs. Review spacing before importing.");
      setSections(detected);
      setAnalysis({ paragraphs: blocks.length, words: wordCount(blocks), headings, formattedRuns, warnings });
      setFileName(file.name); setFileSize(file.size); setStage("review");
      setNotice("Analysis complete. Review the chapter boundaries and destinations before saving anything.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manuscript could not be analysed.");
    } finally { setBusy(false); }
  }

  function updateSection(id: string, patch: Partial<Section>) {
    setSections(current => current.map(section => section.id === id ? { ...section, ...patch } : section));
  }
  function splitSection(sectionId: string, blockIndex: number) {
    setSections(current => {
      const index = current.findIndex(section => section.id === sectionId);
      if (index < 0) return current;
      const source = current[index];
      if (blockIndex <= 0 || blockIndex >= source.blocks.length) return current;
      const first = { ...source, blocks: source.blocks.slice(0, blockIndex) };
      const second: Section = { id: makeId(), title: "New chapter", blocks: source.blocks.slice(blockIndex), targetEpisodeId: "", include: true, saved: false };
      const next = [...current]; next.splice(index, 1, first, second); return next;
    });
    setExpandedId("");
  }
  function mergeIntoPrevious(sectionId: string) {
    setSections(current => {
      const index = current.findIndex(section => section.id === sectionId);
      if (index <= 0) return current;
      const previous = current[index - 1], currentSection = current[index];
      const next = [...current];
      next[index - 1] = { ...previous, blocks: [...previous.blocks, ...currentSection.blocks] };
      next.splice(index, 1);
      return next;
    });
  }
  async function importSections() {
    if (!canImport) return;
    setBusy(true); setError(""); setNotice("");
    const savedIds = new Set(sections.filter(section => section.saved).map(section => section.id));
    try {
      let nextSequence = Math.max(0, ...orderedEpisodes.map(episode => episode.sequence_number)) + 1;
      for (const section of sections) {
        if (!section.include || savedIds.has(section.id)) continue;
        const existing = section.targetEpisodeId ? orderedEpisodes.find(episode => episode.id === section.targetEpisodeId) : undefined;
        const path = existing ? "/creator/stories/" + storyId + "/episodes/" + existing.id : "/creator/stories/" + storyId + "/episodes";
        await request(path, { method: existing ? "PUT" : "POST", body: JSON.stringify({
          season_id: null,
          sequence_number: existing?.sequence_number ?? nextSequence++,
          title: section.title.trim(),
          synopsis: null,
          content: { blocks: section.blocks.filter(block => block.type === "separator" || block.type === "spacer" || block.text.trim()) },
        }) });
        savedIds.add(section.id);
        setSections(current => current.map(item => item.id === section.id ? { ...item, saved: true } : item));
      }
      const revised = included.filter(section => !!section.targetEpisodeId).length;
      const added = included.length - revised;
      setStage("complete");
      setNotice("Import complete: " + added + " new draft " + (added === 1 ? "section" : "sections") + " and " + revised + " draft " + (revised === 1 ? "revision" : "revisions") + " saved. Nothing was published.");
      await onImported();
    } catch (caught) {
      const completed = savedIds.size;
      setError((caught instanceof Error ? caught.message : "The import was interrupted.") + " " + completed + " section(s) were confirmed saved. Completed rows are marked; do not retry an uncertain network failure until you refresh the workspace and check the story.");
    } finally { setBusy(false); }
  }

  return <section className="sf-manuscript-assistant" aria-labelledby="sf-manuscript-title">
    <div className="sf-manuscript-assistant-head">
      <div><span className="studio-import-eyebrow">CREATOR STUDIO / MANUSCRIPT WORKFLOW</span><h3 id="sf-manuscript-title">Manuscript Import Assistant</h3><p>Prepare <strong>{storyTitle}</strong> from one complete manuscript. Nothing is saved until you confirm the import.</p></div>
      <span className="sf-manuscript-safe">DRAFTS ONLY</span>
    </div>
    <div className="sf-manuscript-steps" aria-label="Import stages">
      {(["upload", "review", "complete"] as Stage[]).map((item, index) => <div key={item} className={"sf-manuscript-step" + (stage === item ? " active" : (["upload", "review", "complete"].indexOf(stage) > index ? " done" : ""))}><span>{index + 1}</span>{item === "upload" ? "Upload & analyse" : item === "review" ? "Review & reconcile" : "Import summary"}</div>)}
    </div>
    {error && <p className="studio-alert" role="alert">{error}</p>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    {stage === "upload" && <div className="sf-manuscript-upload">
      <div className="sf-manuscript-upload-copy"><strong>Start with your complete book</strong><p>Upload a DOCX or TXT file. STORYFLICKS will inspect its structure, detect likely chapter headings and preserve supported paragraph and character formatting from DOCX.</p><ul><li>DOCX: headings, paragraph breaks, indentation, alignment, spacing, bold and italics where available.</li><li>TXT: paragraph breaks and leading indentation.</li><li>Maximum file size: 30 MB. Your file is analysed in this browser and is not stored as a separate manuscript asset.</li></ul></div>
      <input ref={inputRef} type="file" accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void analyseFile(file); event.currentTarget.value = ""; }} />
      <button type="button" className="studio-primary" disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Analysing manuscript…" : "＋ Choose manuscript"}</button>
    </div>}
    {stage === "review" && analysis && <div className="sf-manuscript-review">
      <div className="sf-manuscript-file"><div><strong>{fileName}</strong><small>{(fileSize / (1024 * 1024)).toFixed(2)} MB · {analysis.words.toLocaleString("en-GB")} words · {analysis.paragraphs.toLocaleString("en-GB")} paragraphs</small></div><button type="button" className="studio-text-action" disabled={busy} onClick={() => { setStage("upload"); setSections([]); setAnalysis(null); setError(""); setNotice(""); }}>Choose another file</button></div>
      <div className="sf-manuscript-metrics"><div><strong>{sections.length}</strong><span>Sections prepared</span></div><div><strong>{analysis.headings}</strong><span>Heading candidates</span></div><div><strong>{analysis.formattedRuns}</strong><span>Formatted text runs</span></div></div>
      {analysis.warnings.length > 0 && <div className="sf-manuscript-warnings"><strong>Review notes</strong>{analysis.warnings.map((warning, index) => <p key={index}>• {warning}</p>)}</div>}
      <div className="sf-manuscript-reconcile-intro"><div><h4>Review chapter structure</h4><p>Rename, split or merge sections. Then choose whether each one becomes a new draft or a draft revision of an existing section.</p></div></div>
      <div className="sf-manuscript-section-list">
        {sections.map((section, index) => {
          const expanded = expandedId === section.id;
          const words = wordCount(section.blocks);
          const suggested = orderedEpisodes.find(episode => normaliseTitle(episode.title) === normaliseTitle(section.title));
          return <article className={"sf-manuscript-section" + (section.saved ? " saved" : "")} key={section.id}>
            <div className="sf-manuscript-section-top">
              <label className="sf-manuscript-include"><input type="checkbox" checked={section.include} disabled={section.saved} onChange={event => updateSection(section.id, { include: event.target.checked })}/><span>{String(index + 1).padStart(2, "0")}</span></label>
              <div className="sf-manuscript-section-main"><label>Section title<input value={section.title} disabled={section.saved} onChange={event => updateSection(section.id, { title: event.target.value })}/></label><small>{words.toLocaleString("en-GB")} words · {section.blocks.length} content blocks {section.saved ? "· SAVED" : ""}</small></div>
              <button type="button" className="studio-text-action" onClick={() => setExpandedId(expanded ? "" : section.id)}>{expanded ? "Hide preview" : "Preview & edit split"}</button>
            </div>
            <div className="sf-manuscript-destination"><label>Import destination<select value={section.targetEpisodeId || "new"} disabled={section.saved} onChange={event => updateSection(section.id, { targetEpisodeId: event.target.value === "new" ? "" : event.target.value })}><option value="new">Create a new draft section</option>{orderedEpisodes.map(episode => <option key={episode.id} value={episode.id}>{episode.sequence_number}. {episode.title} · {episode.publication_status}</option>)}</select></label>{suggested && !section.targetEpisodeId && <small>Possible title match: {suggested.title}. It will remain untouched unless you select it.</small>}{section.targetEpisodeId && <small>This will create a draft revision. The published version remains unchanged.</small>}</div>
            {duplicateTargets.includes(section.targetEpisodeId) && section.targetEpisodeId && <p className="sf-manuscript-inline-warning">Two manuscript sections cannot be mapped to the same existing section.</p>}
            {expanded && <div className="sf-manuscript-preview"><div className="sf-manuscript-preview-heading"><strong>Content preview</strong><span>{Math.min(section.blocks.length, 80)} of {section.blocks.length} blocks shown</span></div>{section.blocks.slice(0, showAllBlocks ? section.blocks.length : 80).map(blockPreview)}{section.blocks.length > 80 && <button type="button" className="studio-text-action" onClick={() => setShowAllBlocks(value => !value)}>{showAllBlocks ? "Show first 80 blocks" : "Show all " + section.blocks.length + " blocks"}</button>}
              {section.blocks.length > 1 && <div className="sf-manuscript-split-tools"><span>Need to correct a chapter boundary?</span>{section.blocks.slice(1, showAllBlocks ? section.blocks.length : 80).map((block, blockIndex) => <button type="button" key={blockIndex + 1} onClick={() => splitSection(section.id, blockIndex + 1)}>Split before: {(block.text || block.type).slice(0, 42)}{(block.text || "").length > 42 ? "…" : ""}</button>)}</div>}
              {index > 0 && <button type="button" className="studio-text-action" onClick={() => mergeIntoPrevious(section.id)}>Merge into previous section</button>}
            </div>}
          </article>;
        })}
      </div>
      <div className="sf-manuscript-final-check"><strong>Before import</strong><p>{included.length} selected section(s). {included.filter(section => !section.targetEpisodeId).length} will be new drafts; {included.filter(section => !!section.targetEpisodeId).length} will become draft revisions.</p><p>Existing sections are only changed where you explicitly choose them. Published editions remain published and unchanged. No content is published or scheduled.</p></div>
      <div className="studio-form-actions"><button type="button" className="studio-primary" disabled={!canImport} onClick={() => void importSections()}>{busy ? "Importing drafts…" : "Confirm & import drafts ↗"}</button><button type="button" className="studio-text-action" disabled={busy} onClick={() => { setStage("upload"); setSections([]); setAnalysis(null); setNotice(""); setError(""); }}>Cancel import</button></div>
    </div>}
    {stage === "complete" && <div className="sf-manuscript-complete"><strong>Your manuscript sections are in Creator Studio.</strong><p>They have been saved as drafts. Review each section in the Section Manager before publishing anything.</p><button type="button" className="studio-primary" onClick={() => { setStage("upload"); setSections([]); setAnalysis(null); setNotice(""); setError(""); setFileName(""); }}>Import another manuscript</button></div>}
  </section>;
}
