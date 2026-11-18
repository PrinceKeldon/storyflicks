import type { Metadata } from "next";
import ReadingRoom from "./reading-room";
import { getSupabaseServerClient } from "../../../../../lib/supabase-server";
import { cardVersion, getStory, shortText } from "../../../../../lib/stories";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; episodeId: string }> }): Promise<Metadata> {
  const { slug, episodeId } = await params;
  try {
    const result = await getStory(slug);
    if (!result) return { title: "Episode not found", robots: { index: false, follow: true } };
    const episode = result.episodes.find((item) => item.id === episodeId);
    if (!episode) return { title: "Episode not found", robots: { index: false, follow: true } };
    const title = `${episode.title} | ${result.story.title}`;
    const description = shortText(episode.synopsis || result.story.tagline || result.story.synopsis) || `${episode.title} from ${result.story.title} on STORYFLICKS.`;
    const card = `/stories/${encodeURIComponent(slug)}/og?episode=${encodeURIComponent(episodeId)}&v=${cardVersion(result.story.title, episode.title, episode.synopsis, result.story.cover_url)}`;
    return {
      title,
      description,
      alternates: { canonical: `/stories/${encodeURIComponent(slug)}/read/${encodeURIComponent(episodeId)}` },
      robots: { index: false, follow: true },
      openGraph: { type: "article", siteName: "STORYFLICKS", title, description, url: `/stories/${encodeURIComponent(slug)}/read/${encodeURIComponent(episodeId)}`, images: [{ url: card, width: 1200, height: 630, alt: `${episode.title} from ${result.story.title}` }], ...(result.story.author_name ? { authors: [result.story.author_name] } : {}) },
      twitter: { card: "summary_large_image", title, description, images: [card] },
    };
  } catch {
    return { title: "Episode temporarily unavailable", robots: { index: false, follow: false } };
  }
}

export const dynamic = "force-dynamic";

type EpisodeAccessGate = {
  code: string;
  section_label?: string;
  section_label_plural?: string;
  message: string;
  required_action?: string;
  previous_episode?: { id: string; title: string; sequence_number: number };
  locked_episode?: { id: string; title: string; sequence_number: number };
};

export default async function ReadingPage({ params }: { params: Promise<{ slug: string; episodeId: string }> }) {
  const { slug, episodeId } = await params;
  const supabase = await getSupabaseServerClient();
  if (!supabase) {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="error" initialError="Reading is not configured yet. Please try again later." />;
  }

  const { data: verified, error: userError } = await supabase.auth.getUser();
  if (userError || !verified.user) {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="signed-out" />;
  }

  const { data: session } = await supabase.auth.getSession();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (!session.session?.access_token || !apiUrl) {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="signed-out" />;
  }

  const headers = { Authorization: `Bearer ${session.session.access_token}` };
  let episodeResponse: Response;
  let preferencesResponse: Response | null;
  try {
    [episodeResponse, preferencesResponse] = await Promise.all([
      fetch(`${apiUrl}/episodes/${encodeURIComponent(episodeId)}`, { headers, cache: "no-store" }),
      fetch(`${apiUrl}/library/preferences`, { headers, cache: "no-store" }).catch(() => null),
    ]);
  } catch {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="error" initialError="We couldn’t reach the Reading Room service. Please try again." />;
  }

  let preferences: { theme?: "paper" | "sepia" | "night"; text_size?: "small" | "comfortable" | "large"; reading_width?: "narrow" | "standard" | "wide" } | null = null;
  if (preferencesResponse?.ok) {
    preferences = await preferencesResponse.json().catch(() => null);
  }

  if (episodeResponse.status === 401) {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="signed-out" />;
  }
  if (episodeResponse.status === 403) {
    const body = await episodeResponse.json().catch(() => ({})) as { detail?: string | EpisodeAccessGate };
    const detail = body.detail;
    if (detail && typeof detail === "object" && detail.code === "contribution_required") {
      return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="locked" initialAccessGate={detail} initialPreferences={preferences} />;
    }
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="error" initialError={typeof detail === "string" ? detail : detail?.message || "You do not have access to this section."} />;
  }
  if (!episodeResponse.ok) {
    return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="error" initialError="We couldn’t open this section. Please try again." />;
  }

  const payload = await episodeResponse.json();
  return <ReadingRoom slug={slug} episodeId={episodeId} initialStatus="ready" initialPayload={payload} initialPreferences={preferences} />;
}
