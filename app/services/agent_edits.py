"""Exact-text edits to chapter content, with inline-formatting preservation.

Pure functions only (no network or database access) so the logic that decides
what happens to an author's text is easy to test. The run-splitting rules
mirror the Creator Studio's own patch logic (studio.tsx applyManuscriptPatch):
text is replaced inside the run that holds it, so bold/italic/etc. survive, and
a block whose runs no longer match its text falls back to plain text.
"""

import copy
import hashlib
import json
from typing import Any

MAX_EDITS_PER_PROPOSAL = 40
MAX_EDIT_TEXT = 20000
CONTEXT_CHARS = 60


class EditError(ValueError):
    """An edit cannot be applied exactly as written."""


def content_hash(content: Any) -> str:
    """Stable fingerprint of chapter content, to detect changes since a proposal."""
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def content_blocks(content: Any) -> list[dict[str, Any]]:
    blocks = content.get("blocks") if isinstance(content, dict) else None
    if not isinstance(blocks, list):
        return []
    return [block for block in blocks if isinstance(block, dict)]


def replace_in_block(block: dict[str, Any], old_text: str, new_text: str) -> dict[str, Any]:
    """Return a copy of `block` with the one occurrence of `old_text` replaced."""
    text = block.get("text")
    if not isinstance(text, str):
        raise EditError("This block has no text to edit.")
    if not old_text:
        raise EditError("old_text must not be empty.")
    start = text.find(old_text)
    if start == -1:
        raise EditError("old_text was not found in that block. It must match the current text exactly.")
    # Count overlapping matches too: "go go" occurs twice in "go go go", and
    # str.count() would report one, letting an ambiguous edit through.
    occurrences = 1
    probe = text.find(old_text, start + 1)
    while probe != -1:
        occurrences += 1
        probe = text.find(old_text, probe + 1)
    if occurrences > 1:
        raise EditError(
            f"old_text appears {occurrences} times in that block. Include more surrounding words so it matches exactly once."
        )

    end = start + len(old_text)
    next_text = text[:start] + new_text + text[end:]
    result = copy.deepcopy(block)

    runs = block.get("runs")
    if not isinstance(runs, list) or not runs:
        result["text"] = next_text
        return result

    source_runs = [run for run in runs if isinstance(run, dict)]
    if len(source_runs) != len(runs) or "".join(str(run.get("text", "")) for run in source_runs) != text:
        # Formatting runs no longer describe this text, so keep the text and drop them.
        result["text"] = next_text
        result.pop("runs", None)
        return result

    next_runs: list[dict[str, Any]] = []
    inserted = False
    offset = 0
    for run in source_runs:
        value = str(run.get("text", ""))
        run_start, run_end = offset, offset + len(value)
        offset = run_end
        if run_end <= start:
            next_runs.append(copy.deepcopy(run))
            continue
        if run_start >= end:
            if not inserted:
                if new_text:
                    next_runs.append({**copy.deepcopy(run), "text": new_text})
                inserted = True
            next_runs.append(copy.deepcopy(run))
            continue
        prefix = value[: max(0, start - run_start)]
        suffix = value[max(0, end - run_start):]
        if prefix:
            next_runs.append({**copy.deepcopy(run), "text": prefix})
        if not inserted:
            if new_text:
                next_runs.append({**copy.deepcopy(run), "text": new_text})
            inserted = True
        if suffix:
            next_runs.append({**copy.deepcopy(run), "text": suffix})
    if not inserted and new_text:
        next_runs.append({"text": new_text})

    result["text"] = "".join(str(run.get("text", "")) for run in next_runs)
    result["runs"] = next_runs
    return result


def validate_edits(raw_edits: Any) -> list[dict[str, Any]]:
    """Check the shape and size of a model-supplied edit list."""
    if not isinstance(raw_edits, list) or not raw_edits:
        raise EditError("edits must be a non-empty list.")
    if len(raw_edits) > MAX_EDITS_PER_PROPOSAL:
        raise EditError(f"At most {MAX_EDITS_PER_PROPOSAL} edits can be proposed at once. Split the work into several proposals.")
    edits: list[dict[str, Any]] = []
    for position, raw in enumerate(raw_edits, start=1):
        if not isinstance(raw, dict):
            raise EditError(f"Edit {position} must be an object.")
        index, old_text, new_text = raw.get("block_index"), raw.get("old_text"), raw.get("new_text")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise EditError(f"Edit {position}: block_index must be a zero-based integer.")
        if not isinstance(old_text, str) or not old_text:
            raise EditError(f"Edit {position}: old_text must be a non-empty string.")
        if not isinstance(new_text, str):
            raise EditError(f"Edit {position}: new_text must be a string (use an empty string to delete).")
        if len(old_text) > MAX_EDIT_TEXT or len(new_text) > MAX_EDIT_TEXT:
            raise EditError(f"Edit {position}: old_text and new_text must each be {MAX_EDIT_TEXT} characters or fewer.")
        if old_text == new_text:
            raise EditError(f"Edit {position}: new_text is identical to old_text.")
        edits.append({
            "block_index": index,
            "old_text": old_text,
            "new_text": new_text,
            "reason": str(raw.get("reason") or "")[:500],
        })
    return edits


def apply_edits(content: dict[str, Any], edits: list[dict[str, Any]]) -> dict[str, Any]:
    """Return new chapter content with every edit applied; the input is untouched.

    Edits are applied in order, so a later edit sees the text left by an earlier
    one in the same block. Any edit that cannot be applied exactly raises
    EditError naming it, and nothing is returned.
    """
    blocks = content_blocks(content)
    new_blocks = copy.deepcopy(content.get("blocks", [])) if isinstance(content, dict) else []
    # Map filtered block positions back to positions in the stored list.
    positions = [i for i, block in enumerate(new_blocks) if isinstance(block, dict)]
    if len(positions) != len(blocks):
        raise EditError("Chapter content has an unexpected structure.")

    for number, edit in enumerate(edits, start=1):
        index = edit["block_index"]
        if index >= len(positions):
            raise EditError(f"Edit {number}: block {index} does not exist (the chapter has {len(positions)} blocks).")
        slot = positions[index]
        try:
            new_blocks[slot] = replace_in_block(new_blocks[slot], edit["old_text"], edit["new_text"])
        except EditError as exc:
            raise EditError(f"Edit {number} (block {index}): {exc}") from exc

    return {**content, "blocks": new_blocks}


def add_context(content: dict[str, Any], edits: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach a little surrounding text to each edit so the author can see where it lands."""
    blocks = content_blocks(content)
    enriched = []
    for edit in edits:
        text = blocks[edit["block_index"]].get("text", "") if edit["block_index"] < len(blocks) else ""
        position = text.find(edit["old_text"])
        before = text[max(0, position - CONTEXT_CHARS): max(0, position)] if position >= 0 else ""
        after_start = position + len(edit["old_text"]) if position >= 0 else 0
        after = text[after_start: after_start + CONTEXT_CHARS] if position >= 0 else ""
        enriched.append({**edit, "context_before": before, "context_after": after})
    return enriched
