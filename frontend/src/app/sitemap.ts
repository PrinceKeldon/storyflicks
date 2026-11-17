import type { MetadataRoute } from "next";
import { SITE_URL, apiBase } from "../lib/stories";

export const revalidate = 3600;

type CatalogueItem = { slug?: string; published_at?: string | null; updated_at?: string | null };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/search`, changeFrequency: "daily", priority: 0.6 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/impressum`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const base = apiBase();
  if (!base) return entries;
  try {
    const response = await fetch(`${base}/stories`, { next: { revalidate: 3600 } });
    if (!response.ok) return entries;
    const data = await response.json();
    for (const item of (Array.isArray(data.items) ? data.items : []) as CatalogueItem[]) {
      if (!item.slug) continue;
      const modified = item.updated_at || item.published_at;
      entries.push({
        url: `${SITE_URL}/stories/${encodeURIComponent(item.slug)}`,
        ...(modified && !Number.isNaN(Date.parse(modified)) ? { lastModified: new Date(modified) } : {}),
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // The catalogue is unreachable: serve the static pages rather than failing the whole sitemap.
  }
  return entries;
}
