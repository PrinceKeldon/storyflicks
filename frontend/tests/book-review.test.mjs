import test from "node:test";
import assert from "node:assert/strict";
import { analyseBook, countWords } from "../src/lib/book-review.ts";

const text = (n) => ({ blocks: [{ type: "paragraph", text: Array.from({ length: n }, (_, i) => "word" + i).join(" ") }] });
const ep = (id, n, title, status = "published", extra = {}) => ({ id, sequence_number: n, title, synopsis: "A synopsis", content: text(200), publication_status: status, ...extra });
const story = { title: "Crossing Ubuntu", tagline: "t", synopsis: "s", genres: ["Drama"] };
const ids = (review) => review.issues.map((i) => i.id);

test("counts words in either content shape", () => {
  assert.equal(countWords(text(5)), 5);
  assert.equal(countWords([{ type: "paragraph", text: "one two" }]), 2);
  assert.equal(countWords(null), 0);
});

test("a clean book has no fix or check issues and orders front, chapters, back", () => {
  const review = analyseBook(story, "cover.jpg", [ep("b", 2, "Two"), ep("a", 1, "One")],
    [{ id: "m1", title: "Dedication", section_type: "dedication", placement: "front_matter", position: 0, content: text(10), publication_status: "published", is_visible: true },
     { id: "m2", title: "Afterword", section_type: "afterword", placement: "back_matter", position: 0, content: text(10), publication_status: "published", is_visible: true }]);
  assert.deepEqual(review.issues.filter((i) => i.level !== "info"), []);
  assert.deepEqual(review.items.map((i) => i.title), ["Dedication", "One", "Two", "Afterword"]);
  assert.equal(review.totals.chapters, 2);
  assert.equal(review.totals.words, 420);
});

test("flags numbering gaps, empty and short chapters, missing synopsis, duplicate titles", () => {
  const review = analyseBook(story, "c", [
    ep("a", 1, "Same"), ep("b", 3, "Same", "published", { synopsis: "" }),
    ep("c", 4, "Empty", "published", { content: { blocks: [] } }), ep("d", 5, "Short", "published", { content: text(20) })], []);
  const found = ids(review);
  assert.ok(found.includes("numbering-gaps"));
  assert.ok(found.includes("syn-b"));
  assert.ok(found.includes("dup-b"));
  assert.ok(found.includes("empty-c"));
  assert.ok(found.includes("short-d"));
  assert.equal(review.issues[0].level, "fix");
});

test("warns when a live chapter follows an unpublished one", () => {
  const review = analyseBook(story, "c", [ep("a", 1, "One"), ep("b", 2, "Two", "draft"), ep("c", 3, "Three")], []);
  assert.ok(ids(review).includes("gap-c"));
  assert.equal(review.totals.draft, 1);
});

test("counts ready-for-review drafts separately", () => {
  const review = analyseBook(story, "c", [ep("a", 1, "One", "draft", { ready_for_review: true }), ep("b", 2, "Two", "draft")], []);
  assert.equal(review.totals.ready, 1);
  assert.equal(review.totals.draft, 1);
  assert.equal(review.items[0].status, "ready for review");
});

test("notes a repeated title line and checks story basics and hidden material", () => {
  const withTitle = ep("a", 1, "A Deadly Ambush", "published", { content: { blocks: [{ type: "paragraph", text: "A Deadly Ambush" }, ...text(150).blocks] } });
  const review = analyseBook({ title: "T", genres: [] }, null, [withTitle],
    [{ id: "m", title: "Foreword", section_type: "foreword", placement: "front_matter", position: 0, content: text(5), publication_status: "draft", is_visible: false }]);
  const found = ids(review);
  for (const id of ["title-a", "story-cover", "story-synopsis", "story-genres", "mat-hidden-m"]) assert.ok(found.includes(id), id);
});

test("no chapters is a blocking issue", () => {
  assert.equal(analyseBook(story, "c", [], []).issues[0].id, "no-chapters");
});
