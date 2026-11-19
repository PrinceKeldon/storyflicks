import test from "node:test";
import assert from "node:assert/strict";
import { cleanChapterTitle, splitChapterTitle } from "../src/lib/chapter-title.ts";

const p = (text, type = "paragraph") => ({ type, text });

test("cleans chapter labels", () => {
  assert.equal(cleanChapterTitle("Chapter 1: A Deadly Ambush"), "A Deadly Ambush");
  assert.equal(cleanChapterTitle("3. The Road"), "The Road");
  assert.equal(cleanChapterTitle("A Deadly Ambush"), "A Deadly Ambush");
});

test("removes a leading heading and returns it as the title", () => {
  const out = splitChapterTitle([p("Chapter 1: A Deadly Ambush", "heading"), p("The dust rose."), p("He ran.")], "");
  assert.equal(out.title, "A Deadly Ambush");
  assert.equal(out.removed, true);
  assert.equal(out.blocks.length, 2);
  assert.equal(out.blocks[0].text, "The dust rose.");
});

test("removes a plain paragraph that repeats the current title", () => {
  const out = splitChapterTitle([p(""), p("A Deadly Ambush"), p("The dust rose.")], "A Deadly Ambush");
  assert.equal(out.removed, true);
  assert.equal(out.blocks[0].text, "The dust rose.");
});

test("handles a label line followed by the real title", () => {
  const out = splitChapterTitle([p("CHAPTER 1"), p("A Deadly Ambush"), p("The dust rose.")], "");
  assert.equal(out.title, "A Deadly Ambush");
  assert.equal(out.blocks[0].text, "The dust rose.");
});

test("leaves an ordinary opening paragraph alone", () => {
  const blocks = [p("The dust rose over the valley and he began to run."), p("Later.")];
  const out = splitChapterTitle(blocks, "A Deadly Ambush");
  assert.equal(out.removed, false);
  assert.equal(out.blocks, blocks);
});

test("never empties the chapter", () => {
  const out = splitChapterTitle([p("A Deadly Ambush", "heading")], "");
  assert.equal(out.removed, true);
  assert.equal(out.blocks.length, 1);
});
