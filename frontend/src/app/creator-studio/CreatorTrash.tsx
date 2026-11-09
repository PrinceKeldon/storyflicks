"use client";

import { useCallback, useEffect, useState } from "react";

type TrashItem = {
  id: string;
  title: string;
  story_id?: string;
  story_title?: string;
  slug?: string;
  sequence_number?: number;
  publication_status?: string;
  deleted_from_status?: string | null;
  deleted_at: string;
  section_type?: string;
  placement?: string;
};

type TrashPayload = {
  stories: TrashItem[];
  episodes: TrashItem[];
  materials: TrashItem[];
};

type Props = {
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onChanged: () => Promise<void> | void;
};

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently deleted"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function CreatorTrash({ request, onChanged }: Props) {
  const [items, setItems] = useState<TrashPayload>({ stories: [], episodes: [], materials: [] });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const data = await request("/creator/trash") as TrashPayload;
      setItems({
        stories: data.stories || [],
        episodes: data.episodes || [],
        materials: data.materials || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Trash.");
    } finally {
      setBusy("");
    }
  }, [request]);

  useEffect(() => { void load(); }, [load]);

  async function restore(type: "story" | "episode" | "material", item: TrashItem) {
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      const path = type === "story"
        ? `/creator/stories/${item.id}/restore`
        : type === "episode"
          ? `/creator/episodes/${item.id}/restore`
          : `/creator/trash/materials/${item.id}/restore`;
      await request(path, { method: "POST" });
      setNotice(`“${item.title}” restored. Published content is not automatically republished.`);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore this item.");
    } finally {
      setBusy("");
    }
  }

  async function purge(type: "story" | "episode" | "material", item: TrashItem) {
    const confirmation = window.prompt(
      `Permanent deletion cannot be undone. Type the exact title “${item.title}” to confirm:`
    );
    if (confirmation !== item.title) {
      if (confirmation !== null) setError("The title did not match. Nothing was permanently deleted.");
      return;
    }
    setBusy(item.id);
    setError("");
    setNotice("");
    try {
      await request(`/creator/trash/${type}/${item.id}/purge`, { method: "DELETE" });
      setNotice(`“${item.title}” permanently deleted.`);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Permanent deletion was blocked.");
    } finally {
      setBusy("");
    }
  }

  function group(title: string, type: "story" | "episode" | "material", rows: TrashItem[]) {
    return (
      <section className="sf-trash-group" key={type}>
        <div className="studio-form-title"><span>{title}</span><small>{rows.length} IN TRASH</small></div>
        {!rows.length ? <p className="studio-sidebar-empty">Nothing here.</p> : rows.map(item => (
          <article className="sf-trash-row" key={item.id}>
            <div>
              <strong>{type === "episode" ? `${item.sequence_number}. ${item.title}` : item.title}</strong>
              <small>{type !== "story" ? item.story_title + " · " : ""}{item.deleted_from_status || "draft"} · Deleted {dateLabel(item.deleted_at)}</small>
            </div>
            <div className="sf-trash-actions">
              <button type="button" className="studio-outline-action" disabled={!!busy} onClick={() => void restore(type, item)}>Restore</button>
              <button type="button" className="studio-text-action sf-danger-action" disabled={!!busy} onClick={() => void purge(type, item)}>Delete permanently</button>
            </div>
          </article>
        ))}
      </section>
    );
  }

  const total = items.stories.length + items.episodes.length + items.materials.length;
  return (
    <section className="studio-content sf-trash">
      <div className="studio-section-heading">
        <div><p className="eyebrow">YOUR CONTENT, YOUR CONTROL</p><h2>Trash<span>.</span></h2><p className="studio-intro">Deleted stories and sections stay recoverable here. Permanent deletion is separate and may be blocked to protect reader records.</p></div>
        <button type="button" className="studio-outline-action" disabled={!!busy} onClick={() => void load()}>Refresh</button>
      </div>
      {error && <p className="studio-alert" role="alert">{error}</p>}
      {notice && <p className="studio-notice" role="status">{notice}</p>}
      {busy === "load" ? <div className="studio-loading">Loading Trash…</div> : total === 0 ? (
        <div className="studio-empty"><h3>Your Trash is empty.</h3><p>When you delete a story or section, it will appear here.</p></div>
      ) : (
        <>
          {group("STORIES", "story", items.stories)}
          {group("CHAPTERS & EPISODES", "episode", items.episodes)}
          {group("FRONT & BACK MATTER", "material", items.materials)}
        </>
      )}
    </section>
  );
}
