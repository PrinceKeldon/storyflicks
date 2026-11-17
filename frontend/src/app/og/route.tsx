import { renderShareCard } from "../../lib/share-card";

// Default link-preview card for the site and for pages without their own.
export async function GET() {
  return renderShareCard();
}
