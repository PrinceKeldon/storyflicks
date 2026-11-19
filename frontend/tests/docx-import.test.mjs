import test from "node:test";
import assert from "node:assert/strict";
import { onOffNode, wordAttribute } from "../src/lib/docx-import.ts";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OTHER_NS = "urn:example:other";

function element(attributes) {
  return {
    attributes: attributes.map(({ namespaceURI, localName, value }) => ({
      namespaceURI: namespaceURI ?? null,
      localName,
      value,
    })),
    getAttributeNS(namespaceURI, name) {
      return attributes.find((attribute) =>
        (attribute.namespaceURI ?? null) === namespaceURI && attribute.localName === name
      )?.value ?? null;
    },
    getAttribute(name) {
      return attributes.find((attribute) =>
        !attribute.namespaceURI && attribute.localName === name
      )?.value ?? null;
    },
  };
}

test("reads WordprocessingML attributes regardless of the namespace prefix", () => {
  const node = element([{ namespaceURI: WORD_NS, localName: "val", value: "0" }]);
  assert.equal(wordAttribute(node, "val"), "0");
});

test("prefers the Word namespace when a same-named unqualified attribute exists", () => {
  const node = element([
    { namespaceURI: null, localName: "val", value: "1" },
    { namespaceURI: WORD_NS, localName: "val", value: "0" },
  ]);
  assert.equal(wordAttribute(node, "val"), "0");
});

test("supports genuinely unqualified attributes as a compatibility fallback", () => {
  const node = element([{ namespaceURI: null, localName: "left", value: "720" }]);
  assert.equal(wordAttribute(node, "left"), "720");
});

test("does not mistake a foreign-namespace attribute for a Word attribute", () => {
  const node = element([{ namespaceURI: OTHER_NS, localName: "val", value: "0" }]);
  assert.equal(wordAttribute(node, "val"), null);
});

test("interprets explicit Word formatting-off values as false", () => {
  for (const value of ["0", "false", "none", "nil"]) {
    assert.equal(onOffNode(element([{ namespaceURI: WORD_NS, localName: "val", value }])), false);
  }
});

test("interprets an enabled Word on/off element as true and an absent element as undefined", () => {
  assert.equal(onOffNode(element([{ namespaceURI: WORD_NS, localName: "val", value: "1" }])), true);
  assert.equal(onOffNode(null), undefined);
});
