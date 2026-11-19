"use client";

import RemoteImage from "@/components/remote-image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactionPanel from "../../react/[episodeId]/reaction-panel";
import SupportStoryButton from "../../support-story-button";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent, type TouchEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type ContentRun = {text:string;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;superscript?:boolean;subscript?:boolean;formatting?:{color?:string;highlight?:string;fontSizePt?:number;fontFamily?:string;smallCaps?:boolean;allCaps?:boolean}};
type ContentBlock = { type?: string; text?: string; html?: string; content?: string; level?: number; indent?: number; indentLeft?:number; indentRight?:number; indentFirstLine?:number; indentHanging?:number; align?: "left"|"center"|"right"|"justify"; italic?: boolean; bold?: boolean; sectionTitle?:boolean; runs?:ContentRun[]; spacingBefore?:number; spacingAfter?:number; lineSpacing?:number; lineSpacingMode?:"auto"|"exact"|"atLeast"; [key: string]: unknown };
type EpisodeAccessGate = {
  code: string;
  section_label?: string;
  section_label_plural?: string;
  message: string;
  required_action?: string;
  previous_episode?: { id: string; title: string; sequence_number: number };
  locked_episode?: { id: string; title: string; sequence_number: number };
};
type EpisodePayload = {
  sample?: boolean;
  story: { id: string; slug: string; title: string; section_label?: string; section_label_plural?: string };
  episode: { id: string; sequence_number: number; title: string; synopsis?: string | null; content: unknown; assets?: { id: string; asset_type: string; public_url?: string | null; alt_text?: string | null; position: number }[] };
  next_episode?: { id: string; title: string; sequence_number: number } | null;
  previous_episode?: { id: string; title: string; sequence_number: number } | null;
  reading_progress?: { progress_percent?: number; last_position?: { scrollY?: number; page?: number } | null } | null;
};

function extractBlocks(content: unknown): ContentBlock[] {
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") {
    try {
      const parsed: unknown = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed as ContentBlock[];
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as { blocks?: unknown }).blocks)) return (parsed as { blocks: ContentBlock[] }).blocks;
    } catch { return content.split(/\r?\n/).map((text) => ({ type: "paragraph", text })); }
  }
  if (content && typeof content === "object" && Array.isArray((content as { blocks?: unknown }).blocks)) return (content as { blocks: ContentBlock[] }).blocks;
  return [];
}

function renderRuns(block: ContentBlock) {
  if (!Array.isArray(block.runs) || !block.runs.length) {
    const text = blockText(block);
    const content = block.bold && block.italic ? <strong><em>{text}</em></strong> : block.bold ? <strong>{text}</strong> : block.italic ? <em>{text}</em> : text;
    return content;
  }
  return block.runs.map((run, index) => {
    let node: ReactNode = run.text;
    if (run.superscript) node = <sup>{node}</sup>;
    if (run.subscript) node = <sub>{node}</sub>;
    if (run.underline) node = <u>{node}</u>;
    if (run.strike) node = <s>{node}</s>;
    if (run.italic) node = <em>{node}</em>;
    if (run.bold) node = <strong>{node}</strong>;
    const formatting = run.formatting;
    return <span key={index} style={{
      color: formatting?.color,
      backgroundColor: formatting?.highlight?.toLowerCase(),
      fontSize: typeof formatting?.fontSizePt === "number" ? formatting.fontSizePt + "pt" : undefined,
      fontFamily: formatting?.fontFamily,
      fontVariant: formatting?.smallCaps ? "small-caps" : undefined,
      textTransform: formatting?.allCaps ? "uppercase" : undefined,
    }}>{node}</span>;
  });
}

function blockText(block: ContentBlock) {
  if (typeof block.text === "string") return block.text;
  if (typeof block.content === "string") return block.content;
  if (typeof block.html === "string") return block.html.replace(/<[^>]*>/g, " ");
  return "";
}

function manuscriptBlockStyle(block: ContentBlock) {
  const legacyIndent = typeof block.indent === "number" ? block.indent * 0.75 : 0;
  return {
    marginLeft: typeof block.indentLeft === "number" ? String(block.indentLeft) + "em" : undefined,
    marginRight: typeof block.indentRight === "number" ? String(block.indentRight) + "em" : undefined,
    textIndent: typeof block.indentFirstLine === "number" ? String(block.indentFirstLine) + "em" : typeof block.indentHanging === "number" ? "-" + String(block.indentHanging) + "em" : legacyIndent ? String(legacyIndent) + "em" : undefined,
    textAlign: block.align || undefined,
    marginTop: typeof block.spacingBefore === "number" ? String(block.spacingBefore) + "pt" : undefined,
    marginBottom: typeof block.spacingAfter === "number" ? String(block.spacingAfter) + "pt" : undefined,
    lineHeight: "var(--manuscript-line-height, 1.6)",
    breakBefore: block.pageBreakBefore ? "page" as const : undefined,
  };
}

type ReaderPreferences = { theme?: "paper" | "sepia" | "night"; text_size?: "small" | "comfortable" | "large"; reading_width?: "narrow" | "standard" | "wide" };

export default function ReadingRoom({
  slug,
  episodeId,
  initialPayload = null,
  initialStatus = "loading",
  initialAccessGate = null,
  initialError = "",
  initialPreferences = null,
}: {
  slug: string;
  episodeId: string;
  initialPayload?: EpisodePayload | null;
  initialStatus?: "loading" | "signed-out" | "ready" | "locked" | "error";
  initialAccessGate?: EpisodeAccessGate | null;
  initialError?: string;
  initialPreferences?: ReaderPreferences | null;
}) {
  const [payload, setPayload] = useState<EpisodePayload | null>(initialPayload);
  const [status, setStatus] = useState<"loading" | "signed-out" | "ready" | "locked" | "error">(initialStatus);
  const [accessGate, setAccessGate] = useState<EpisodeAccessGate | null>(initialAccessGate);
  const [showContribution, setShowContribution] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [theme, setTheme] = useState<"paper" | "sepia" | "night">("paper");
  const [fontScale, setFontScale] = useState(100);
  const [width, setWidth] = useState<"narrow" | "comfortable" | "wide">("comfortable");
  // Device-only reading preferences. Defaults match the original look.
  const [typeface, setTypeface] = useState<"classic" | "modern" | "sans" | "dyslexia">("classic");
  const [spacing, setSpacing] = useState<"comfortable" | "relaxed">("comfortable");
  const [progress, setProgress] = useState(0);
  const [readingMode, setReadingMode] = useState<"pages" | "scroll">("pages");
  const [currentPage, setCurrentPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const pageViewportRef = useRef<HTMLDivElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const lastSwipeAt = useRef(0);
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    if (!showSettings) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setShowSettings(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [showSettings]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgress = useRef<{ scrollY: number; percent: number; page?: number } | null>(null);
  const preferencesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  const loadEpisode = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStatus("error");
      setError("Reading is not configured yet. Please try again later.");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      tokenRef.current = null;
      setSessionReady(false);
      // The open sample (free first episode) stays readable without an account.
      if (!initialPayload?.sample) setStatus("signed-out");
      return;
    }
    tokenRef.current = session.access_token;
    setSessionReady(true);
  }, [initialPayload]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      tokenRef.current = session?.access_token ?? null;
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setPayload(initialPayload);
    setStatus(initialStatus);
    setAccessGate(initialAccessGate);
    setError(initialError);
    if (initialPreferences?.theme) setTheme(initialPreferences.theme);
    if (initialPreferences?.text_size) setFontScale(initialPreferences.text_size === "small" ? 90 : initialPreferences.text_size === "large" ? 115 : 100);
    if (initialPreferences?.reading_width) setWidth(initialPreferences.reading_width === "wide" ? "wide" : initialPreferences.reading_width === "narrow" ? "narrow" : "comfortable");
    if (initialPayload) setProgress(initialPayload.reading_progress?.progress_percent ?? 0);
  }, [episodeId, initialPayload, initialStatus, initialAccessGate, initialError, initialPreferences]);

  useEffect(() => {
    void loadEpisode();
    return () => { if (preferencesTimer.current) clearTimeout(preferencesTimer.current); };
  }, [loadEpisode]);

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
      body: JSON.stringify({ progress_percent: latest.percent, last_position: { scrollY: latest.scrollY, ...(typeof latest.page === "number" ? { page: latest.page } : {}) } }),
      keepalive: true,
    }).catch(() => undefined);
  }, [apiUrl, episodeId]);

  const saveProgress = useCallback((scrollY: number, percent: number, page?: number) => {
    if (!tokenRef.current || !apiUrl) return;
    pendingProgress.current = { scrollY, percent, ...(typeof page === "number" ? { page } : {}) };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      flushProgress();
    }, 900);
  }, [apiUrl, flushProgress]);

  useEffect(() => {
    if (status !== "ready" || !sessionReady || !tokenRef.current || !apiUrl) return;
    if (preferencesTimer.current) clearTimeout(preferencesTimer.current);
    preferencesTimer.current = setTimeout(() => {
      const textSize = fontScale <= 95 ? "small" : fontScale >= 110 ? "large" : "comfortable";
      void fetch(`${apiUrl}/library/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ theme, text_size: textSize, reading_width: width === "wide" ? "wide" : width === "narrow" ? "narrow" : "standard" }),
      }).catch(() => undefined);
    }, 700);
    return () => { if (preferencesTimer.current) clearTimeout(preferencesTimer.current); };
  }, [apiUrl, fontScale, sessionReady, status, theme, width]);

  useEffect(() => {
    try {
      const savedMode = window.localStorage.getItem("storyflicks-reader-mode");
      if (savedMode === "scroll" || savedMode === "pages") setReadingMode(savedMode);
      const saved = JSON.parse(window.localStorage.getItem("storyflicks-reader-display") || "{}") as { typeface?: string; spacing?: string };
      if (saved.typeface === "modern" || saved.typeface === "sans" || saved.typeface === "dyslexia") setTypeface(saved.typeface);
      if (saved.spacing === "relaxed") setSpacing("relaxed");
    } catch {
      // Storage can be unavailable; the defaults still work.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("storyflicks-reader-mode", readingMode);
    } catch {
      // The selected reading mode remains active for this visit.
    }
  }, [readingMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem("storyflicks-reader-display", JSON.stringify({ typeface, spacing }));
    } catch {
      // Preferences simply last for this visit when storage is unavailable.
    }
  }, [typeface, spacing]);

  useEffect(() => {
    if (status !== "ready" || readingMode !== "scroll") return;
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
  }, [flushProgress, readingMode, saveProgress, status]);

  useEffect(() => {
    if (readingMode !== "scroll" || status !== "ready" || !payload?.reading_progress?.last_position?.scrollY) return;
    const y = payload.reading_progress.last_position.scrollY;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }, [payload, readingMode, status]);

  const updatePageMetrics = useCallback(() => {
    const viewport = pageViewportRef.current;
    if (!viewport || readingMode !== "pages") return;
    const width = Math.max(1, viewport.clientWidth);
    viewport.style.setProperty("--reader-page-column-width", `${width}px`);
    const content = viewport.querySelector<HTMLElement>(".reader-paged-content");
    const contentWidth = Math.max(viewport.scrollWidth, content?.scrollWidth || 0);
    const count = Math.max(1, Math.ceil((contentWidth - 1) / width));
    const page = Math.min(count - 1, Math.max(0, Math.round(viewport.scrollLeft / width)));
    setPageCount(count);
    setCurrentPage(page);
    const percent = Math.min(100, Math.round(((page + 1) / count) * 100));
    setProgress(percent);
    saveProgress(0, percent, page);
    try {
      window.localStorage.setItem(`storyflicks-reader-page:${episodeId}`, String(page));
    } catch {
      // Page navigation remains functional when local storage is unavailable.
    }
  }, [episodeId, readingMode, saveProgress]);

  const goToPage = useCallback((requestedPage: number) => {
    const viewport = pageViewportRef.current;
    if (!viewport || readingMode !== "pages") return;
    const pageWidth = Math.max(1, viewport.clientWidth);
    viewport.style.setProperty("--reader-page-column-width", `${pageWidth}px`);
    const content = viewport.querySelector<HTMLElement>(".reader-paged-content");
    const contentWidth = Math.max(viewport.scrollWidth, content?.scrollWidth || 0);
    const pageTotal = Math.max(1, Math.ceil((contentWidth - 1) / pageWidth));
    const page = Math.max(0, Math.min(pageTotal - 1, requestedPage));
    viewport.scrollTo({ left: page * pageWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setCurrentPage(page);
    const percent = Math.min(100, Math.round(((page + 1) / pageTotal) * 100));
    setPageCount(pageTotal);
    setProgress(percent);
    saveProgress(0, percent, page);
  }, [readingMode, saveProgress]);

  useEffect(() => {
    if (readingMode !== "pages" || status !== "ready") return;
    const viewport = pageViewportRef.current;
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePageMetrics);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const content = viewport.querySelector(".reader-paged-content");
    if (content) observer.observe(content);
    viewport.addEventListener("scroll", measure, { passive: true });
    measure();
    try {
      const storedPage = window.localStorage.getItem(`storyflicks-reader-page:${episodeId}`);
      const serverPage = payload?.reading_progress?.last_position?.page;
      const savedPage = storedPage !== null ? Number(storedPage) : (typeof serverPage === "number" ? serverPage : 0);
      if (Number.isFinite(savedPage) && savedPage > 0) {
        requestAnimationFrame(() => {
          const pageWidth = Math.max(1, viewport.clientWidth);
          viewport.style.setProperty("--reader-page-column-width", `${pageWidth}px`);
          const content = viewport.querySelector<HTMLElement>(".reader-paged-content");
          const contentWidth = Math.max(viewport.scrollWidth, content?.scrollWidth || 0);
          const pageTotal = Math.max(1, Math.ceil((contentWidth - 1) / pageWidth));
          viewport.scrollTo({ left: Math.min(pageTotal - 1, savedPage) * pageWidth, behavior: "auto" });
          requestAnimationFrame(updatePageMetrics);
        });
      }
    } catch {
      // Start at the first page when storage is unavailable.
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      viewport.removeEventListener("scroll", measure);
    };
  }, [episodeId, readingMode, status, updatePageMetrics, fontScale, spacing, width, typeface, payload]);

  useEffect(() => {
    if (readingMode !== "pages") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || showContribution) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input,textarea,select,button"))) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goToPage(currentPage + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goToPage(currentPage - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentPage, goToPage, readingMode, showContribution]);

  const handlePageTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStart.current = readingMode === "pages" && event.touches.length === 1 && touch
      ? { x: touch.clientX, y: touch.clientY }
      : null;
  };

  const handlePageTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    const touch = event.changedTouches[0];
    if (readingMode !== "pages" || !start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    // A page turn requires a deliberate horizontal swipe, not a vertical reading gesture.
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY) * 1.4) return;
    lastSwipeAt.current = Date.now();
    goToPage(currentPage + (deltaX < 0 ? 1 : -1));
  };

  const handlePageTap = (event: MouseEvent<HTMLDivElement>) => {
    if (Date.now() - lastSwipeAt.current < 450) return;
    const target = event.target as HTMLElement;
    if (readingMode !== "pages" || target.closest("a,button,input,textarea,select,label") || window.getSelection()?.toString()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    if (x < bounds.width * 0.28) goToPage(currentPage - 1);
    else if (x > bounds.width * 0.72) goToPage(currentPage + 1);
  };

  const episodeArtwork = payload?.episode.assets?.find((asset) => asset.asset_type === "inline_image" && asset.public_url);
  const bodyAssets = payload?.episode.assets?.filter((asset) => asset.public_url && asset.id !== episodeArtwork?.id) || [];
  const blocks = useMemo(() => extractBlocks(payload?.episode.content), [payload]);
  const sourceTitleIndex = blocks.findIndex((block) => block.sectionTitle === true);
  const sourceTitleBlock = sourceTitleIndex >= 0 ? blocks[sourceTitleIndex] : undefined;
  const sourceTitleRuns = sourceTitleBlock?.runs || [];
  const sourceTitleRunFormat = sourceTitleRuns[0]?.formatting;
  const leadingBlocks = sourceTitleIndex > 0 ? blocks.slice(0, sourceTitleIndex) : [];
  const firstBodyParagraphIndex = blocks.findIndex((block, index) => {
    if (index <= sourceTitleIndex || !blockText(block).trim()) return false;
    const kind = String(block.type || "paragraph").toLowerCase();
    return kind === "paragraph" || kind === "dialogue" || kind === "emphasis";
  });

  if (status === "loading") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p>Preparing your reading room…</p></main>;
  if (status === "signed-out") return <main className="reader-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">YOUR STORY IS WAITING</p><h1>Sign in to enter the Reading Room.</h1><p>Your reading progress and episode access are tied to your account.</p><Link className="primary-button" href={`/sign-in?next=/stories/${slug}/read/${episodeId}`}>Sign in to continue <span>↗</span></Link></main>;
  if (status === "locked" && accessGate?.previous_episode) return (
    <main className="reader-state reader-locked-state">
      <span className="reader-state-mark">SF.</span>
      <p className="eyebrow">ONE MORE STEP</p>
      <h1>One more step to unlock this {accessGate.section_label || "Episode"}.</h1>
      <p>{accessGate.locked_episode ? <>You’re almost at {accessGate.section_label || "Episode"} {String(accessGate.locked_episode.sequence_number).padStart(2, "0")}: <strong>{accessGate.locked_episode.title}</strong>. </> : null}{accessGate.message} Your next step is to share your take on {accessGate.section_label || "Episode"} {String(accessGate.previous_episode.sequence_number).padStart(2, "0")}, <strong>{accessGate.previous_episode.title}</strong>. Either a quick reaction or a written review is enough.</p>
      <button type="button" className="primary-button" onClick={() => setShowContribution(true)}>Share your take <span>→</span></button>
      <Link className="text-button" href={`/stories/${slug}/read/${accessGate.previous_episode.id}`}>← Return to {accessGate.section_label || "Episode"} {String(accessGate.previous_episode.sequence_number).padStart(2, "0")}</Link>
      {isTransitioning && (
        <div className="reader-transition" role="status" aria-live="polite" aria-atomic="true">
          <div className="reader-transition-content">
            <span className="reader-transition-mark" aria-hidden="true">SF.</span>
            <span className="reader-transition-spinner" aria-hidden="true" />
            <p className="reader-transition-eyebrow">TURNING THE PAGE</p>
            <h2>Your next chapter is on its way.</h2>
            <p>Your reaction has been received. Please bear with us while the next page loads.</p>
          </div>
        </div>
      )}
      {showContribution && <div className="contribution-modal-backdrop" role="presentation">
        <div className="contribution-modal-dialog" role="dialog" aria-modal="true" aria-label="Share your take">
          <ReactionPanel
            slug={slug}
            episodeId={accessGate.previous_episode.id}
            presentation="modal"
            onClose={() => setShowContribution(false)}
            onUnlocked={(nextEpisodeId) => {
              setShowContribution(false);
              setIsTransitioning(true);
              router.replace(`/stories/${slug}/read/${nextEpisodeId}`);
            }}
          />
        </div>
      </div>}
    </main>
  );
  if (status === "error" || !payload) return <main className="reader-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">A SMALL INTERRUPTION</p><h1>We couldn’t open this episode.</h1><p>{error}</p><Link className="text-button" href={`/stories/${slug}`}>← Back to {payload?.story.title || "the story"}</Link></main>;

  return (
    <main className={`reading-room theme-${theme}${readingMode === "pages" ? " is-paged" : ""}`}>
      <div className="reader-progress-track"><span style={{ width: `${progress}%` }} /></div>
      <header className="reader-bar">
        <Link className="reader-bar-back" href={`/stories/${slug}`} aria-label={`Back to ${payload.story.title}`}>←</Link>
        <div className="reader-bar-title"><Link href={`/stories/${slug}`}>{payload.story.title}</Link><span>{(payload.story.section_label || "Episode").toUpperCase()} {String(payload.episode.sequence_number).padStart(2, "0")}</span></div>
        <div className="reader-bar-tools">
          {payload.previous_episode && (
            <Link
              className="reader-bar-btn"
              href={`/stories/${slug}/read/${payload.previous_episode.id}`}
              aria-label={`Go to previous ${payload.story.section_label || "section"} ${payload.previous_episode.sequence_number}: ${payload.previous_episode.title}`}
            >
              ‹<span> {String(payload.previous_episode.sequence_number).padStart(2, "0")}</span>
            </Link>
          )}
          <span className="reader-bar-progress" aria-label={`${progress} percent read`}>{progress}%</span>
          <button className="reader-bar-btn" type="button" onClick={() => {
            if (readingMode === "scroll") {
              window.scrollTo(0, 0);
              setReadingMode("pages");
            } else {
              setReadingMode("scroll");
            }
          }} aria-label={readingMode === "pages" ? "Switch to continuous scrolling" : "Switch to paginated reading"}>{readingMode === "pages" ? "Scroll" : "Pages"}</button>
          <button className="reader-bar-btn reader-bar-aa" type="button" onClick={() => setShowSettings((value) => !value)} aria-expanded={showSettings} aria-label="Reading settings">Aa</button>
        </div>
      </header>
      {showSettings && <section className="reader-pop" aria-label="Reading settings">
        <div><span>APPEARANCE</span><div className="reader-pop-options">{(["paper", "sepia", "night"] as const).map((value) => <button key={value} className={theme === value ? "selected" : ""} onClick={() => setTheme(value)}>{value}</button>)}</div></div>
        <div><span>TYPEFACE</span><div className="reader-pop-options">{([["classic", "Classic"], ["modern", "Modern"], ["sans", "Sans"], ["dyslexia", "Dyslexia-friendly"]] as const).map(([value, label]) => <button key={value} className={typeface === value ? "selected" : ""} onClick={() => setTypeface(value)}>{label}</button>)}</div></div>
        <div><span>TEXT SIZE</span><div className="reader-pop-options"><button onClick={() => setFontScale((v) => Math.max(85, v - 5))} aria-label="Smaller text">A−</button><strong>{fontScale}%</strong><button onClick={() => setFontScale((v) => Math.min(130, v + 5))} aria-label="Larger text">A+</button></div></div>
        <div><span>LINE SPACING</span><div className="reader-pop-options"><button className={spacing === "comfortable" ? "selected" : ""} onClick={() => setSpacing("comfortable")}>Comfortable</button><button className={spacing === "relaxed" ? "selected" : ""} onClick={() => setSpacing("relaxed")}>Relaxed</button></div></div>
        <div><span>READING WIDTH</span><div className="reader-pop-options"><button className={width === "narrow" ? "selected" : ""} onClick={() => setWidth("narrow")}>Narrow</button><button className={width === "comfortable" ? "selected" : ""} onClick={() => setWidth("comfortable")}>Comfortable</button><button className={width === "wide" ? "selected" : ""} onClick={() => setWidth("wide")}>Wide</button></div></div>
      </section>}
      <div className={`reader-page-viewport ${readingMode === "pages" ? "is-paginated" : "is-scrolling"}`} ref={pageViewportRef} onClick={handlePageTap} onTouchStart={handlePageTouchStart} onTouchEnd={handlePageTouchEnd} onTouchCancel={() => { touchStart.current = null; }}>
      <article className={`reading-page reading-width-${width} reading-spacing-${spacing} ${readingMode === "pages" ? "reader-paged-content" : ""}`} data-font={typeface}>
        <div className="reading-episode-heading reading-episode-heading-stacked">
          {episodeArtwork?.public_url && (
            <RemoteImage
              className="reading-episode-thumbnail"
              src={episodeArtwork.public_url}
              alt={episodeArtwork.alt_text || `${payload.episode.title} ${String(payload.story.section_label || "section").toLowerCase()} artwork`}
              width={240}
              height={360}
              sizes="240px"
              priority
            />
          )}
          <div className="reading-kicker">{payload.story.title} <span>·</span> {(payload.story.section_label || "Episode").toUpperCase()} {String(payload.episode.sequence_number).padStart(2, "0")}</div>
          <h1 className="reading-episode-title" style={{ ...manuscriptBlockStyle(sourceTitleBlock || {}), fontWeight: sourceTitleBlock?.bold || (sourceTitleRuns.length > 0 && sourceTitleRuns.every((run) => run.bold)) ? 700 : 500, fontStyle: sourceTitleBlock?.italic || (sourceTitleRuns.length > 0 && sourceTitleRuns.every((run) => run.italic)) ? "italic" : undefined, textAlign: "center", fontFamily: "'Playfair Display', Georgia, serif", color: sourceTitleRunFormat?.color }}>{payload.episode.title}</h1>
        </div>
        {leadingBlocks.length > 0 && <div className="manuscript" style={{ fontSize: `${fontScale}%` }}>{leadingBlocks.map((block, index) => <p key={"leading-" + index} style={manuscriptBlockStyle(block)}>{renderRuns(block)}</p>)}</div>}
        <div className="reading-rule"><span>✦</span></div>
        <div className="manuscript" style={{ fontSize: `${fontScale}%` }}>
          {blocks.map((block, index) => {
            const text = blockText(block);
            const kind = String(block.type || "paragraph").toLowerCase();
            if (index <= sourceTitleIndex && sourceTitleIndex >= 0) return null;
            if (kind === "spacer") return <div className="manuscript-spacer" aria-hidden="true" key={index} />;
            if (kind.includes("separator") || kind === "divider" || kind === "scene_break") return <div className="manuscript-divider" key={index}>✦</div>;
            if (!text && kind !== "paragraph") return null;
            // Line spacing is the only manuscript formatting value STORYFLICKS standardises.
            // Every other imported paragraph property is applied as-authored.
            const style = manuscriptBlockStyle(block);
            if (kind.includes("heading") || kind === "title") return <h2 style={style} key={index}>{renderRuns(block)}</h2>;
            if (kind.includes("quote")) return <blockquote style={style} key={index}>{renderRuns(block)}</blockquote>;
            if (kind === "dialogue") return <p className="manuscript-dialogue" style={style} key={index}>{renderRuns(block)}</p>;
            if (kind === "emphasis") return <p className="manuscript-emphasis" style={style} key={index}>{renderRuns(block)}</p>;
            return <p className={`manuscript-paragraph${index === firstBodyParagraphIndex ? " has-drop-cap" : ""}`} style={style} key={index}>{renderRuns(block)}</p>;
          })}
        </div>
        {bodyAssets.map((asset) => <figure className="reading-asset" key={asset.id}><img loading="lazy" decoding="async" src={asset.public_url!} alt={asset.alt_text || "Story illustration"} /></figure>)}
        <footer className="reading-end">
          {payload.sample ? (
            <div className="reading-sample-cta">
              <p className="eyebrow">ENJOYING THE FIRST {(payload.story.section_label || "Episode").toUpperCase()}?</p>
              <p>Sign in free to keep reading, save your place and add this story to your library.</p>
              <Link className="primary-button" href={`/sign-in?next=/stories/${slug}/read/${payload.episode.id}`}>Sign in to keep reading <span>↗</span></Link>
            </div>
          ) : payload.next_episode && (
            <button type="button" className="reading-next-episode" onClick={() => setShowContribution(true)}>
              {payload.story.section_label || "Episode"} {payload.next_episode.sequence_number}. {payload.next_episode.title}
              <span aria-hidden="true">→</span>
            </button>
          )}
          {!payload.sample && <div className="reading-donation-area">
            <SupportStoryButton storyId={payload.story.id} slug={slug} compact />
          </div>}
        </footer>
      </article>
      </div>
      {readingMode === "pages" && <nav className="reader-page-controls" aria-label="Page navigation">
        <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 0}>← Previous</button>
        <span aria-live="polite">PAGE {String(currentPage + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</span>
        <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= pageCount - 1}>Next →</button>
      </nav>}
      {isTransitioning && (
        <div className="reader-transition" role="status" aria-live="polite" aria-atomic="true">
          <div className="reader-transition-content">
            <span className="reader-transition-mark" aria-hidden="true">SF.</span>
            <span className="reader-transition-spinner" aria-hidden="true" />
            <p className="reader-transition-eyebrow">TURNING THE PAGE</p>
            <h2>Your next chapter is on its way.</h2>
            <p>Your reaction has been received. Please bear with us while the next page loads.</p>
          </div>
        </div>
      )}
      {showContribution && <div className="contribution-modal-backdrop" role="presentation">
        <div className="contribution-modal-dialog" role="dialog" aria-modal="true" aria-label="Share your take">
          <ReactionPanel
            slug={slug}
            episodeId={payload.episode.id}
            presentation="modal"
            onClose={() => setShowContribution(false)}
            onUnlocked={(nextEpisodeId) => {
              setShowContribution(false);
              setIsTransitioning(true);
              router.replace(`/stories/${slug}/read/${nextEpisodeId}`);
            }}
          />
        </div>
      </div>}
    </main>
  );
}
