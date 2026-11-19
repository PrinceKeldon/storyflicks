"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ClipboardEvent } from "react";
import type { ImportedManuscriptBlock, ManuscriptRun } from "@/lib/docx-import";

type Block = ImportedManuscriptBlock;
type Props = {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  placeholder?: string;
};

const allowedTags = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "BR", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "SUB", "SUP", "SPAN", "UL", "OL", "LI"]);
const allowedStyles = new Set(["text-align", "text-indent", "margin-left", "margin-right", "margin-top", "margin-bottom", "font-weight", "font-style", "text-decoration", "color", "background-color", "font-size", "font-family", "vertical-align", "font-variant", "text-transform"]);

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function blockStyle(block: Block): CSSProperties {
  return {
    textAlign: block.align,
    textIndent: typeof block.indentFirstLine === "number" ? block.indentFirstLine + "em" : typeof block.indentHanging === "number" ? -block.indentHanging + "em" : typeof block.indent === "number" ? block.indent * 0.75 + "em" : undefined,
    marginLeft: typeof block.indentLeft === "number" ? block.indentLeft + "em" : undefined,
    marginRight: typeof block.indentRight === "number" ? block.indentRight + "em" : undefined,
    marginTop: typeof block.spacingBefore === "number" ? block.spacingBefore + "pt" : undefined,
    marginBottom: typeof block.spacingAfter === "number" ? block.spacingAfter + "pt" : undefined,
    breakBefore: block.pageBreakBefore ? "page" : undefined,
  };
}

function runHtml(run: ManuscriptRun): string {
  let html = escapeHtml(run.text).replace(/\n/g, "<br>");
  if (run.superscript) html = "<sup>" + html + "</sup>";
  if (run.subscript) html = "<sub>" + html + "</sub>";
  if (run.underline) html = "<u>" + html + "</u>";
  if (run.strike) html = "<s>" + html + "</s>";
  if (run.italic) html = "<em>" + html + "</em>";
  if (run.bold) html = "<strong>" + html + "</strong>";
  const f = run.formatting;
  const styles = [
    f?.color ? "color:" + f.color : "",
    f?.highlight ? "background-color:" + f.highlight : "",
    f?.fontSizePt ? "font-size:" + f.fontSizePt + "pt" : "",
    f?.fontFamily ? "font-family:" + f.fontFamily : "",
    f?.smallCaps ? "font-variant:small-caps" : "",
    f?.allCaps ? "text-transform:uppercase" : "",
  ].filter(Boolean).join(";");
  return styles ? '<span style="' + escapeHtml(styles) + '">' + html + "</span>" : html;
}

function blocksToHtml(blocks: Block[]) {
  return blocks.map(block => {
    if (block.type === "separator") return '<p data-block-type="separator">✦</p>';
    if (block.type === "spacer") return '<p data-block-type="spacer"><br></p>';
    const tag = block.type === "heading" ? "h3" : block.type === "quote" ? "blockquote" : "p";
    const content = block.runs?.length ? block.runs.map(runHtml).join("") : escapeHtml(block.text).replace(/\n/g, "<br>");
    const style = Object.entries(blockStyle(block)).filter(([, value]) => value !== undefined).map(([key, value]) => key.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()) + ":" + String(value)).join(";");
    return "<" + tag + (style ? ' style="' + escapeHtml(style) + '"' : "") + ">" + (content || "<br>") + "</" + tag + ">";
  }).join("");
}

function cleanNode(node: Node, target: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return target.createTextNode(node.textContent || "");
  if (!(node instanceof Element)) return null;
  if (!allowedTags.has(node.tagName)) {
    const fragment = target.createDocumentFragment();
    for (const child of Array.from(node.childNodes)) {
      const cleaned = cleanNode(child, target);
      if (cleaned) fragment.appendChild(cleaned);
    }
    return fragment;
  }
  const element = target.createElement(node.tagName.toLowerCase());
  const style = Array.from(node.style).filter(property => allowedStyles.has(property)).map(property => property + ":" + node.style.getPropertyValue(property)).join(";");
  if (style) element.setAttribute("style", style);
  for (const child of Array.from(node.childNodes)) {
    const cleaned = cleanNode(child, target);
    if (cleaned) element.appendChild(cleaned);
  }
  return element;
}

function sanitiseHtml(html: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const safe = document.implementation.createHTMLDocument("");
  const wrapper = safe.createElement("div");
  for (const node of Array.from(parsed.body.childNodes)) {
    const cleaned = cleanNode(node, safe);
    if (cleaned) wrapper.appendChild(cleaned);
  }
  return wrapper.innerHTML;
}

function inlineRuns(node: Node, inherited: Partial<ManuscriptRun> = {}): ManuscriptRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    return text ? [{ text, ...inherited }] : [];
  }
  if (!(node instanceof Element)) return [];
  if (node.tagName === "BR") return [{ text: "\n", ...inherited }];
  const next: Partial<ManuscriptRun> = { ...inherited };
  if (["B", "STRONG"].includes(node.tagName)) next.bold = true;
  if (["I", "EM"].includes(node.tagName)) next.italic = true;
  if (node.tagName === "U") next.underline = true;
  if (["S", "STRIKE"].includes(node.tagName)) next.strike = true;
  if (node.tagName === "SUP") next.superscript = true;
  if (node.tagName === "SUB") next.subscript = true;
  const style = (node as HTMLElement).style;
  if (style.fontWeight === "bold" || Number.parseInt(style.fontWeight, 10) >= 600) next.bold = true;
  if (style.fontStyle === "italic" || style.fontStyle === "oblique") next.italic = true;
  if (style.textDecorationLine.includes("underline")) next.underline = true;
  if (style.textDecorationLine.includes("line-through")) next.strike = true;
  const formatting = {
    ...(style.color ? { color: style.color } : {}),
    ...(style.backgroundColor ? { highlight: style.backgroundColor } : {}),
    ...(style.fontSize ? { fontSizePt: Number.parseFloat(style.fontSize) * (style.fontSize.endsWith("pt") ? 1 : 0.75) } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily.replace(/^['"]|['"]$/g, "") } : {}),
    ...(style.fontVariant === "small-caps" ? { smallCaps: true } : {}),
    ...(style.textTransform === "uppercase" ? { allCaps: true } : {}),
  };
  if (Object.keys(formatting).length) next.formatting = { ...(inherited.formatting || {}), ...formatting };
  return Array.from(node.childNodes).flatMap(child => inlineRuns(child, next));
}

function cssLength(value: string, unit: "em" | "pt"): number | undefined {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)(pt|px|in|cm|mm|pc|em|rem)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor: Record<string, number> = { pt: 1, px: 0.75, in: 72, cm: 28.3464567, mm: 2.83464567, pc: 12, em: 12, rem: 12 };
  const points = amount * factor[match[2].toLowerCase()];
  return unit === "pt" ? points : points / 12;
}

function parseEditor(root: HTMLElement): Block[] {
  const top = Array.from(root.children);
  const nodes = top.length ? top : [root];
  return nodes.flatMap(element => {
    const el = element as HTMLElement;
    const type = el.dataset.blockType === "separator" ? "separator" : el.dataset.blockType === "spacer" ? "spacer" : /^H[1-6]$/.test(el.tagName) ? "heading" : el.tagName === "BLOCKQUOTE" ? "quote" : "paragraph";
    if (type === "separator") return [{ type: "separator", text: "" } as Block];
    if (type === "spacer") return [{ type: "spacer", text: "" } as Block];
    const runs = Array.from(el.childNodes).flatMap(node => inlineRuns(node));
    const text = runs.map(run => run.text).join("");
    const style = el.style;
    const indentFirstLine = cssLength(style.textIndent, "em");
    const indentLeft = cssLength(style.marginLeft, "em");
    const indentRight = cssLength(style.marginRight, "em");
    const spacingBefore = cssLength(style.marginTop, "pt");
    const spacingAfter = cssLength(style.marginBottom, "pt");
    const block: Block = {
      type, text,
      ...(runs.length ? { runs } : {}),
      ...(style.textAlign ? { align: style.textAlign as Block["align"] } : {}),
      ...(indentFirstLine !== undefined && Number.isFinite(indentFirstLine) ? { indentFirstLine } : {}),
      ...(indentLeft !== undefined && Number.isFinite(indentLeft) ? { indentLeft } : {}),
      ...(indentRight !== undefined && Number.isFinite(indentRight) ? { indentRight } : {}),
      ...(spacingBefore !== undefined && Number.isFinite(spacingBefore) ? { spacingBefore } : {}),
      ...(spacingAfter !== undefined && Number.isFinite(spacingAfter) ? { spacingAfter } : {}),
    };
    return text.trim() || type !== "paragraph" ? [block] : [];
  });
}

export default function RichChapterEditor({ blocks, onChange, placeholder = "Paste your complete chapter here…" }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastExternal = useRef("");

  useEffect(() => {
    const html = blocksToHtml(blocks);
    if (lastExternal.current === html) return;
    lastExternal.current = html;
    if (editorRef.current && document.activeElement !== editorRef.current) editorRef.current.innerHTML = html;
  }, [blocks]);

  function update() {
    if (!editorRef.current) return;
    const next = parseEditor(editorRef.current);
    lastExternal.current = editorRef.current.innerHTML;
    onChange(next);
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const clipboard = event.clipboardData;
    const html = clipboard.getData("text/html");
    const plain = clipboard.getData("text/plain");
    const insertion = html ? sanitiseHtml(html) : plain.replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/).map(paragraph => "<p>" + escapeHtml(paragraph).replace(/\n/g, "<br>") + "</p>").join("");
    document.execCommand("insertHTML", false, insertion);
    update();
  }


  return (
    <div
      ref={editorRef}
      className="studio-rich-chapter-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Paste chapter body"
      data-placeholder={placeholder}
      onInput={update}
      onPaste={paste}
      onBlur={update}
    />
  );
}
