"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type Session = { access_token: string; user?: { email?: string | null } } | null;

export function CreatorStudioNavLink({ className }: { className?: string }) {
  const [allowed, setAllowed] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !apiUrl) {
      setAllowed(false);
      return;
    }

    let active = true;
    const syncAccess = async (session: Session) => {
      if (!session?.access_token) {
        if (active) setAllowed(false);
        return;
      }
      try {
        const response = await fetch(`${apiUrl}/account/creator-access`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) setAllowed(false);
          return;
        }
        const result = await response.json() as { can_access_creator_studio?: boolean };
        if (active) setAllowed(result.can_access_creator_studio === true);
      } catch {
        if (active) setAllowed(false);
      }
    };

    void supabase.auth.getSession().then(({ data: { session } }) => syncAccess(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncAccess(session);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [apiUrl]);

  if (!allowed) return null;
  return <Link className={className} href="/creator-studio">Creator Studio</Link>;
}

export default function AccountNavigation() {
  const [email, setEmail] = useState("");
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const syncSession = (session: Session) => {
      setEmail(session?.user?.email ?? "");
      setSignedIn(Boolean(session?.access_token));
    };

    void supabase.auth.getSession().then(({ data: { session } }) => syncSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      syncSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.assign("/");
  }

  return (
    <div className="account-session-actions">
      {signedIn ? (
        <>
          <span className="account-email" title={email}>{email}</span>
          <button className="sign-in account-sign-out" type="button" onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <>
          <Link className="sign-in" href="/sign-in?next=/library">Sign in</Link>
          <Link className="join-button" href="/sign-in?mode=signup">Join free <span>↗</span></Link>
        </>
      )}
    </div>
  );
}
