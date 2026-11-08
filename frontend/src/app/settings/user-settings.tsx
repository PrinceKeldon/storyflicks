"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import AccountNavigation, { CreatorStudioNavLink } from "@/app/account-navigation";

type Theme = "dark" | "light";
type Status = "loading" | "signed-in" | "signed-out" | "error";
const STORAGE_KEY = "storyflicks-theme";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export default function UserSettings() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [status, setStatus] = useState<Status>("loading");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const load = async () => {
      const supabase = getSupabaseBrowserClient();
      const local = window.localStorage.getItem(STORAGE_KEY);
      if (!supabase) {
        if (isTheme(local)) setTheme(local);
        setStatus("signed-out");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      const saved = session?.user?.user_metadata?.theme_preference;
      const initial: Theme = isTheme(saved) ? saved : isTheme(local) ? local : "dark";
      setTheme(initial);
      document.documentElement.dataset.theme = initial;
      window.localStorage.setItem(STORAGE_KEY, initial);
      setStatus(session?.user ? "signed-in" : "signed-out");
      if (session?.user && !isTheme(saved) && isTheme(local)) {
        await supabase.auth.updateUser({ data: { theme_preference: local } });
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  async function chooseTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem(STORAGE_KEY, next);
    setNotice("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice("Saved on this browser. Sign in to sync this preference to your account.");
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setNotice("Saved on this browser. Sign in to sync this preference to your account.");
      } else {
        const { error } = await supabase.auth.updateUser({ data: { theme_preference: next } });
        if (error) throw error;
        setNotice("Your appearance preference is saved to your account.");
      }
    } catch {
      setNotice("Applied for this browser, but account sync failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="user-settings-shell">
      <header className="user-settings-header">
        <Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link>
        <nav aria-label="Main navigation">
          <Link href="/">Discover</Link>
          <Link href="/library">My Library</Link>
          <CreatorStudioNavLink />
        </nav>
        <div className="user-settings-account"><Link className="user-settings-back" href="/">Back to Discover ↗</Link><AccountNavigation /></div>
      </header>
      <section className="user-settings-content">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>Settings<span>.</span></h1>
        <p className="user-settings-intro">Make STORYFLICKS feel right for you. Your appearance preference follows your account when you sign in.</p>
        <section className="user-settings-panel" aria-labelledby="appearance-heading">
          <div className="user-settings-panel-heading">
            <div><p className="eyebrow">DISPLAY</p><h2 id="appearance-heading">Appearance</h2></div>
            <span className="user-settings-status">{status === "loading" ? "LOADING" : status === "signed-in" ? "ACCOUNT SYNC" : "BROWSER ONLY"}</span>
          </div>
          <p className="user-settings-description">Choose how the STORYFLICKS interface looks. This does not change the independent Paper, Sepia or Night reading themes.</p>
          <div className="theme-choice-grid" role="group" aria-label="Choose interface appearance">
            <button type="button" className={theme === "dark" ? "theme-choice selected" : "theme-choice"} aria-pressed={theme === "dark"} onClick={() => void chooseTheme("dark")}>
              <span className="theme-preview theme-preview-dark"><i /><i /><b /></span>
              <span className="theme-choice-copy"><strong>Dark</strong><small>Deep, cinematic surfaces</small></span>
              <span className="theme-choice-indicator" aria-hidden="true">{theme === "dark" ? "✓" : ""}</span>
            </button>
            <button type="button" className={theme === "light" ? "theme-choice selected" : "theme-choice"} aria-pressed={theme === "light"} onClick={() => void chooseTheme("light")}>
              <span className="theme-preview theme-preview-light"><i /><i /><b /></span>
              <span className="theme-choice-copy"><strong>Light</strong><small>Warm, editorial surfaces</small></span>
              <span className="theme-choice-indicator" aria-hidden="true">{theme === "light" ? "✓" : ""}</span>
            </button>
          </div>
          {saving ? <p className="user-settings-feedback" role="status">Saving your preference…</p> : null}
          {notice ? <p className="user-settings-feedback" role="status">{notice}</p> : null}
          {status === "signed-out" ? <p className="user-settings-signin">You are not signed in. This choice is saved on this browser; <Link href="/sign-in?next=/settings">sign in</Link> to sync it across devices and sessions.</p> : null}
        </section>
      </section>
      <footer className="user-settings-footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><span>Stories worth staying for.</span></footer>
    </main>
  );
}
