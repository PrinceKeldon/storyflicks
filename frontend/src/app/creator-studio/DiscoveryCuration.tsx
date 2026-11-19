"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type StoryOption = { id: string; title: string; publication_status: string };
type FeaturedResponse = { story: { id: string; title: string } | null; kicker: string };

export default function DiscoveryCuration() {
  const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  const [stories, setStories] = useState<StoryOption[]>([]);
  const [storyId, setStoryId] = useState("");
  const [kicker, setKicker] = useState("FEATURED STORY");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!api || !client) { setError("Discovery curation is not configured."); setLoading(false); return; }
    try {
      const [{ data: { session } }, catalogueResponse, featuredResponse] = await Promise.all([
        client.auth.getSession(),
        fetch(api + "/stories?limit=100", { cache: "no-store" }),
        fetch(api + "/discovery/featured", { cache: "no-store" }),
      ]);
      if (!session?.access_token) throw new Error("Sign in to manage Discovery.");
      if (!catalogueResponse.ok) throw new Error("Could not load the published catalogue.");
      const catalogue = await catalogueResponse.json();
      const items = Array.isArray(catalogue.items) ? catalogue.items : [];
      setStories(items);
      if (featuredResponse.ok) {
        const featured = await featuredResponse.json() as FeaturedResponse;
        setStoryId(featured.story?.id || "");
        setKicker(featured.kicker || "FEATURED STORY");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Discovery settings.");
    } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = getSupabaseBrowserClient();
    if (!api || !client || saving) return;
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) { setError("Your sign-in session has expired."); return; }
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch(api + "/creator/discovery/featured", {
        method: "PUT",
        headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ story_id: storyId || null, kicker: kicker.trim() || "FEATURED STORY" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || "Could not save Discovery curation.");
      setNotice(storyId ? "Featured story saved. Discovery will reflect this selection." : "Featured placement cleared. Discovery will use its automatic fallback.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save Discovery curation.");
    } finally { setSaving(false); }
  }

  return (
    <section className="studio-info-panel studio-notification-settings">
      <span>DISCOVERY & EDITORIAL CURATION</span>
      <p>Choose which published title leads the Discovery page. This is independent of publication: publishing a story will not replace your selection.</p>
      {loading ? <p>Loading published titles…</p> : (
        <form onSubmit={save}>
          <div className="studio-form-grid">
            <label className="studio-span-two">Featured story
              <select value={storyId} onChange={event => setStoryId(event.target.value)}>
                <option value="">Automatic fallback (newest publication)</option>
                {stories.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}
              </select>
            </label>
            <label className="studio-span-two">Featured label
              <input value={kicker} maxLength={80} onChange={event => setKicker(event.target.value)} placeholder="FEATURED STORY" />
            </label>
          </div>
          <div className="studio-form-actions">
            <button type="submit" className="studio-primary studio-form-save" disabled={saving}>{saving ? "Saving…" : "Save Discovery curation"}</button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
