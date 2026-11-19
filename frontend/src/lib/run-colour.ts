export type ReaderThemeName = "paper" | "sepia" | "night";

const THEME_BACKGROUND: Record<ReaderThemeName, [number, number, number]> = {
  paper: [239, 233, 219],
  sepia: [232, 216, 186],
  night: [23, 25, 28],
};

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], windowtext: [0, 0, 0], auto: [0, 0, 0],
  gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], red: [255, 0, 0], blue: [0, 0, 255],
};

export function parseColour(value: string | undefined | null): [number, number, number] | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (text in NAMED) return NAMED[text];
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = text.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])].map((n) => Math.min(255, n)) as [number, number, number];
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function isNeutral([r, g, b]: [number, number, number]): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
}

/**
 * Colour to apply to a stored text run, or undefined to inherit the reader theme's own text colour.
 * Neutral colours (black, white, greys, Word's "automatic") are what a word processor writes for ordinary
 * text, so they never override the theme. Deliberate accent colours are kept only when readable (3:1).
 */
export function readableRunColour(value: string | undefined | null, theme: ReaderThemeName): string | undefined {
  const rgb = parseColour(value);
  if (!rgb || !value) return undefined;
  if (isNeutral(rgb)) return undefined;
  return contrastRatio(rgb, THEME_BACKGROUND[theme]) >= 3 ? value : undefined;
}
