"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

type Edit = { block_index: number; old_text: string; new_text: string; reason?: string; context_before?: string; context_after?: string };
type Change = { episode_id: string; title: string; from_number: number; to_number: number };
type ProposalItem = {
  id: string; kind: string; status: string; title: string; rationale: string; episode_id: string | null; error?: string | null;
  payload: {
    chapter_title?: string; sequence_number?: number; edits?: Edit[];
    review_headline?: string; review_excerpt?: string; body?: string; changes?: Change[];
  };
};
type Activity = { tool: string; summary: string };
type Source = { title: string; url: string };
type Message = { id: string; role: "user" | "model"; content: string; tool_activity?: Activity[]; sources?: Source[]; proposals?: ProposalItem[] };
type Props = {
  storyId: string;
  stories: { id: string; title: string }[];
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onApplied: () => void | Promise<void>;
};

const SUGGESTIONS = [
  "Give me an overview of how this story is doing.",
  "Check chapter 1 for typos and awkward sentences, and propose fixes.",
  "Draft replies to my newest reader reviews.",
  "Check my chapter numbering for gaps or duplicates and propose a fix.",
  "Summarise what readers are saying in recent reviews.",
  "Search the manuscript for inconsistencies in character names.",
];

function EditDiff({ edit }: { edit: Edit }) {
  return (
    <div className="sf-agent-edit">
      <small>BLOCK {edit.block_index + 1}{edit.reason ? ` · ${edit.reason}` : ""}</small>
      <p>
        {edit.context_before}
        {edit.old_text && <del>{edit.old_text}</del>}
        {edit.new_text && <ins>{edit.new_text}</ins>}
        {edit.context_after}
      </p>
    </div>
  );
}

function ProposalCard({ proposal, request, onChange, onApplied }: {
  proposal: ProposalItem; request: Props["request"];
  onChange: (id: string, patch: Partial<ProposalItem>) => void; onApplied: Props["onApplied"];
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const edits = proposal.payload.edits ?? [];
  const changes = proposal.payload.changes ?? [];
  const approveLabel = proposal.kind === "review_reply" ? "Approve and post this reply"
    : proposal.kind === "chapter_renumber" ? `Approve ${changes.length} renumbering${changes.length === 1 ? "" : "s"}`
    : `Approve ${edits.length} change${edits.length === 1 ? "" : "s"} · save as draft`;
  const savedLabel = proposal.kind === "review_reply" ? "Reply posted." : proposal.kind === "chapter_renumber" ? "Chapters renumbered." : "Saved as a new draft revision.";

  async function decide(kind: "approve" | "reject") {
    setBusy(kind);
    setError("");
    try {
      const result = (await request(`/creator/agent/proposals/${proposal.id}/${kind}`, { method: "POST" })) as { status: string; message?: string };
      onChange(proposal.id, { status: result.status });
      if (result.message) setNote(result.message);
      if (kind === "approve" && proposal.kind !== "review_reply") await onApplied();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      if (/changed since|already|no longer/i.test(message)) onChange(proposal.id, { status: /changed since/i.test(message) ? "stale" : proposal.status });
    } finally {
      setBusy("");
    }
  }

  return (
    <article className={`sf-agent-proposal sf-agent-proposal-${proposal.status}`}>
      <header>
        <strong>{proposal.title}</strong>
        <small>{proposal.kind === "chapter_renumber" ? "CHAPTER NUMBERS" : `${proposal.payload.sequence_number ? `CHAPTER ${proposal.payload.sequence_number} · ` : ""}${(proposal.payload.chapter_title ?? "").toUpperCase()}`} · {proposal.status.toUpperCase()}</small>
      </header>
      {proposal.rationale && <p className="sf-agent-rationale">{proposal.rationale}</p>}
      {edits.map((edit, index) => <EditDiff key={index} edit={edit} />)}
      {proposal.kind === "review_reply" && (
        <div className="sf-agent-edit">
          <small>READER REVIEW{proposal.payload.review_headline ? ` · ${proposal.payload.review_headline}` : ""}</small>
          <p>{proposal.payload.review_excerpt}</p>
          <small>YOUR REPLY</small>
          <p><ins>{proposal.payload.body}</ins></p>
        </div>
      )}
      {changes.map(change => (
        <div className="sf-agent-edit" key={change.episode_id}>
          <p><del>{change.from_number}</del> <ins>{change.to_number}</ins> · {change.title}</p>
        </div>
      ))}
      {proposal.status === "pending" && (
        <div className="studio-form-actions">
          <button type="button" className="studio-primary" disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? "Working…" : approveLabel}</button>
          <button type="button" className="studio-text-action" disabled={!!busy} onClick={() => decide("reject")}>{busy === "reject" ? "Rejecting…" : "Reject"}</button>
        </div>
      )}
      {proposal.status === "applied" && <p className="studio-notice">{note || savedLabel}</p>}
      {proposal.status === "stale" && <p className="studio-alert">Things changed after this was proposed, so nothing was applied. Ask the assistant to propose it again.</p>}
      {proposal.status === "failed" && <p className="studio-alert">{proposal.error || "This could not be applied."}</p>}
      {error && <p className="studio-alert" role="alert">{error}</p>}
    </article>
  );
}

export default function AgentPanel({ storyId, stories, request, onApplied }: Props) {
  const [selectedTitleId, setSelectedTitleId] = useState(storyId || "general");
  const selectedTitle = stories.find(story => story.id === selectedTitleId) ?? null;
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Each conversation is scoped to the selected title, or to the general workspace.
  useEffect(() => {
    setMessages([]);
    setConversationId(null);
    setError("");
  }, [selectedTitleId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const updateProposal = useCallback((id: string, patch: Partial<ProposalItem>) => {
    setMessages(current => current.map(message => message.proposals
      ? { ...message, proposals: message.proposals.map(p => (p.id === id ? { ...p, ...patch } : p)) }
      : message));
  }, []);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setDraft("");
    setMessages(current => [...current, { id: `u-${Date.now()}`, role: "user", content: message }]);
    try {
      const data = (await request("/creator/agent/chat", {
        method: "POST",
        body: JSON.stringify({ message, story_id: selectedTitleId === "general" ? null : selectedTitleId, conversation_id: conversationId }),
      })) as { conversation_id: string; reply: string; tool_activity: Activity[]; sources: Source[]; proposals: ProposalItem[] };
      setConversationId(data.conversation_id);
      setMessages(current => [...current, {
        id: `m-${Date.now()}`, role: "model", content: data.reply,
        tool_activity: data.tool_activity, sources: data.sources, proposals: data.proposals,
      }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The assistant could not answer.");
      setDraft(message);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <section className="studio-content sf-agent">
      <div className="studio-workspace-select sf-agent-context"><label htmlFor="sf-agent-title">WORKING CONTEXT<select id="sf-agent-title" value={selectedTitleId} onChange={event => setSelectedTitleId(event.target.value)}><option value="general">General — all titles / uncategorised</option>{stories.map(story => <option key={story.id} value={story.id}>{story.title}</option>)}</select></label><small>{selectedTitle ? `Focused on ${selectedTitle.title}` : "General workspace context"}</small></div>
      <div className="studio-section-heading"><div>
        <p className="eyebrow">YOUR EDITOR AND ASSISTANT</p>
        <h2>Studio assistant<span>.</span></h2>
        <p className="studio-intro">{selectedTitle ? <>Ask about “{selectedTitle.title}”: statistics, reviews, continuity, research, or edits.</> : <>Ask general questions across your creator workspace, or choose a title above for title-specific statistics, reviews, continuity, research, and edits.</>} It never changes a chapter on its own — every edit is shown here first, and saved as a new draft only when you approve it.</p>
      </div></div>

      <div className="sf-agent-thread" aria-live="polite">
        {!messages.length && (
          <div className="sf-agent-suggestions">
            {SUGGESTIONS.map(text => <button key={text} type="button" className="studio-text-action" onClick={() => void send(text)} disabled={busy}>{text}</button>)}
          </div>
        )}
        {messages.map(message => (
          <div key={message.id} className={`sf-agent-message sf-agent-${message.role}`}>
            <small>{message.role === "user" ? "YOU" : "ASSISTANT"}</small>
            <p>{message.content}</p>
            {!!message.tool_activity?.length && (
              <details><summary>What the assistant did ({message.tool_activity.length})</summary>
                <ul>{message.tool_activity.map((a, i) => <li key={i}>{a.summary}</li>)}</ul>
              </details>
            )}
            {!!message.sources?.length && (
              <div className="sf-agent-sources"><small>WEB SOURCES</small>
                <ul>{message.sources.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}</ul>
              </div>
            )}
            {message.proposals?.map(p => <ProposalCard key={p.id} proposal={p} request={request} onChange={updateProposal} onApplied={onApplied} />)}
          </div>
        ))}
        {busy && <p className="studio-sidebar-empty">The assistant is working — reading, searching and checking. This can take a minute…</p>}
        <div ref={endRef} />
      </div>

      {error && <p className="studio-alert" role="alert">{error}</p>}
      <form className="sf-agent-form" onSubmit={submit}>
        <textarea value={draft} maxLength={4000} rows={3} placeholder="Ask a question or give an instruction…" onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(draft); } }} />
        <div className="studio-form-actions">
          <button type="submit" className="studio-primary" disabled={busy || !draft.trim()}>{busy ? "Working…" : "Send ↗"}</button>
          <small>Ctrl/⌘ + Enter to send</small>
        </div>
      </form>
    </section>
  );
}
