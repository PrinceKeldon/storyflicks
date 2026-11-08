import Link from "next/link";

export default function SupportSuccessPage() {
  return (
    <main className="library-state support-success">
      <span className="reader-state-mark">SF.</span>
      <p className="eyebrow">A LITTLE KINDNESS GOES A LONG WAY</p>
      <h1>Thank you for the support<span>.</span></h1>
      <p>Your contribution helps independent stories find their way into the world. We’re grateful you chose to support the work.</p>
      <p className="support-success-note">Your payment confirmation is handled securely by Stripe. Your reading access remains free.</p>
      <Link className="primary-button" href="/">Back to the stories <span>↗</span></Link>
    </main>
  );
}
