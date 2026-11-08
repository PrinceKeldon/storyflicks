"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactionPanel from "../../react/[episodeId]/reaction-panel";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type ContentBlock = { type?: string; text?: string; html?: string; content?: string; level?: number; [key: string]: unknown };
type EpisodeAccessGate = {
  code: string;
  message: string;
  required_action?: string;
  previous_episode?: { id: string; title: string; sequence_number: number };
  locked_episode?: { id: string; title: string; sequence_number: number };
};
type EpisodePayload = {
  story: { id: string; slug: string; title: string };
  episode: { id: string; sequence_number: number; title: string; synopsis?: string | null; content: unknown; assets?: { id: string; asset_type: string; public_url?: string | null; alt_text?: string | null; position: number }[] };
  reading_progress?: { progress_percent?: number; last_position?: { scrollY?: number } | null } | null;
};

function extractBlocks(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed as ContentBlock[];
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { blocks?: unknown }).blocks)) return (parsed as { blocks: ContentBlock[] }).blocks;
    } catch { return content.split(/\n\s*\n/).filter(Boolean).map((text) => ({ type: "paragraph", text })); }
  }
  if (content && typeof content === "object" && Array.isArray((content as { blocks?: unknown }).blocks)) return (content as { blocks: ContentBlock[] }).blocks;
  return [];
}

function blockText(block: ContentBlock) {
  if (typeof block.text === "string") return block.text;
  if (typeof block.content === "string") return block.content;
  if (typeof block.html === "string") return block.html.replace(/<[^>]*>/g, " ");
  return "";
}

export default function ReadingRoom({ slug, episodeId }: { slug: string; episodeId: string }) {
  const [payload, setPayload] = useState<EpisodePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready" | "locked" | "error">("loading");
  const [accessGate, setAccessGate] = useState<EpisodeAccessGate | null>(null);
  const [showContribution, setShowContribution] = useState(false);
  const router = useRouter();
  const [error, setError] = useState("");
  const [theme, setTheme] = useState<"paper" | "sepia" | "night">("paper");
  const [fontScale, setFontScale] = useState(100);
  const [width, setWidth] = useState<"comfortable" | "wide">("comfortable");
  const [progress, setProgress] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgress = useRef<{ scrollY: number; percent: number } | null>(null);
  const preferencesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  const loadEpisode = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl) { setStatus("error"); setError("Reading is not configured yet. Please try again later."); return; }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { setStatus("signed-out"); return; }
    tokenRef.current = session.access_token;
    try {
      const preferencesResponse = await fetch(`${apiUrl}/library/preferences`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      }).catch(() => null);
      if (preferencesResponse?.ok) {
        const preferences = await preferencesResponse.json() as { theme?: "paper" | "sepia" | "night"; text_size?: "small" | "comfortable" | "large"; reading_width?: "narrow" | "standard" | "wide" };
        if (preferences.theme) setTheme(preferences.theme);
        if (preferences.text_size) setFontScale(preferences.text_size === "small" ? 90 : preferences.text_size === "large" ? 115 : 100);
        if (preferences.reading_width) setWidth(preferences.reading_width === "wide" ? "wide" : "comfortable");
      }
      const response = await fetch(`${apiUrl}/episodes/${episodeId}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string | EpisodeAccessGate };
        if (response.status === 403 && body.detail && typeof body.detail === "object" && body.detail.code === "contribution_required") {
          setAccessGate(body.detail);
          setStatus("locked");
          return;
        }
        const detail = body.detail;
        throw new Error(typeof detail === "string" ? detail : detail?.message || "We couldn’t open this episode.");
      }
      const data = await response.json() as EpisodePayload;
      setPayload(data);
      setProgress(data.reading_progress?.progress_percent ?? 0);
      setStatus("ready");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong."); setStatus("error"); }
  }, [apiUrl, episodeId]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      tokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { void loadEpisode(); return () => { if (preferencesTimer.current) clearTimeout(preferencesTimer.current); }; }, [loadEpisode]);

  const flushProgress = useCallback(() => {
    const latest = pendingProgress.current;
    if (!latest || !tokenRef.current || !apiUrl) return;
    pendingProgress.current = null;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    void fetch(`${apiUrl}/episodes/${episodeId}/progress`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ progress_percent: latest.percent, last_position: { scrollY: latest.scrollY } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [apiUrl, episodeId]);

  const saveProgress = useCallback((scrollY: number, percent: number) => {
    if (!tokenRef.current || !apiUrl) return;
    pendingProgress.current = { scrollY, percent };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushProgress();
    }, 900);
  }, [apiUrl, flushProgress]);

  useEffect(() => {
    if (status !== "ready" || !tokenRef.current || !apiUrl) return;
    if (preferencesTimer.current) clearTimeout(preferencesTimer.current);
    preferencesTimer.current = setTimeout(() => {
      const textSize = fontScale <= 95 ? "small" : fontScale >= 110 ? "large" : "comfortable";
      void fetch(`${apiUrl}/library/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ theme, text_size: textSize, reading_width: width === "wide" ? "wide" : "standard" }),
      }).catch(() => undefined);
    }, 700);
    return () => { if (preferencesTimer.current) clearTimeout(preferencesTimer.current); };
  }, [apiUrl, fontScale, status, theme, width]);

  useEffect(() => {
    if (status !== "ready") return;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const next = max > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100))) : 0;
      setProgress(next);
      saveProgress(window.scrollY, next);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("pagehide", flushProgress);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("pagehide", flushProgress);
      document.removeEventListener("visibilitychange", flushWhenHidden);
      flushProgress();
    };
  }, [flushProgress, saveProgress, status]);

  useEffect(() => {
    if (status !== "ready" || !payload?.reading_progress?.last_position?.scrollY) return;
    const y = payload.reading_progress.last_position.scrollY;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [payload, status]);

  const blocks = useMemo(() => extractBlocks(payload?.episode.content), [payload]);

  if (status === "loading") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p>Preparing your reading room…</p></main>;
  if (status === "signed-out") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">YOUR STORY IS WAITING</p><h1>Sign in to enter the Reading Room.</h1><p>Your reading progress and episode access are tied to your account.</p><Link className="primary-button" href={`/sign-in?next=/stories/${slug}/read/${episodeId}`}>Sign in to continue <span>↗</span></Link></main>;
  if (status === "locked" && accessGate?.previous_episode) return (
    <main className="reader-state reader-locked-state">
      <span className="reader-state-mark">SF.</span>
      <p className="eyebrow">ONE MORE STEP</p>
      <h1>One more step to unlock this episode.</h1>
      <p>{accessGate.locked_episode ? <>You’re almost at Episode {String(accessGate.locked_episode.sequence_number).padStart(2, "0")}: <strong>{accessGate.locked_episode.title}</strong>. </> : null}{accessGate.message} Your next step is to share your take on Episode {String(accessGate.previous_episode.sequence_number).padStart(2, "0")}, <strong>{accessGate.previous_episode.title}</strong>. Either a quick reaction or a written review is enough.</p>
      <button type="button" className="primary-button" onClick={() => setShowContribution(true)}>Share your take <span>→</span></button>
      <Link className="text-button" href={`/stories/${slug}/read/${accessGate.previous_episode.id}`}>← Return to Episode {String(accessGate.previous_episode.sequence_number).padStart(2, "0")}</Link>
      {showContribution && <div className="contribution-modal-backdrop" role="presentation">
        <div className="contribution-modal-dialog" role="dialog" aria-modal="true" aria-label="Share your take">
          <ReactionPanel
            slug={slug}
            episodeId={accessGate.previous_episode.id}
            presentation="modal"
            onClose={() => setShowContribution(false)}
            onUnlocked={(nextEpisodeId) => {
              setShowContribution(false);
              router.replace(`/stories/${slug}/read/${nextEpisodeId}`);
            }}
          />
        </div>
      </div>}
    </main>
  );
  if (status === "error" || !payload) return <main className="reader-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">A SMALL INTERRUPTION</p><h1>We couldn’t open this episode.</h1><p>{error}</p><Link className="text-button" href={`/stories/${slug}`}>← Back to {payload?.story.title || "the story"}</Link></main>;

  return (
    <main className={`reading-room theme-${theme}`}>
      <div className="reader-progress-track"><span style={{ width: `${progress}%` }} /></div>
      <header className="reader-toolbar">
        <Link className="reader-brand" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <div className="reader-location"><Link href={`/stories/${slug}`}>{payload.story.title}</Link><span>/</span><span>EPISODE {String(payload.episode.sequence_number).padStart(2, "0")}</span></div>
        <div className="reader-tools">
          <span className="reader-progress-label">{progress}%</span>
          <button className="reader-tool-button" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings}>Aa <span>Reading settings</span></button>
          <Link className="reader-exit" href={`/stories/${slug}`}>Exit</Link>
        </div>
      </header>
      {showSettings && <section className="reader-settings" aria-label="Reading settings">
        <div><span>APPEARANCE</span><div className="setting-options">{(["paper", "sepia", "night"] as const).map((value) => <button key={value} className={theme === value ? "selected" : ""} onClick={() => setTheme(value)}>{value}</button>)}</div></div>
        <div><span>TEXT SIZE</span><div className="setting-options"><button onClick={() => setFontScale((v) => Math.max(85, v - 5))}>A−</button><strong>{fontScale}%</strong><button onClick={() => setFontScale((v) => Math.min(130, v + 5))}>A+</button></div></div>
        <div><span>READING WIDTH</span><div className="setting-options"><button className={width === "comfortable" ? "selected" : ""} onClick={() => setWidth("comfortable")}>Comfortable</button><button className={width === "wide" ? "selected" : ""} onClick={() => setWidth("wide")}>Wide</button></div></div>
      </section>}
      <article className={`reading-page reading-width-${width}`}>
        <div className="reading-kicker">{payload.story.title} <span>·</span> EPISODE {String(payload.episode.sequence_number).padStart(2, "0")}</div>
        <h1>{payload.episode.title}</h1>
        {payload.episode.synopsis && <p className="reading-deck">{payload.episode.synopsis}</p>}
        <div className="reading-rule"><span>✦</span></div>
        <div className="manuscript" style={{ fontSize: `${fontScale}%` }}>
          {blocks.map((block, index) => {
            const text = blockText(block);
            const kind = String(block.type || "paragraph").toLowerCase();
            if (!text) return null;
            if (kind.includes("heading") || kind === "title") return <h2 key={index}>{text}</h2>;
            if (kind.includes("quote")) return <blockquote key={index}>{text}</blockquote>;
            if (kind.includes("separator") || kind === "divider" || kind === "scene_break") return <div className="manuscript-divider" key={index}>✦</div>;
            if (kind === "dialogue") return <p className="manuscript-dialogue" key={index}>{text}</p>;
            if (kind === "emphasis") return <p className="manuscript-emphasis" key={index}>{text}</p>;
            return <p className="manuscript-paragraph" key={index}>{text}</p>;
          })}
        </div>
        {payload.episode.assets?.filter((asset) => asset.public_url).map((asset) => <figure className="reading-asset" key={asset.id}><img src={asset.public_url!} alt={asset.alt_text || "Story illustration"} /></figure>)}
        <footer className="reading-end">
          <span>END OF EPISODE {String(payload.episode.sequence_number).padStart(2, "0")}</span>
          <h2>Let that one settle.</h2>
          <p>Take a moment to react or write a review. Either one unlocks what comes next.</p>
          <button type="button" className="primary-button" onClick={() => setShowContribution(true)}>Share your take <span>→</span></button>
        </footer>
      </article>
      <footer className="reader-footer"><span>STORYFLICKS</span><span>Stories worth staying for.</span><span>© 2026</span></footer>
      {showContribution && <div className="contribution-modal-backdrop" role="presentation">
        <div className="contribution-modal-dialog" role="dialog" aria-modal="true" aria-label="Share your take">
          <ReactionPanel
            slug={slug}
            episodeId={payload.episode.id}
            presentation="modal"
            onClose={() => setShowContribution(false)}
            onUnlocked={(nextEpisodeId) => {
              setShowContribution(false);
              router.replace(`/stories/${slug}/read/${nextEpisodeId}`);
            }}
          />
        </div>
      </div>}
    </main>
  );
}
