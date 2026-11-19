// Public story data shared by the story page, its metadata, the sitemap and the share card.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://storyflicks.live").replace(/\/$/, "");

export type Episode = {
  id: string;
  sequence_number: number;
  title: string;
  synopsis?: string | null;
  publication_status: string;
  image_url?: string | null;
  image_alt?: string | null;
  published_at?: string | null;
};

export type StoryResponse = {
  story: {
    id: string;
    slug: string;
    title: string;
    author_name?: string | null;
    section_label?: string | null;
    section_label_plural?: string | null;
    tagline?: string | null;
    synopsis?: string | null;
    genres?: string[];
    completion_status?: string | null;
    origin_type?: "storyflicks_original" | "previously_published" | "independent" | null;
    content_format?: "standalone" | "series" | null;
    first_episode_free?: boolean;
    cover_url?: string | null;
    published_at?: string | null;
    updated_at?: string | null;
  };
  episodes: Episode[];
  materials?: {id:string;title:string;section_type:string;placement:"front_matter"|"back_matter";position:number}[];
};

export function apiBase(): string | null {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  return apiUrl ? apiUrl.replace(/\/$/, "") : null;
}

// Identical fetches made while rendering one request (the page and its metadata)
// are de-duplicated by Next.js, so the API is only called once per request.
export async function getStory(slug: string): Promise<StoryResponse | null> {
  const base = apiBase();
  if (!base) throw new Error("The STORYFLICKS API is not configured.");

  try {
    const response = await fetch(`${base}/stories/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Story request failed (${response.status}).`);
    return (await response.json()) as StoryResponse;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("The story service is temporarily unavailable.");
  }
}

/** Collapse whitespace and cut at a word boundary, for meta descriptions. */
export function shortText(value: string | null | undefined, max = 155): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 80)).replace(/[\s,.;:!-]+$/, "") + "…";
}

/** Small stable hash so a changed story gets a new share-card URL (social sites cache hard). */
export function cardVersion(...parts: (string | null | undefined)[]): string {
  let hash = 5381;
  for (const char of parts.map(part => part || "").join("|")) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
