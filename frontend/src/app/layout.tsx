import type { Metadata } from "next";
import "./globals.css";
import "./storyflicks-design-system.css";
import "./redesign.css";
import "./redesign-pages.css";
import "./reader-clean.css";
import ThemeProvider from "./theme-provider";
import AuthSessionProvider from "./auth-session-provider";
import { SITE_URL } from "../lib/stories";
import { fontVariables } from "./fonts";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "STORYFLICKS — Stories worth staying for", template: "%s | STORYFLICKS" },
  description: "An entertainment platform that happens to deliver stories.",
  applicationName: "STORYFLICKS",
  openGraph: {
    type: "website",
    siteName: "STORYFLICKS",
    title: "STORYFLICKS — Stories worth staying for",
    description: "An entertainment platform that happens to deliver stories.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "STORYFLICKS" }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={fontVariables} suppressHydrationWarning>
      <body><AuthSessionProvider><ThemeProvider />{children}</AuthSessionProvider></body>
    </html>
  );
}
