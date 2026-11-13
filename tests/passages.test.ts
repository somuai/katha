import test from "node:test";
import assert from "node:assert/strict";
import { selectPassages } from "../src/core/passages.ts";
const document =
  "[Page 1]\nIntroduction.\n\n[Page 44]\nIndividual Contribution Student: Alia Das Roll number: 100 Abstract: Project. Contribution and findings: I led the architecture and testing.\n\n[Page 45]\nIndividual Contribution Student: Bo Sen Roll number: 101 Abstract: Project. Contribution and findings: I wrote backend documentation.";
test("an explicit PDF page hint selects the requested page before lexical rankings", () => {
  const passage = selectPassages(
    document.replace(
      "I led the architecture and testing.",
      "I led the architecture and testing. " +
        "My contribution to this project involved careful architecture and testing. ".repeat(
          80,
        ),
    ),
    "I think it is there on page 44",
    900,
  );
  assert.match(passage, /Alia Das/);
  assert.match(passage, /architecture and testing/);
  assert.doesNotMatch(passage, /Bo Sen/);
});
test("a missing explicit page does not silently substitute another page", () => {
  const passage = selectPassages(document, "Check page 99", 700);
  assert.match(passage, /no extracted physical page 99/);
  assert.doesNotMatch(passage, /Alia|Bo Sen/);
});
test("a contribution question exposes the available authors rather than implying one excerpt is the only record", () => {
  const passage = selectPassages(
    document.replace(
      "I led the architecture and testing.",
      "I led the architecture and testing. " +
        "My contribution to this project involved careful architecture and testing. ".repeat(
          80,
        ),
    ),
    "what is my contribution in this project",
    700,
  );
  assert.match(passage, /Alia Das/);
  assert.match(passage, /Bo Sen/);
  assert.match(passage, /44/);
  assert.match(passage, /45/);
});
