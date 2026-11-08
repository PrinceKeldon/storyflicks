"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import CreatorStudio from "./studio";

type AccessState = "checking" | "allowed" | "denied" | "signed-out" | "error";

export default function CreatorStudioAccess() {
  const [state, setState] = useState<AccessState>("checking");

  useEffect(() => {
    let active = true;
    async function check() {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) { if (active) setState("error"); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { if (active) setState("signed-out"); return; }
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
        if (!apiUrl) throw new Error("API unavailable");
        const response = await fetch(`${apiUrl}/account/access`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (response.status === 401) { if (active) setState("signed-out"); return; }
        if (!response.ok) throw new Error("Access check failed");
        const access = await response.json() as { is_creator?: boolean };
        if (active) setState(access.is_creator ? "allowed" : "denied");
      } catch {
        if (active) setState("error");
      }
    }
    void check();
    return () => { active = false; };
  }, []);

  if (state === "checking") return <main className="library-state"><span className="reader-state-mark">SF.</span><p>Checking creator access…</p></main>;
  if (state === "signed-out") return <main className="library-state"><span className="reader-state-mark">SF.</span><h1>Creator access required<span>.</span></h1><p>Sign in with an approved creator account to open Creator Studio.</p><Link className="primary-button" href="/sign-in?next=/creator-studio">Sign in <span>↗</span></Link></main>;
  if (state === "denied") return <main className="library-state"><span className="reader-state-mark">SF.</span><h1>This space is for creators<span>.</span></h1><p>Your STORYFLICKS account is a reader account. Creator access is invitation-only and must be approved separately.</p><Link className="primary-button" href="/library">Return to My Library <span>↗</span></Link></main>;
  if (state === "error") return <main className="library-state"><span className="reader-state-mark">SF.</span><h1>We couldn’t verify creator access<span>.</span></h1><p>Please try again shortly.</p><Link className="primary-button" href="/">Back to Discover <span>↗</span></Link></main>;
  return <CreatorStudio />;
}
