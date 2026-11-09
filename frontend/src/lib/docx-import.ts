export type ManuscriptRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; superscript?: boolean; subscript?: boolean; formatting?: { color?: string; highlight?: string; fontSizePt?: number; fontFamily?: string; smallCaps?: boolean; allCaps?: boolean }; sourceFormatting?: { runPropertiesXml?: string; runStyleXmls?: string[] } };
export type ImportedManuscriptBlock = {
  type: "paragraph" | "heading" | "quote" | "separator" | "spacer";
  text: string;
  runs?: ManuscriptRun[];
  indent?: number;
  indentLeft?: number;
  indentFirstLine?: number;
  indentHanging?: number;
  align?: "left" | "center" | "right" | "justify";
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  lineSpacingMode?: "auto" | "exact" | "atLeast";
  bold?: boolean;
  italic?: boolean;
  outlineLevel?: number;
  styleId?: string;
  sectionTitle?: boolean;
  indentRight?: number;
  keepNext?: boolean;
  keepLines?: boolean;
  widowControl?: boolean;
  pageBreakBefore?: boolean;
  sectionBreak?: boolean;
  sourceFormatting?: { paragraphPropertiesXml?: string; paragraphStyleXml?: string[]; documentDefaultsXml?: string };
};

function readU16(view: DataView, offset: number) { return view.getUint16(offset, true); }
function readU32(view: DataView, offset: number) { return view.getUint32(offset, true); }

async function unzipEntry(buffer: ArrayBuffer, targetName: string): Promise<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (readU32(view, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("This Word document is not a valid DOCX archive.");
  const entries = readU16(view, end + 10);
  const directoryOffset = readU32(view, end + 16);
  let cursor = directoryOffset;
  const decoder = new TextDecoder();
  for (let i = 0; i < entries; i++) {
    if (readU32(view, cursor) !== 0x02014b50) break;
    const method = readU16(view, cursor + 10);
    const compressedSize = readU32(view, cursor + 20);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localOffset = readU32(view, cursor + 42);
    const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (name === targetName) {
      if (readU32(view, localOffset) !== 0x04034b50) throw new Error("The Word document contains an invalid file entry.");
      const localNameLength = readU16(view, localOffset + 26);
      const localExtraLength = readU16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8) throw new Error("This DOCX uses an unsupported compression method.");
      if (typeof DecompressionStream === "undefined") throw new Error("Your browser cannot decompress this Word document. Please export it as .txt.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error("The Word document does not contain its main manuscript.");
}

function child(parent: Element | null, name: string): Element | null {
  if (!parent) return null;
  return Array.from(parent.children).find((node) => node.localName === name) || null;
}
function descendants(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS("*", name));
}
function onOffNode(node: Element | null): boolean | undefined {
  if (!node) return undefined;
  const value = node.getAttribute("val");
  return value === "0" || value === "false" || value === "none" || value === "nil" ? false : true;
}
function onOff(parent: Element | null, name: string): boolean | undefined {
  return onOffNode(child(parent, name));
}
function twips(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 20 : undefined;
}

export async function importDocx(file: File): Promise<ImportedManuscriptBlock[]> {
  const xmlBytes = await unzipEntry(await file.arrayBuffer(), "word/document.xml");
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBytes), "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("The Word document contains unreadable XML.");
  const body = descendants(xml.documentElement, "body")[0];
  if (!body) throw new Error("The Word document has no manuscript body.");
  let stylesRoot: Element | null = null;
  try {
    const stylesBytes = await unzipEntry(await file.arrayBuffer(), "word/styles.xml");
    const stylesXml = new DOMParser().parseFromString(new TextDecoder().decode(stylesBytes), "application/xml");
    if (!stylesXml.getElementsByTagName("parsererror").length) stylesRoot = stylesXml.documentElement;
  } catch { /* Word documents may omit a styles part. */ }
  const docDefaults = stylesRoot ? child(stylesRoot, "docDefaults") : null;
  const defaultParagraphProperties = child(child(docDefaults, "pPrDefault"), "pPr");
  const defaultRunProperties = child(child(docDefaults, "rPrDefault"), "rPr");
  const defaultProperty = (property: string, group: "pPr" | "rPr") => child(group === "pPr" ? defaultParagraphProperties : defaultRunProperties, property);
  const styleById = new Map<string, Element>();
  if (stylesRoot) for (const style of descendants(stylesRoot, "style")) {
    const id = style.getAttribute("styleId");
    if (id) styleById.set(id, style);
  }
  const styleChain = (id: string | null): Element[] => {
    const chain: Element[] = [];
    let current = id || "";
    for (let depth = 0; current && depth < 8; depth++) {
      const style = styleById.get(current);
      if (!style) break;
      chain.push(style);
      current = child(style, "basedOn")?.getAttribute("val") || "";
    }
    return chain;
  };
  const inheritedProperty = (chain: Element[], property: string, group: "pPr" | "rPr") => {
    for (const style of chain) {
      const value = child(child(style, group), property);
      if (value) return value;
    }
    return null;
  };
  const paragraphs = Array.from(body.children).filter((node) => node.localName === "p");
  const blocks: ImportedManuscriptBlock[] = [];
  let documentDefaultsAttached = false;
  for (const paragraph of paragraphs) {
    const pPr = child(paragraph, "pPr");
    const pStyleId = child(pPr, "pStyle")?.getAttribute("val") || "";
    const pStyle = pStyleId.toLowerCase();
    const pStyleChain = styleChain(pStyleId);
    const alignmentNode = child(pPr, "jc") || inheritedProperty(pStyleChain, "jc", "pPr") || defaultProperty("jc", "pPr");
    const alignment = alignmentNode?.getAttribute("val");
    const ind = child(pPr, "ind") || inheritedProperty(pStyleChain, "ind", "pPr") || defaultProperty("ind", "pPr");
    const left = twips(ind?.getAttribute("left") || ind?.getAttribute("start") || null);
    const firstLine = twips(ind?.getAttribute("firstLine") || null);
    const hanging = twips(ind?.getAttribute("hanging") || null);
    const right = twips(ind?.getAttribute("right") || ind?.getAttribute("end") || null);
    const spacing = child(pPr, "spacing") || inheritedProperty(pStyleChain, "spacing", "pPr") || defaultProperty("spacing", "pPr");
    const before = twips(spacing?.getAttribute("before") || null);
    const after = twips(spacing?.getAttribute("after") || null);
    const lineRaw = spacing?.getAttribute("line");
    const lineRule = spacing?.getAttribute("lineRule");
    const lineSpacing = lineRaw ? (lineRule === "auto" || !lineRule ? Number(lineRaw) / 240 : Number(lineRaw) / 20) : undefined;
    const runs: ManuscriptRun[] = [];
    for (const run of descendants(paragraph, "r")) {
      const rPr = child(run, "rPr");
      let text = "";
      for (const node of Array.from(run.children)) {
        if (node.localName === "t" || node.localName === "delText") text += node.textContent || "";
        else if (node.localName === "tab") text += "\t";
        else if (node.localName === "br" || node.localName === "cr") text += "\n";
      }
      if (!text) continue;
      const runValue: ManuscriptRun = { text };
      const runStyleId = child(rPr, "rStyle")?.getAttribute("val") || "";
      const runStyleChain = styleChain(runStyleId);
      const runStyleXmls = runStyleChain.map((style) => new XMLSerializer().serializeToString(style));
      if (rPr || runStyleXmls.length) runValue.sourceFormatting = {
        ...(rPr ? { runPropertiesXml: new XMLSerializer().serializeToString(rPr) } : {}),
        ...(runStyleXmls.length ? { runStyleXmls } : {}),
      };
      const property = (name: string) => child(rPr, name) || inheritedProperty(runStyleChain, name, "rPr") || inheritedProperty(pStyleChain, name, "rPr") || defaultProperty(name, "rPr");
      const color = property("color")?.getAttribute("val");
      const highlight = property("highlight")?.getAttribute("val");
      const sizeRaw = property("sz")?.getAttribute("val");
      const fonts = property("rFonts");
      const fontFamily = fonts?.getAttribute("ascii") || fonts?.getAttribute("hAnsi") || fonts?.getAttribute("eastAsia");
      const smallCaps = onOff(rPr, "smallCaps") ?? onOffNode(inheritedProperty(runStyleChain, "smallCaps", "rPr")) ?? onOffNode(inheritedProperty(pStyleChain, "smallCaps", "rPr")) ?? onOffNode(defaultProperty("smallCaps", "rPr"));
      const allCaps = onOff(rPr, "caps") ?? onOffNode(inheritedProperty(runStyleChain, "caps", "rPr")) ?? onOffNode(inheritedProperty(pStyleChain, "caps", "rPr")) ?? onOffNode(defaultProperty("caps", "rPr"));
      if (color || highlight || sizeRaw || fontFamily || smallCaps !== undefined || allCaps !== undefined) runValue.formatting = {
        ...(color && color !== "auto" ? { color: "#" + color.replace(/^#/, "") } : {}),
        ...(highlight && highlight !== "none" ? { highlight } : {}),
        ...(sizeRaw && Number.isFinite(Number(sizeRaw)) ? { fontSizePt: Number(sizeRaw) / 2 } : {}),
        ...(fontFamily ? { fontFamily } : {}),
        ...(smallCaps ? { smallCaps: true } : {}),
        ...(allCaps ? { allCaps: true } : {}),
      };
      for (const [key, tag] of [["bold", "b"], ["italic", "i"], ["underline", "u"], ["strike", "strike"]] as const) {
        const direct = onOff(rPr, tag);
        const runStyleProperty = inheritedProperty(runStyleChain, tag, "rPr");
        const paragraphStyleProperty = inheritedProperty(pStyleChain, tag, "rPr");
        const inherited = runStyleProperty ? onOffNode(runStyleProperty) : paragraphStyleProperty ? onOffNode(paragraphStyleProperty) : onOffNode(defaultProperty(tag, "rPr"));
        const flag = direct !== undefined ? direct : inherited;
        if (flag !== undefined) runValue[key] = flag;
      }
      const vertical = (child(rPr, "vertAlign") || inheritedProperty(runStyleChain, "vertAlign", "rPr") || inheritedProperty(pStyleChain, "vertAlign", "rPr"))?.getAttribute("val");
      if (vertical === "superscript") runValue.superscript = true;
      if (vertical === "subscript") runValue.subscript = true;
      runs.push(runValue);
    }
    const text = runs.map((run) => run.text).join("");
    const pageBreakBefore = !!child(pPr, "pageBreakBefore");
    const sectionBreak = !!child(pPr, "sectPr");
    const isSectionBreak = sectionBreak;
    const outlineNode = child(pPr, "outlineLvl") || inheritedProperty(pStyleChain, "outlineLvl", "pPr");
    const outlineLevelRaw = outlineNode?.getAttribute("val");
    const outlineLevel = outlineLevelRaw !== null && outlineLevelRaw !== undefined ? Number(outlineLevelRaw) : undefined;
    const isHeading = /^heading[1-6]$/.test(pStyle) || pStyle === "title" || pStyle === "subtitle" || (outlineLevel !== undefined && Number.isFinite(outlineLevel) && outlineLevel <= 5);
    const visibleRuns = runs.filter((run) => run.text.trim().length > 0);
    const allRunsBold = visibleRuns.length > 0 && visibleRuns.every((run) => run.bold === true);
    const isQuote = pStyle.includes("quote") || pStyle.includes("intensequote");
    const includeDocumentDefaults = !!docDefaults && !documentDefaultsAttached;
    const block: ImportedManuscriptBlock = {
      type: isSectionBreak ? "separator" : isHeading ? "heading" : isQuote ? "quote" : "paragraph",
      text,
      ...(runs.length ? { runs } : {}),
      ...(pStyleId ? { styleId: pStyleId } : {}),
      ...(outlineLevel !== undefined && Number.isFinite(outlineLevel) ? { outlineLevel } : {}),
      ...(allRunsBold ? { bold: true } : {}),
      ...(left !== undefined ? { indentLeft: left / 12 } : {}),
      ...(firstLine !== undefined ? { indentFirstLine: firstLine / 12 } : {}),
      ...(hanging !== undefined ? { indentHanging: hanging / 12 } : {}),
      ...(right !== undefined ? { indentRight: right / 12 } : {}),
      ...(pageBreakBefore ? { pageBreakBefore: true } : {}),
      ...(sectionBreak ? { sectionBreak: true } : {}),
      ...(onOff(pPr, "keepNext") !== undefined ? { keepNext: onOff(pPr, "keepNext") } : {}),
      ...(onOff(pPr, "keepLines") !== undefined ? { keepLines: onOff(pPr, "keepLines") } : {}),
      ...(onOff(pPr, "widowControl") !== undefined ? { widowControl: onOff(pPr, "widowControl") } : {}),
      ...(left === undefined && firstLine !== undefined ? { indent: firstLine / 36 } : {}),
      ...(alignment === "left" || alignment === "center" || alignment === "right" || alignment === "both" ? { align: alignment === "both" ? "justify" : alignment } : {}),
      ...(before !== undefined ? { spacingBefore: before } : {}),
      ...(after !== undefined ? { spacingAfter: after } : {}),
      ...(lineSpacing !== undefined && Number.isFinite(lineSpacing) ? { lineSpacing, lineSpacingMode: lineRule === "exact" ? "exact" as const : lineRule === "atLeast" ? "atLeast" as const : "auto" as const } : {}),
      ...(pPr || pStyleChain.length || includeDocumentDefaults ? { sourceFormatting: {
        ...(pPr ? { paragraphPropertiesXml: new XMLSerializer().serializeToString(pPr) } : {}),
        ...(pStyleChain.length ? { paragraphStyleXml: pStyleChain.map((style) => new XMLSerializer().serializeToString(style)) } : {}),
        ...(includeDocumentDefaults ? { documentDefaultsXml: new XMLSerializer().serializeToString(docDefaults!) } : {}),
      } } : {}),
    };
    blocks.push(block);
    if (includeDocumentDefaults) documentDefaultsAttached = true;
  }
  if (!blocks.length) throw new Error("No paragraphs were found in this Word document.");
  return blocks;
}
