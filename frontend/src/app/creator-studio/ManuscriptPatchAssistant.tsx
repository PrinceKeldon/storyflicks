"use client";

import { useEffect, useState, type FormEvent } from "react";

type Block = { type: string; text: string; [key: string]: unknown };
type Target = { blockIndex: number; start: number; end: number; text: string };
type Proposal = { replacement: string; rationale: string; model: string };
type Props = {
  storyId: string;
  storyTitle: string;
  sectionTitle: string;
  blocks: Block[];
  target: Target | null;
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  onApply: (target: Target, replacement: string) => boolean;
  onClearTarget: () => void;
};

export default function ManuscriptPatchAssistant({
  storyId, storyTitle, sectionTitle, blocks, target, request, onApply, onClearTarget,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setProposal(null);
    setError("");
    setNotice("");
  }, [target?.blockIndex, target?.start, target?.end, target?.text]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!target || !instruction.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    setProposal(null);
    try {
      const before = blocks.slice(Math.max(0, target.blockIndex - 2), target.blockIndex)
        .map(block => block.text).join("\n\n");
      const after = blocks.slice(target.blockIndex + 1, target.blockIndex + 3)
        .map(block => block.text).join("\n\n");
      const data = await request(`/creator/stories/${storyId}/manuscript/patch`, {
        method: "POST",
        body: JSON.stringify({
          story_title: storyTitle,
          section_title: sectionTitle,
          target_text: target.text,
          instruction: instruction.trim(),
          before_context: before,
          after_context: after,
        }),
      }) as Proposal;
      setProposal(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI could not prepare this edit.");
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!target || !proposal) return;
    if (!onApply(target, proposal.replacement)) {
      setError("The selected passage changed after this proposal was generated. Select the current text and ask AI again.");
      setProposal(null);
      return;
    }
    setNotice("Patch applied to the editor only. Review the manuscript and save a new draft revision when ready.");
    setProposal(null);
    setInstruction("");
    onClearTarget();
  }

  return (
    <section className="sf-ai-patch">
      <div className="studio-form-title"><span>AI EDITORIAL PATCH</span><small>AUTHOR APPROVAL REQUIRED</small></div>
      <p className="studio-intro">Select text in a manuscript block, or use “Ask AI to edit this block”. AI will propose a replacement for that passage only.</p>
      {target ? (
        <>
          <div className="sf-ai-patch-target"><small>SELECTED PASSAGE · BLOCK {target.blockIndex + 1}</small><p>{target.text}</p><button type="button" className="studio-text-action" onClick={onClearTarget}>Clear selection</button></div>
          <form onSubmit={generate}>
            <label>What should change?<textarea rows={3} maxLength={2000} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="e.g. Tighten the dialogue, keep the character's voice and do not change the meaning." required/></label>
            <div className="studio-form-actions"><button type="submit" className="studio-primary" disabled={busy || !instruction.trim()}>{busy ? "Preparing edit…" : "Generate proposed edit ↗"}</button></div>
          </form>
        </>
      ) : <p className="studio-sidebar-empty">No passage selected yet. Highlight a sentence in the editor or choose a whole block.</p>}
      {error && <p className="studio-alert" role="alert">{error}</p>}
      {notice && <p className="studio-notice" role="status">{notice}</p>}
      {proposal && target && (
        <div className="sf-ai-patch-preview">
          <div><small>BEFORE</small><p>{target.text}</p></div>
          <div><small>PROPOSED REPLACEMENT</small><p>{proposal.replacement}</p></div>
          <p className="sf-ai-patch-rationale">{proposal.rationale}</p>
          <div className="studio-form-actions">
            <button type="button" className="studio-primary" onClick={apply}>Apply patch to editor</button>
            <button type="button" className="studio-text-action" onClick={() => setProposal(null)}>Reject proposal</button>
          </div>
          <small>Model: {proposal.model}. Nothing is saved or published until you save a draft revision yourself.</small>
        </div>
      )}
    </section>
  );
}
