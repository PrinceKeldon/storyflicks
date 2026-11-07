import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STORYFLICKS — Stories worth staying for",
  description: "An entertainment platform that happens to deliver stories.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}