"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type AccountState = "loading" | "signed-in" | "signed-out";

export default function AccountNavigation() {
  const [state, setState] = useState<AccountState>("loading");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    if (!supabase) {
      setState("signed-out");
      return;
    }

    const syncSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      setEmail(session?.user?.email ?? "");
      setState(session?.user ? "signed-in" : "signed-out");
    };

    void syncSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setEmail(session?.user?.email ?? "");
      setState(session?.user ? "signed-in" : "signed-out");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.assign("/");
  }

  return (
    <div className="account-actions">
      {state === "loading" ? (
        <span className="sign-in" aria-live="polite">Account…</span>
      ) : state === "signed-in" ? (
        <>
          <span className="account-email" title={email}>{email}</span>
          <Link className="sign-in" href="/settings">Settings</Link>
          <button className="sign-in account-sign-out" type="button" onClick={() => void signOut()}>Sign out</button>
        </>
      ) : (
        <>
          <Link className="sign-in" href="/settings">Settings</Link>
          <Link className="sign-in" href="/sign-in?next=/library">Sign in</Link>
          <Link className="join-button" href="/sign-in?mode=signup">Join free <span>↗</span></Link>
        </>
      )}
    </div>
  );
}
