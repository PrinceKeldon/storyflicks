import type { Metadata } from "next";
import "./globals.css";
import ThemeSwitch from "./theme-switch";

export const metadata: Metadata = {
  title: "STORYFLICKS — Stories worth staying for",
  description: "An entertainment platform that happens to deliver stories.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}<ThemeSwitch /></body>
    </html>
  );
}