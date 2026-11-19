import test from "node:test";
import assert from "node:assert/strict";
import { readableRunColour, parseColour, contrastRatio } from "../src/lib/run-colour.ts";

test("black and other neutral colours never override the theme", () => {
  for (const c of ["#000000", "#000", "black", "windowtext", "auto", "rgb(0, 0, 0)", "#222222", "#ffffff", "#808080"]) {
    assert.equal(readableRunColour(c, "night"), undefined, c);
    assert.equal(readableRunColour(c, "paper"), undefined, c);
  }
});

test("accent colours are kept only when readable on the theme", () => {
  assert.equal(readableRunColour("#c0392b", "paper"), "#c0392b");
  assert.equal(readableRunColour("#c0392b", "night"), "#c0392b");
  assert.equal(readableRunColour("#1a237e", "night"), undefined);
  assert.equal(readableRunColour("#fff3b0", "paper"), undefined);
});

test("missing or unparseable colours inherit", () => {
  assert.equal(readableRunColour(undefined, "paper"), undefined);
  assert.equal(readableRunColour("var(--x)", "paper"), undefined);
});

test("parse and contrast helpers", () => {
  assert.deepEqual(parseColour("#fff"), [255, 255, 255]);
  assert.ok(contrastRatio([0, 0, 0], [255, 255, 255]) > 20);
});
