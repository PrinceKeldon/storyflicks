import Link from "next/link";

export default function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="Legal information">
      <Link href="/impressum">Impressum</Link>
      <Link href="/privacy">Privacy Policy</Link>
      <Link href="/terms">Terms of Service</Link>
    </nav>
  );
}
