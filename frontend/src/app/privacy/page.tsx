import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | STORYFLICKS",
  description: "How STORYFLICKS collects and uses personal data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <Link className="legal-back" href="/">← Discover</Link>
      </header>
      <article className="legal-document">
        <p className="eyebrow">YOUR DATA AND YOUR RIGHTS</p>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: 10 November 2026</p>
        <p>
          This Privacy Policy explains how STORYFLICKS processes personal data when you visit the
          website, create an account, read stories, take part in reader discussions or use Creator
          Studio. It is intended to describe the platform as currently implemented. Features and
          service providers may change; this notice will be updated when our processing changes.
        </p>

        <h2>1. Who is responsible for your data?</h2>
        <p>
          The controller is Francis Koine, operating STORYFLICKS as an individual.
        </p>
        <p>
          Schleusenstr 50, 15569 Woltersdorf, Germany<br />
          Email: <a href="mailto:exec@frankkoine.com">exec@frankkoine.com</a>
        </p>
        <p>
          You can use this email address to contact the controller about privacy questions or to
          exercise your data-protection rights.
        </p>

        <h2>2. Personal data we process</h2>
        <ul>
          <li><strong>Account and authentication data:</strong> email address, account identifier, authentication status and account-related settings.</li>
          <li><strong>Reader activity:</strong> reading progress, saved stories and bookmarks, reactions, review-room activity and notification preferences.</li>
          <li><strong>Community contributions:</strong> public reviews, private feedback, author replies, reports and information needed to moderate reported content. Public reviews may be displayed with your platform profile name; private feedback is not displayed as a public review.</li>
          <li><strong>Creator content:</strong> creator profile details, story and episode metadata, manuscripts, revisions, notes, uploaded covers and other materials you submit to Creator Studio.</li>
          <li><strong>Support checkout information:</strong> checkout-session identifiers, contribution amount and currency, story and account references, payment status and payment-intent identifiers. Card details are handled by Stripe, not stored by STORYFLICKS.</li>
          <li><strong>Technical and security information:</strong> information that may be present in hosting, infrastructure and security logs, such as IP address, request time, browser/device information and error details.</li>
        </ul>

        <h2>3. Why we use personal data and our legal bases</h2>
        <ul>
          <li><strong>To create and operate accounts</strong>, authenticate users and provide reading, library and Creator Studio features. Legal basis: performance of a contract or steps requested before entering a contract (GDPR Article 6(1)(b)).</li>
          <li><strong>To save reading progress, bookmarks, reactions, reviews and creator submissions</strong> and make public content available as requested. Legal basis: Article 6(1)(b), and where appropriate our legitimate interests in operating a community publishing platform (Article 6(1)(f)).</li>
          <li><strong>To protect the service, prevent abuse, investigate reports and maintain security</strong>. Legal basis: our legitimate interests in protecting users, content and the platform (Article 6(1)(f)).</li>
          <li><strong>To process support checkout and maintain payment records</strong>. Legal basis, where applicable, includes performance of the requested transaction (Article 6(1)(b)) and compliance with legal obligations (Article 6(1)(c)).</li>
          <li><strong>To comply with legal obligations and establish, exercise or defend legal claims</strong>. Legal basis: Article 6(1)(c) or Article 6(1)(f), as applicable.</li>
        </ul>

        <h2>4. Service providers and recipients</h2>
        <p>
          STORYFLICKS uses specialist providers to host and operate the platform. Depending on the
          feature used, relevant data may be processed by:
        </p>
        <ul>
          <li><strong>Supabase:</strong> account authentication, database services and file storage.</li>
          <li><strong>Vercel:</strong> hosting and delivery of the website frontend.</li>
          <li><strong>Render:</strong> hosting of the application API and related backend processes.</li>
          <li><strong>Stripe:</strong> hosted checkout and payment processing for reader support. The production integration is currently configured for Stripe test mode; it is not intended to collect real customer payments at this time.</li>
          <li><strong>Google Fonts:</strong> delivery of typefaces used by the website. When the browser requests these fonts, Google may receive technical connection data such as your IP address.</li>
          <li><strong>Google Gemini API:</strong> when a creator actively uses the manuscript-analysis or AI-assisted editing feature, the relevant text and instructions are sent to Google&apos;s AI service to provide the requested result.</li>
        </ul>
        <p>
          These providers process data under their own applicable privacy terms and, where they act
          as processors, the relevant contractual data-processing arrangements. Data may also be
          disclosed where required by law or where necessary to protect the rights and security of
          users or the platform.
        </p>

        <h2>5. International data transfers</h2>
        <p>
          Some service providers or their subprocessors may process data outside the European
          Economic Area, depending on their infrastructure and configuration. Where a transfer is
          subject to GDPR Chapter V, it must rely on an applicable transfer mechanism, such as an
          adequacy decision or appropriate safeguards (for example, Standard Contractual Clauses).
          You can contact us for further information about the safeguards applicable to a particular
          transfer.
        </p>

        <h2>6. Public content and storage</h2>
        <p>
          Stories, episodes, public reviews, creator notes and artwork that you choose to publish
          may be visible to visitors and readers. STORYFLICKS uses a public-read storage area for
          assets intended for public display. Do not upload confidential or private material to a
          public story asset or publish content unless you have the necessary rights and intend it
          to be public. Private feedback is treated separately from public reviews.
        </p>

        <h2>7. Browser storage and cookies</h2>
        <p>
          The website uses browser storage needed for core functionality. Supabase authentication
          keeps the signed-in session in browser storage so that you remain signed in, and
          STORYFLICKS stores your light/dark theme preference in local storage. These functions
          support features you request. The inspected frontend does not currently include an
          advertising or analytics SDK. Third-party font requests are described above.
        </p>

        <h2>8. How long we keep data</h2>
        <p>
          We keep personal data only for as long as reasonably necessary for the purposes described
          in this notice. Account and activity data are generally retained while the account is
          active and until a valid deletion request is completed, subject to technical backup
          cycles and legal exceptions. Published content may remain visible while it is lawfully
          hosted or where continued retention is justified by the rights of others or another legal
          basis. Payment and accounting records may have to be retained for statutory periods.
          Security and infrastructure logs are retained according to the relevant provider&apos;s
          operational and security retention settings.
        </p>

        <h2>9. Your data-protection rights</h2>
        <p>
          Subject to the conditions and exceptions in the GDPR, you may request access, correction,
          erasure, restriction of processing and data portability. You may also object to processing
          based on legitimate interests. Where processing is based on consent, you may withdraw
          consent at any time without affecting processing carried out before withdrawal.
        </p>
        <p>
          To make a request, email <a href="mailto:exec@frankkoine.com?subject=STORYFLICKS%20privacy%20request">exec@frankkoine.com</a>.
          We may ask for information reasonably necessary to verify your identity. The GDPR right
          to erasure is not absolute: some information may need to be retained to comply with law
          or to establish, exercise or defend legal claims.
        </p>
        <p>
          STORYFLICKS does not currently provide an automatic in-app account-deletion control.
          Account deletion and other rights requests must therefore be submitted by email for
          manual handling.
        </p>
        <p>
          You also have the right to lodge a complaint with a supervisory authority. In Brandenburg,
          the competent authority is:
        </p>
        <p>
          Die Landesbeauftragte für den Datenschutz und für das Recht auf Akteneinsicht Brandenburg<br />
          Stahnsdorfer Damm 77, 14532 Kleinmachnow, Germany<br />
          <a href="https://www.lda.brandenburg.de/" target="_blank" rel="noreferrer">www.lda.brandenburg.de</a>
        </p>

        <h2>10. Security</h2>
        <p>
          We use technical and organisational measures intended to protect personal data, including
          access controls and provider security features. No internet transmission or storage system
          can be guaranteed to be completely secure.
        </p>

        <h2>11. Changes to this notice</h2>
        <p>
          We may update this Privacy Policy when the platform, its providers or applicable legal
          requirements change. The current version and its update date will be published on this page.
        </p>
      </article>
      <footer className="legal-footer">
        <span>© 2026 STORYFLICKS</span>
        <nav aria-label="Legal pages">
          <Link href="/impressum">Impressum</Link>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
        </nav>
      </footer>
    </main>
  );
}
