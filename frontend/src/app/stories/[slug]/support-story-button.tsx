"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const suggestions = [2, 5, 10];

export default function SupportStoryButton({
  storyId,
  slug,
  compact = false,
}: {
  storyId: string;
  slug: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueToCheckout() {
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < 2 || dollars > 500 || !Number.isInteger(dollars)) {
      setError("Choose a whole-dollar amount between $2 and $500.");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Support payments are not available right now.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.location.assign(`/sign-in?next=${encodeURIComponent(`/stories/${slug}`)}`);
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
      if (!apiUrl) throw new Error("Support payments are not configured yet.");
      const response = await fetch(`${apiUrl}/support/checkout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ story_id: storyId, amount_cents: dollars * 100 }),
      });
      const result = await response.json().catch(() => ({})) as { checkout_url?: string; detail?: string };
      if (!response.ok || !result.checkout_url) {
        throw new Error(result.detail || "We couldn’t start secure checkout. Please try again.");
      }
      window.location.assign(result.checkout_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className={compact ? "support-story support-story-compact" : "support-story"}>
      {!expanded ? (
        <button type="button" className="support-story-trigger" onClick={() => setExpanded(true)}>
          <span>♡</span> Support this story
        </button>
      ) : (
        <section className="support-story-panel" aria-label="Support this story">
          <button className="support-story-close" type="button" onClick={() => { setExpanded(false); setError(""); }} aria-label="Close support options">×</button>
          <p className="eyebrow">KEEP THE STORIES COMING</p>
          <h3>Enjoying the story?</h3>
          <p>Your voluntary support helps make more independent storytelling possible. Reading always stays free.</p>
          <div className="support-amounts" aria-label="Choose a contribution amount">
            {suggestions.map((value) => (
              <button key={value} type="button" className={amount === String(value) ? "selected" : ""} onClick={() => setAmount(String(value))}>${value}</button>
            ))}
            <label className="support-custom-amount">Custom $
              <input type="number" min="2" max="500" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Custom whole-dollar contribution amount" />
            </label>
          </div>
          {error && <p className="support-error" role="alert">{error}</p>}
          <button type="button" className="primary-button support-checkout" disabled={busy} onClick={() => void continueToCheckout()}>
            {busy ? "Opening secure checkout…" : "Continue to secure checkout"} <span>↗</span>
          </button>
          <small>One-time payment · Securely processed by Stripe · No subscription</small>
        </section>
      )}
    </div>
  );
}
