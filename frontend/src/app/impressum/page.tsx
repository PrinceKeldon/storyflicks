import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Impressum | STORYFLICKS",
  description: "Legal provider information for STORYFLICKS.",
};

export default function ImpressumPage() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <Link className="legal-back" href="/">← Discover</Link>
      </header>
      <article className="legal-document">
        <p className="eyebrow">LEGAL INFORMATION</p>
        <h1>Impressum</h1>
        <p><strong>Angaben gemäß § 5 Digitale-Dienste-Gesetz (DDG)</strong></p>

        <h2>Diensteanbieter</h2>
        <p>
          Francis Koine<br />
          Schleusenstr 50<br />
          15569 Woltersdorf<br />
          Deutschland
        </p>

        <h2>Kontakt</h2>
        <p>
          E-Mail: <a href="mailto:exec@frankkoine.com">exec@frankkoine.com</a>
        </p>

        <p>
          STORYFLICKS wird von Francis Koine als Einzelperson betrieben.
        </p>
      </article>
      <footer className="legal-footer">
        <span>© 2026 STORYFLICKS</span>
        <nav aria-label="Legal pages">
          <Link href="/impressum">Impressum</Link>
          <Link href="/privacy">Datenschutz / Privacy</Link>
          <Link href="/terms">Nutzungsbedingungen / Terms</Link>
        </nav>
      </footer>
    </main>
  );
}
