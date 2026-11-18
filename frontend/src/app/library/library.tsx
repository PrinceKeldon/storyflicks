"use client";
import { getAccessToken, fetchWithTimeout, apiErrorMessage } from "@/lib/api-client";
import RemoteImage from "@/components/remote-image";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import CreatorStudioNavLink from "../creator-studio-nav-link";
import AccountNavigation from "../account-navigation";
import { coverTone } from "@/lib/cover-tone";

type Story = { id: string; slug: string; title: string; author_name?: string | null; tagline: string | null; synopsis: string | null; completion_status: "ongoing" | "completed"; cover_url: string | null; section_label?: string | null; section_label_plural?: string | null };
type Episode = { id: string; story_id: string; sequence_number: number; title: string; publication_status: string };
type Progress = { episode_id: string; progress_percent: number; last_position: number | null; started_at: string | null; completed_at: string | null; updated_at: string };
type StoryCard = { story: Story; last_read_episode: Episode | null; latest_published_episode: Episode; first_published_episode: Episode; published_episode_count: number; completed_episode_count: number; reading_progress: Progress[]; available_episode: Episode | null };
type ReactionContribution = { id: string; created_at: string; reaction: { statement: string; emoji: string; category: string }; episode: Episode; story: Story | null };
type ReviewContribution = { id: string; headline: string | null; body: string; visibility: "public" | "private"; submitted_at: string | null; episode: Episode; story: Story | null };
type PagedKey = "continue_reading" | "not_started" | "caught_up" | "completed" | "saved" | "reactions" | "reviews";
type LibraryData = { continue_reading: StoryCard[]; not_started: StoryCard[]; caught_up: StoryCard[]; completed: StoryCard[]; saved: StoryCard[]; contributions: { reactions: ReactionContribution[]; reviews: ReviewContribution[] }; totals: Record<PagedKey, number>; has_more: Record<PagedKey, boolean>; story_total: number };
const PAGE_SIZE = 12;
const pagedKeys: PagedKey[] = ["continue_reading", "not_started", "caught_up", "completed", "saved", "reactions", "reviews"];
// Tolerates an API that has not been upgraded to paged responses yet (everything is loaded, nothing more to fetch).
function withPaging(raw: LibraryData): LibraryData {
  if (raw.totals && raw.has_more) return raw;
  const totals = {} as Record<PagedKey, number>; const has_more = {} as Record<PagedKey, boolean>;
  for (const key of pagedKeys) { totals[key] = loadedCount(raw, key); has_more[key] = false; }
  const ids = new Set([...raw.continue_reading, ...raw.not_started, ...raw.caught_up, ...raw.completed, ...raw.saved].map(card => card.story.id));
  return { ...raw, totals, has_more, story_total: raw.story_total ?? ids.size };
}
function loadedCount(data: LibraryData, key: PagedKey) { return key === "reactions" || key === "reviews" ? data.contributions[key].length : data[key].length; }
type Tab = "reading" | "saved" | "contributions";
type Shelf = "continue_reading" | "not_started" | "caught_up" | "completed";
type Status = "loading" | "signed-out" | "ready" | "error";

const shelves: { id: Shelf; title: string; eyebrow: string; empty: string }[] = [
  { id: "continue_reading", title: "Continue reading", eyebrow: "PICK UP WHERE YOU LEFT OFF", empty: "Your reading journey will appear here once you begin a story." },
  { id: "not_started", title: "On your list", eyebrow: "SAVED FOR LATER", empty: "Stories you save for later will be waiting here." },
  { id: "caught_up", title: "Caught up", eyebrow: "YOU’RE ALL UP TO DATE", empty: "When you reach the latest section of an ongoing story, it will appear here." },
  { id: "completed", title: "Completed", eyebrow: "THE FINAL PAGE", empty: "Finished stories will find their place here." },
];
function percent(card: StoryCard) { const active=[...card.reading_progress].filter(item=>!item.completed_at).sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||""))[0]; return card.published_episode_count ? ((card.completed_episode_count+(active?.progress_percent||0)/100)/card.published_episode_count)*100 : 0; }
function lastProgress(card: StoryCard) { return [...card.reading_progress].sort((a,b)=>(b.updated_at||"").localeCompare(a.updated_at||""))[0]; }
function episodeHref(card: StoryCard) { const target=card.available_episode||card.last_read_episode||card.first_published_episode||card.latest_published_episode; return `/stories/${card.story.slug}/read/${target.id}`; }
function dateLabel(value: string | null) { if(!value)return "Recently";const date=new Date(value);return Number.isNaN(date.getTime())?"Recently":new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(date); }
function shortSynopsis(story: Story) { return story.tagline||story.synopsis||"An original STORYFLICKS story."; }

export default function Library() {
  const [data,setData]=useState<LibraryData|null>(null);
  const [status,setStatus]=useState<Status>("loading");
  const [error,setError]=useState("");
  const [tab,setTab]=useState<Tab>("reading");
  const [removing,setRemoving]=useState<string|null>(null);
  const [loadingMore,setLoadingMore]=useState<PagedKey|null>(null);
  const apiUrl=process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/,"");

  const load=useCallback(async()=>{
    if(!getSupabaseBrowserClient()||!apiUrl){setStatus("error");setError("My Library is not configured yet.");return;}
    setStatus("loading");setError("");
    try{
      const token=await getAccessToken();
      if(!token){setStatus("signed-out");return;}
      const response=await fetchWithTimeout(`${apiUrl}/library`,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
      if(response.status===401){setStatus("signed-out");return;}
      if(!response.ok)throw new Error(await apiErrorMessage(response,"We couldn’t load your library."));
      setData(withPaging(await response.json() as LibraryData));setStatus("ready");
    }catch(cause){setError(cause instanceof Error?cause.message:"Something went wrong.");setStatus("error");}
  },[apiUrl]);
  useEffect(()=>{void load();},[load]);

  const totalStories=data?.story_total??0;

  async function loadMore(key:PagedKey){
    const supabase=getSupabaseBrowserClient();if(!supabase||!apiUrl||loadingMore||!data)return;
    const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token){setStatus("signed-out");return;}
    setLoadingMore(key);setError("");
    try{
      const offset=loadedCount(data,key);
      const response=await fetch(`${apiUrl}/library?shelf=${key}&offset=${offset}&limit=${PAGE_SIZE}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(response.status===429?"You’re going a little fast. Please wait a moment and try again.":result.detail||"We couldn’t load more.");}
      const page=await response.json() as {items:unknown[];total:number;has_more:boolean};
      setData(current=>{
        if(!current)return current;
        const next={...current,totals:{...current.totals,[key]:page.total},has_more:{...current.has_more,[key]:page.has_more}};
        if(key==="reactions"||key==="reviews")return {...next,contributions:{...current.contributions,[key]:[...current.contributions[key],...page.items]}} as LibraryData;
        return {...next,[key]:[...current[key],...page.items as StoryCard[]]} as LibraryData;
      });
    }catch(cause){setError(cause instanceof Error?cause.message:"Something went wrong.");}finally{setLoadingMore(null);}
  }
  const showMore=(key:PagedKey)=>data?.has_more[key]?<div className="library-more"><button type="button" className="outline-button" disabled={loadingMore===key} onClick={()=>void loadMore(key)}>{loadingMore===key?"Loading…":`Show more (${Math.max(0,(data.totals[key]||0)-loadedCount(data,key))} left)`}</button></div>:null;

  async function removeSaved(storyId:string){
    const supabase=getSupabaseBrowserClient();if(!supabase||!apiUrl||removing)return;
    const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token){setStatus("signed-out");return;}
    setRemoving(storyId);setError("");
    try{
      const response=await fetch(`${apiUrl}/library/bookmarks/${storyId}`,{method:"DELETE",headers:{Authorization:`Bearer ${session.access_token}`}});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.detail||"This story could not be removed.");}
      setData(current=>{if(!current)return current;const wasSaved=current.saved.some(card=>card.story.id===storyId);const wasListed=current.not_started.some(card=>card.story.id===storyId);return {...current,saved:current.saved.filter(card=>card.story.id!==storyId),not_started:current.not_started.filter(card=>card.story.id!==storyId),totals:{...current.totals,saved:current.totals.saved-(wasSaved?1:0),not_started:current.totals.not_started-(wasListed?1:0)}};});
    }catch(cause){setError(cause instanceof Error?cause.message:"Something went wrong.");}finally{setRemoving(null);}
  }

  if(status==="loading")return <main className="library-state"><span className="reader-state-mark">SF.</span><p>Gathering your stories…</p></main>;
  if(status==="signed-out")return <main className="library-state"><span className="reader-state-mark">SF.</span><p className="eyebrow">YOUR PERSONAL STORY SPACE</p><h1>Your library awaits<span>.</span></h1><p>Sign in to keep your reading progress, save stories and revisit the things you’ve shared.</p><Link className="primary-button" href="/sign-in?next=/library">Sign in to your library <span>↗</span></Link><Link className="library-secondary-link" href="/">Explore stories instead</Link></main>;
  if(status==="error"||!data)return <main className="library-state"><span className="reader-state-mark">SF.</span><h1>We couldn’t open your library.</h1><p>{error}</p><button className="outline-button" onClick={()=>void load()}>Try again</button></main>;

  return <main className="library-shell">
    <header className="library-header"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><nav aria-label="Main navigation"><Link href="/">Discover</Link><Link className="active" href="/library">My Library</Link><CreatorStudioNavLink /></nav><AccountNavigation /><Link className="library-header-link" href="/">Explore stories <span>↗</span></Link></header>
    <section className="library-hero"><div><p className="eyebrow">YOUR STORY COLLECTION</p><h1>Every story leaves<br/>something <em>behind.</em></h1><p>Pick up where you left off, revisit a favourite, or see what you’ve shared with the STORYFLICKS community.</p></div><div className="library-count"><strong>{totalStories.toString().padStart(2,"0")}</strong><span>STORIES IN YOUR WORLD</span><i>✳</i></div></section>
    <div className="library-tabs" role="tablist" aria-label="Library sections">
      <button role="tab" aria-selected={tab==="reading"} className={tab==="reading"?"active":""} onClick={()=>setTab("reading")}>My Stories</button>
      <button role="tab" aria-selected={tab==="saved"} className={tab==="saved"?"active":""} onClick={()=>setTab("saved")}>Saved <span>{data.totals.saved}</span></button>
      <button role="tab" aria-selected={tab==="contributions"} className={tab==="contributions"?"active":""} onClick={()=>setTab("contributions")}>My Contributions <span>{data.totals.reactions+data.totals.reviews}</span></button>
    </div>
    {tab==="reading"&&<div className="library-shelves">{shelves.map(shelf=>{const cards=data[shelf.id];return <section className="library-shelf" key={shelf.id}><div className="library-shelf-heading"><div><p className="eyebrow">{shelf.eyebrow}</p><h2>{shelf.title}<span>.</span></h2></div><small>{data.totals[shelf.id].toString().padStart(2,"0")} STORIES</small></div>
      {cards.length===0?<div className="library-empty-shelf"><span>✳</span><p>{shelf.empty}</p></div>:<div className="library-story-grid">{cards.map(card=>{const progress=percent(card);const latest=lastProgress(card);const target=card.available_episode||card.last_read_episode||card.first_published_episode||card.latest_published_episode;return <article className="library-story-card" data-tone={coverTone(card.story.slug)} key={card.story.id}>
        <Link className={card.story.cover_url ? "library-story-art has-cover" : "library-story-art"} href={`/stories/${card.story.slug}`} aria-label={`Explore ${card.story.title}`}>{card.story.cover_url ? <RemoteImage className="library-cover-image" src={card.story.cover_url} alt={`${card.story.title} cover`} fill sizes="(max-width: 640px) 100vw, 220px" /> : <><span className="library-art-index">STORYFLICKS ORIGINAL</span><strong>{card.story.title}</strong><i>{card.story.completion_status==="completed"?"COMPLETE":"ONGOING"}</i></>}</Link>
        <div className="library-story-info">{card.available_episode&&card.completed_episode_count>0&&card.story.completion_status!=="completed"&&<span className="up-next-tag">UP NEXT</span>}<p className="eyebrow">{card.story.completion_status==="completed"?"COMPLETED STORY":"ONGOING STORY"}</p><h3>{card.story.title}</h3>{card.story.author_name && <p className="catalogue-author-byline">By {card.story.author_name}</p>}<p className="library-story-tagline">{shortSynopsis(card.story)}</p><div className="library-story-meta"><span>{card.completed_episode_count}/{card.published_episode_count} {(card.story.section_label_plural || "Episodes").toUpperCase()} READ</span><span>{latest?`${Math.round(progress)}% LAST READ`:"NOT STARTED"}</span></div><div className="library-progress-track"><span style={{width:`${Math.min(100,Math.max(0,progress))}%`}}/></div><div className="library-card-footer"><span>{(card.story.section_label || "Episode").toUpperCase()} {String(target.sequence_number).padStart(2,"0")} · {target.title}</span><Link href={episodeHref(card)}>{card.available_episode?"Continue reading":card.last_read_episode?`Return to ${(card.story.section_label || "Episode").toLowerCase()}`:"Start reading"} <span>↗</span></Link></div></div>
      </article>;})}</div>}{showMore(shelf.id)}</section>;})}</div>}
    {tab==="saved"&&<section className="library-shelves library-shelf"><div className="library-shelf-heading"><div><p className="eyebrow">KEEP THESE CLOSE</p><h2>Saved stories<span>.</span></h2></div><small>{data.totals.saved.toString().padStart(2,"0")} STORIES</small></div>
      {data.saved.length===0?<div className="library-empty-large"><span>☆</span><h3>A story caught your eye?</h3><p>Save stories from their detail pages and they’ll be collected here for whenever you’re ready.</p><Link href="/">Discover stories <span>↗</span></Link></div>:<div className="library-story-grid">{data.saved.map(card=><article className="library-story-card saved-card" data-tone={coverTone(card.story.slug)} key={card.story.id}><Link className={card.story.cover_url ? "library-story-art has-cover" : "library-story-art"} href={`/stories/${card.story.slug}`} aria-label={`Explore ${card.story.title}`}>{card.story.cover_url ? <RemoteImage className="library-cover-image" src={card.story.cover_url} alt={`${card.story.title} cover`} fill sizes="(max-width: 640px) 100vw, 220px" /> : <><span className="library-art-index">STORYFLICKS ORIGINAL</span><strong>{card.story.title}</strong><i>{card.story.completion_status==="completed"?"COMPLETE":"ONGOING"}</i></>}</Link><div className="library-story-info"><p className="eyebrow">SAVED TO YOUR LIBRARY</p><h3>{card.story.title}</h3><p className="library-story-tagline">{shortSynopsis(card.story)}</p><div className="library-card-footer"><Link href={`/stories/${card.story.slug}`}>Explore story <span>↗</span></Link><button type="button" disabled={removing===card.story.id} onClick={()=>void removeSaved(card.story.id)}>{removing===card.story.id?"Removing…":"Remove saved"}</button></div></div></article>)}</div>}
      {showMore("saved")}
    </section>}
    {tab==="contributions"&&<section className="library-shelves library-contributions"><div className="library-shelf-heading"><div><p className="eyebrow">YOUR VOICE IN THE STORY</p><h2>My contributions<span>.</span></h2></div><small>{data.totals.reactions+data.totals.reviews} CONTRIBUTIONS</small></div>
      {data.contributions.reactions.length===0&&data.contributions.reviews.length===0?<div className="library-empty-large"><span>✳</span><h3>Your perspective belongs here.</h3><p>Reactions and reviews you share after reading will be collected here.</p><Link href="/">Find a story <span>↗</span></Link></div>:<>
        {data.contributions.reviews.length>0&&<div className="library-contribution-group"><h3>Written reviews <span>{data.totals.reviews}</span></h3>{data.contributions.reviews.map(review=><article className="library-contribution-card" key={review.id}><div className="library-contribution-type">WRITTEN REVIEW <span className={review.visibility==="private"?"private":"public"}>{review.visibility==="private"?"PRIVATE":"PUBLIC"}</span></div><div className="library-contribution-copy"><p className="eyebrow">{review.story?.title||"STORY"} · EPISODE {String(review.episode.sequence_number).padStart(2,"0")}</p><h4>{review.headline||"Your thoughts on "+review.episode.title}</h4><p>{review.body}</p><small>{dateLabel(review.submitted_at)} · {review.episode.title}</small></div><Link href={`/stories/${review.story?.slug||"the-priest"}/react/${review.episode.id}`}>View contribution ↗</Link></article>)}{showMore("reviews")}</div>}
        {data.contributions.reactions.length>0&&<div className="library-contribution-group"><h3>Quick reactions <span>{data.totals.reactions}</span></h3>{data.contributions.reactions.map(item=><article className="library-reaction-row" key={item.id}><span>{item.reaction.emoji}</span><div><strong>{item.reaction.statement}</strong><small>{item.story?.title||"STORY"} · EPISODE {String(item.episode.sequence_number).padStart(2,"0")} · {dateLabel(item.created_at)}</small></div><Link href={`/stories/${item.story?.slug||"the-priest"}/reviews/${item.episode.id}`}>Discussion ↗</Link></article>)}{showMore("reactions")}</div>}
      </>}
    </section>}
    {error&&<p className="library-error" role="alert">{error}</p>}
    <footer className="library-footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><span>Stories worth staying for.</span><Link href="/">Back to Discover ↗</Link></footer>
  </main>;
}
