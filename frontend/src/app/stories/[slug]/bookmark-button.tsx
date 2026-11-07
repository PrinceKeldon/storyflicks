"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type State = "loading" | "signed-out" | "saved" | "unsaved" | "busy" | "error";

export default function BookmarkButton({ storyId, slug }: { storyId: string; slug: string }) {
  const [state,setState]=useState<State>("loading");
  const [message,setMessage]=useState("");
  const apiUrl=process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/,"");

  useEffect(()=>{
    let active=true;
    async function check(){
      const supabase=getSupabaseBrowserClient();
      if(!supabase||!apiUrl){if(active)setState("error");return;}
      const {data:{session}}=await supabase.auth.getSession();
      if(!session?.access_token){if(active)setState("signed-out");return;}
      try{
        const response=await fetch(`${apiUrl}/library`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
        if(!response.ok)throw new Error("Could not check your saved stories.");
        const library=await response.json();
        if(active)setState(library.saved?.some((item:{story:{id:string}})=>item.story.id===storyId)?"saved":"unsaved");
      }catch{if(active)setState("error");}
    }
    void check();
    return ()=>{active=false;};
  },[apiUrl,storyId]);

  async function toggle(){
    const supabase=getSupabaseBrowserClient();
    if(!supabase||!apiUrl)return;
    const {data:{session}}=await supabase.auth.getSession();
    if(!session?.access_token){setState("signed-out");return;}
    const wasSaved=state==="saved";setState("busy");setMessage("");
    try{
      const response=await fetch(`${apiUrl}/library/bookmarks/${storyId}`,{
        method:wasSaved?"DELETE":"POST",
        headers:{Authorization:`Bearer ${session.access_token}`},
      });
      if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.detail||"Your library could not be updated.");}
      setState(wasSaved?"unsaved":"saved");
    }catch(cause){setMessage(cause instanceof Error?cause.message:"Something went wrong.");setState(wasSaved?"saved":"unsaved");}
  }

  if(state==="signed-out")return <Link className="story-save-button" href={`/sign-in?next=/stories/${slug}`}>☆ Save story</Link>;
  if(state==="loading")return <span className="story-save-button muted">Checking library…</span>;
  if(state==="error")return <Link className="story-save-button" href="/sign-in?next=/stories/${slug}">Sign in to save</Link>;
  return <span className="story-save-wrap"><button className={state==="saved"||state==="busy"&&message==="saved"?"story-save-button saved":"story-save-button"} onClick={()=>void toggle()} disabled={state==="busy"}>{state==="busy"?"Saving…":state==="saved"?"✓ Saved to library":"☆ Save story"}</button>{message&&<small role="alert">{message}</small>}</span>;
}
