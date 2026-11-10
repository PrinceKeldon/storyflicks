import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | STORYFLICKS",
  description: "Terms for using STORYFLICKS as a reader or creator.",
};

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <Link className="legal-back" href="/">← Discover</Link>
      </header>
      <article className="legal-document">
        <p className="eyebrow">PLATFORM RULES</p>
        <h1>Terms of Service</h1>
        <p className="legal-updated">Last updated: 10 November 2026</p>
        <p>
          These Terms govern your use of STORYFLICKS, an online platform for discovering and
          reading episodic stories and, for approved creators, publishing and managing story
          content. By creating an account or using account-only features, you agree to these Terms.
          If you do not agree, do not create an account or use those features.
        </p>

        <h2>1. Operator and contact</h2>
        <p>
          STORYFLICKS is operated by Francis Koine, Schleusenstr 50, 15569 Woltersdorf, Germany.
          Contact: <a href="mailto:exec@frankkoine.com">exec@frankkoine.com</a>.
          Further provider information is available on the <Link href="/impressum">Impressum</Link>.
        </p>

        <h2>2. Accounts</h2>
        <p>
          You must provide an email address that you control and keep your sign-in credentials
          secure. You are responsible for activity carried out through your account, except where
          applicable law provides otherwise. You must not impersonate another person, misuse
          another user's account or attempt to bypass access controls. Some creator features are
          available only to accounts that have been granted creator access.
        </p>

        <h2>3. Reading and platform availability</h2>
        <p>
          Reading published stories is currently offered without a subscription fee. We may add,
          change, suspend or discontinue features as the platform develops. We aim to keep the
          service available and content accessible, but do not guarantee uninterrupted or
          error-free operation. We may carry out maintenance, security updates and emergency
          interventions.
        </p>

        <h2>4. Creator content and intellectual property</h2>
        <p>
          You retain ownership of the stories, manuscripts, episodes, artwork and other material
          that you create or upload. You are responsible for ensuring that you own or have permission
          to use everything you submit, including text, images, covers and third-party material.
        </p>
        <p>
          When you submit content, you grant STORYFLICKS a non-exclusive, worldwide, royalty-free
          licence, for as long as the content is hosted, to store, reproduce, technically process,
          display and make that content available through the platform in accordance with the
          visibility settings and publishing actions you choose. This includes the right to use
          hosting and infrastructure providers to perform those operations. This licence is limited
          to operating, maintaining, securing and presenting STORYFLICKS; it does not transfer
          ownership of your work to the operator.
        </p>
        <p>
          You decide whether to publish or keep creator material in draft, subject to platform
          controls and applicable law. Do not submit confidential material to a feature or storage
          area that is intended for public display. If you use an AI-assisted manuscript feature,
          the relevant text and instructions may be sent to the external AI provider to perform the
          requested operation.
        </p>

        <h2>5. Reviews, feedback and community conduct</h2>
        <p>
          You may submit reviews, reactions, reports and other reader contributions where those
          features are available. Public reviews may be displayed to other users with your platform
          profile name. Private feedback is not intended to appear as a public review. You must not
          submit unlawful, defamatory, threatening, harassing, discriminatory, deceptive, spam or
          infringing material, or disclose another person's private information without a lawful
          basis.
        </p>

        <h2>6. Moderation and content removal</h2>
        <p>
          We may review reports and take proportionate action where we reasonably believe content or
          account activity breaches these Terms, infringes rights, creates a security risk or is
          unlawful. Actions may include restricting visibility, removing content, suspending
          features or disabling an account. Where appropriate, we will provide an explanation and
          an opportunity to contact us about the decision. Nothing in these Terms limits rights or
          remedies that cannot lawfully be excluded.
        </p>

        <h2>7. Reader support and payments</h2>
        <p>
          The platform code currently provides a reader-support checkout configured for Stripe
          test mode. It is not currently intended to accept real customer payments. Do not treat a
          test checkout as a real purchase or payment. If real payments, paid features or
          subscriptions are introduced, the applicable prices, payment conditions, consumer
          information and any withdrawal rights will be presented before those transactions are
          enabled, and these Terms will be updated.
        </p>

        <h2>8. Account closure</h2>
        <p>
          You may stop using STORYFLICKS at any time. To request account deletion, email
          <a href="mailto:exec@frankkoine.com?subject=STORYFLICKS%20account%20deletion"> exec@frankkoine.com</a>.
          There is currently no automatic in-app account-deletion control. We will assess the
          request and delete or anonymise personal data where required, subject to legal retention
          duties, the rights of other people and other lawful grounds for retaining particular
          records. Creator works, public reviews and payment records may need separate treatment;
          we will not promise that every item is erased where the law requires or permits retention.
        </p>

        <h2>9. Third-party services and links</h2>
        <p>
          STORYFLICKS relies on third-party infrastructure and may link to external websites or
          services. Their terms and privacy notices apply to their own services. We are not
          responsible for third-party services that we do not operate, subject to applicable law.
        </p>

        <h2>10. Liability</h2>
        <p>
          We are liable without limitation for intent and gross negligence, for injury to life,
          body or health, and where liability is mandatory under applicable law, including
          applicable product-liability rules. In cases of slight negligence, liability for breach
          of an essential contractual obligation is limited to the foreseeable damage typical for
          this type of contract. Any further limitation applies only to the extent permitted by
          mandatory law. These Terms do not restrict statutory consumer rights.
        </p>

        <h2>11. Changes to the Terms</h2>
        <p>
          We may update these Terms where the platform or legal requirements change. Material
          changes will be communicated by an appropriate notice. The current version and its
          update date will be available on this page. If you do not agree to a change, you may stop
          using the affected account features and contact us about closing your account.
        </p>

        <h2>12. Applicable law</h2>
        <p>
          German law applies, subject to any mandatory consumer-protection provisions that apply
          in your country of residence. Nothing in these Terms removes rights that consumers
          cannot waive under applicable law.
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
