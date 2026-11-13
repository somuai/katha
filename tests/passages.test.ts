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

test("passage budgets include separators", () => {
  assert.ok(
    selectPassages("match one.\n\nmatch two.\n\nmatch third.", "match", 25)
      .length <= 25,
  );
});
test("search URL boilerplate cannot outrank visible explanatory text", () => {
  const text =
    "[Edit page](https://docs.example/EventSource/connection/closed/restarted)\n\nBy default, a closed connection is restarted.";
  const result = selectPassages(
    text,
    "EventSource connection closed restarted site:docs.example",
    80,
  );
  assert.match(result, /By default, a closed connection is restarted/);
});
test("ordinary inflections match the relevant explanatory passage", () => {
  const text =
    "An EventSource has properties and methods.\n\nThe reconnection interval is the delay before a connection restarts.";
  const result = selectPassages(text, "How does it reconnects?", 70);
  assert.match(result, /reconnection interval/);
});

test("conceptual questions prefer the explanatory rule over incidental keywords in code", () => {
  const text =
    "```\nconst defaultConnection = closed; // connection closed default\n" +
    "performStep(); ".repeat(25) +
    "\n```\n\nBy default, a lost connection is restarted.";
  assert.match(
    selectPassages(text, "Explain connection closed default restart", 90),
    /By default, a lost connection is restarted/,
  );
});
