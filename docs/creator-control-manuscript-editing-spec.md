# STORYFLICKS Creator Control & Manuscript Editing — Implementation Specification

**Release:** Creator Control + Manuscript Editing  
**Branch:** `feature/creator-control-ai-patching`  
**Status:** In implementation; no production deployment or live-data changes are authorised by this branch.

## Product intent

Give an independent writer complete, understandable control over their story catalogue and manuscript, without requiring a new manuscript upload for every correction. AI is an editorial collaborator that proposes precise changes; the author remains the editor and publisher.

## A. Content lifecycle and deletion

### Creator-facing controls
- Add a dedicated **Manage / Trash** surface in Creator Studio.
- Allow deletion of:
  - A complete story.
  - An episode/chapter, whether draft, scheduled or published.
  - An individual draft revision.
  - A front/back-matter section.
- Published revisions are not independently deleted while they are the live edition. The creator deletes/withdraws the containing published episode, or publishes a replacement first.
- Each delete action names the exact story, section number/title, and content state. Never identify a record by sequence number alone.
- Deletion confirmation is contextual. For high-impact operations, require the creator to type the displayed title.
- Deleted stories and published sections move to **Trash** and can be restored. Draft-only revisions can be permanently removed after confirmation.
- Trash items can be permanently purged by the creator after a second explicit confirmation. If dependencies prevent a safe purge, explain the reason and keep the item in Trash.
- Restoring must revalidate sequence-number uniqueness. A conflict must be reported before any restore write; never renumber another chapter silently.
- Deleting a draft episode frees its sequence number so a later import can create the intended chapter number without collision.
- Deleting an episode/story must cancel scheduled publication and prevent reader access immediately.
- Preserve publication/audit history where possible. Do not cascade-delete reader contributions or financial records as an incidental side effect.

### Safety and data integrity
- All destructive actions are authenticated and re-check owner/author/editor access server-side.
- All mutations use stable UUIDs, not display numbers or titles.
- A delete/restore operation is transactional and idempotent.
- Every delete, restore and purge records actor, timestamp, entity, previous state and outcome.
- The API rejects deleting a published revision independently, deleting a revision that is queued for publication, cross-story IDs, stale revision IDs and sequence collisions.
- UI refreshes the workspace, dashboard, revision list and Trash after a successful operation.
- A deleted item must not be offered as an import destination or count towards the active chapter sequence.
- No automatic deletion or publication by AI.

## B. Manuscript editing without re-upload

### Direct editing
- Creator Studio provides a persistent chapter/episode editor for existing drafts and published chapters.
- Authors can edit title, synopsis and content blocks in place; add, remove, reorder and change block types; preserve paragraph boundaries, headings, quotes, separators, spacers, indentation, alignment and inline formatting.
- Saving creates a new draft revision. It never changes the currently published edition.
- Revision history supports opening, comparing, restoring as a new draft and deleting eligible draft revisions.
- A clear unsaved-changes state prevents accidental navigation loss.
- The editor must remain readable at the established Creator Studio text scale.

### AI targeted patches
- AI is available from the active manuscript editor, not only from the upload/import flow.
- The author can select text within a block or choose a whole block/section and give a natural-language instruction (e.g. “make this exchange sharper, keep the meaning and Kenyan voice”).
- AI receives only the selected text plus enough surrounding manuscript context to preserve continuity; it treats manuscript content as untrusted source material, not instructions.
- AI returns a structured patch: target block, exact original text, proposed replacement, concise rationale, and any uncertainty.
- The UI shows a before/after diff and offers **Apply patch** or **Reject**. No patch is applied automatically.
- Applying a patch changes the local editor buffer only. The author then reviews and saves it as a new draft revision.
- If the target text has changed since the patch was generated, reject the stale patch and ask AI to regenerate against the current text.
- AI must not alter neighbouring blocks, chapter identity, sequence number, publication status, or other sections unless the author explicitly selects them.
- Existing manuscript chat remains available for editorial discussion; patch generation is a separate structured action.

## C. Backend and platform requirements
- Keep the existing stack: Next.js Creator Studio, FastAPI on Render, Supabase Postgres/Auth/Storage, Gemini as the configured AI provider.
- Do not introduce a new agent runtime, queue service or additional paid infrastructure for this release.
- Use deterministic backend validation and database transactions for every write.
- Use the existing Gemini key already configured on Render; never expose it to the browser or request it from the author.
- AI endpoints return suggestions only. Existing save and publication endpoints remain the only way to persist/publish content.
- Apply database changes through a versioned Supabase migration; do not mutate production schema as part of branch development.

## D. Acceptance criteria
1. Creator can delete a draft revision and see it disappear from revision history after refresh.
2. Creator can delete a draft episode and reuse its former sequence number for a new episode.
3. Creator can delete a published episode; it disappears from the reader catalogue immediately and is recoverable from Trash.
4. Creator can delete a story; it disappears from public discovery and active creator lists and is recoverable from Trash.
5. Restore is safe, reports sequence conflicts, and never silently overwrites or renumbers another section.
6. Trash supports explicit permanent purge with safeguards and a clear explanation when purge is blocked by retained dependencies.
7. Existing published content remains unchanged when a new draft is saved.
8. Author can edit existing chapter text without uploading a new manuscript.
9. Author can request a targeted AI patch against selected text or a selected block.
10. AI patch preview displays exact before/after content; reject leaves the manuscript untouched; apply changes only the local draft buffer.
11. Saving an applied patch creates a new draft revision; publication still requires a separate explicit action.
12. Import workflow, formatting preservation, Story Structure, public reading, and existing revision history continue to work.
13. One integrated validation pass covers frontend typecheck/lint/build, backend compile/import and API tests, migration dry-run/security review, plus a full Creator Studio → reader flow.

## Release discipline
- Build in this single feature branch and produce one consolidated pull request.
- Do not merge, deploy Vercel/Render, apply the migration to the linked Supabase project, or modify live story data until the complete branch has passed checks and the creator explicitly approves the release.
