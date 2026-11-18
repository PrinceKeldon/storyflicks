import localFont from "next/font/local";

// Self-hosted (latin subset) so pages no longer wait on fonts.googleapis.com.
// Each font exposes a CSS variable that layout.tsx puts on <html>.
// next/font requires literal options, so the files are listed out in full.
export const dmSans = localFont({
  variable: "--font-dm-sans",
  display: "swap",
  src: [
    { path: "./fonts/dm-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/dm-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/dm-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const dmMono = localFont({
  variable: "--font-dm-mono",
  display: "swap",
  src: [
    { path: "./fonts/dm-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

export const playfair = localFont({
  variable: "--font-playfair",
  display: "swap",
  src: [
    { path: "./fonts/playfair-display-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/playfair-display-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/playfair-display-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/playfair-display-latin-500-italic.woff2", weight: "500", style: "italic" },
    { path: "./fonts/playfair-display-latin-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

// Reader typeface options: only downloaded when a reader picks them.
export const sourceSerif = localFont({
  variable: "--font-source-serif",
  display: "swap",
  preload: false,
  src: [
    { path: "./fonts/source-serif-4-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/source-serif-4-latin-400-italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/source-serif-4-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/source-serif-4-latin-600-italic.woff2", weight: "600", style: "italic" },
  ],
});

export const atkinson = localFont({
  variable: "--font-atkinson",
  display: "swap",
  preload: false,
  src: [
    { path: "./fonts/atkinson-hyperlegible-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/atkinson-hyperlegible-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const fontVariables = [dmSans, dmMono, playfair, sourceSerif, atkinson].map(font => font.variable).join(" ");
