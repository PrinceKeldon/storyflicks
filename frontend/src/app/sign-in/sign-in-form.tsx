"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export default function SignInForm({ redirectTo }: { redirectTo: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setError("Sign-in is not configured yet. Please try again later."); setBusy(false); return; }
    try {
      const result = mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({ email: email.trim(), password });
      if (result.error) { setError(result.error.message); return; }
      if (mode === "signup" && !result.data.session) {
        setMessage("Check your email for a confirmation link. Once confirmed, come back here to sign in.");
        return;
      }
      window.location.assign(redirectTo);
    } catch {
      setError("We couldn’t reach the sign-in service. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <header className="auth-header"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><Link href="/" className="back-link">← Discover</Link></header>
      <section className="auth-panel">
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h1>{mode === "signin" ? "Welcome back." : "Find your next obsession."}</h1>
        <p className="auth-intro">{mode === "signin" ? "Sign in to pick up where the story left off." : "Create an account to save your place and join the conversation."}</p>
        <div className="auth-switch"><button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); setMessage(""); }}>Sign in</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); setMessage(""); }}>Create account</button></div>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="email">EMAIL ADDRESS</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          <label htmlFor="password">PASSWORD</label>
          <input id="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "One moment…" : mode === "signin" ? "Sign in" : "Create free account"} <span>↗</span></button>
        </form>
        <p className="auth-privacy">Your account keeps your reading progress, contributions and saved stories together.</p>
      </section>
      <footer className="footer auth-footer"><span>© 2026 STORYFLICKS</span><span>Stories worth staying for.</span></footer>
    </main>
  );
}
