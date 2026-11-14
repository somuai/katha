import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

test("an optional presentation preference cannot block an explicit factual web question", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-optional-scope-"));
  const app = createKatha({
    directory,
    model: {
      async plan() {
        return {
          mode: "general",
          queries: [],
          clarification:
            "Would you like information about specific browsers or a general overview?",
        };
      },
      async generate(context) {
        assert.equal(context.verification, false);
        return {
          answer: "Microphone capture requires a secure context.",
          citations: context.evidence
            .filter((s) => s.kind === "web")
            .map((s) => ({ sourceId: s.id })),
        };
      },
    },
    search: {
      async search() {
        return [
          {
            title: "Microphone requirements",
            url: "https://example.com/microphone",
            content: "Microphone capture requires a secure context.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "general-question",
      expectedTailId: null,
      text: "Using the web, explain whether browser microphone capture requires a secure context.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /requires a secure context/);
    assert.doesNotMatch(snapshot.answer, /Would you like/);
    assert.equal(snapshot.trace.ignoredOptionalScopeClarification, true);
    assert.ok(snapshot.sources.some((s) => s.kind === "web"));
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing entity clarification still stops before search or generation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-required-entity-"));
  const app = createKatha({
    directory,
    model: {
      async plan() {
        return {
          mode: "current",
          queries: [],
          clarification: "Which product do you mean?",
        };
      },
      async generate() {
        throw Error("Cannot answer before the product is identified.");
      },
    },
    search: {
      async search() {
        throw Error("Cannot search an unidentified product.");
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "missing-entity",
      expectedTailId: null,
      text: "Using the web, explain current pricing for that product.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.equal(snapshot.answer, "Which product do you mean?");
    assert.equal(snapshot.trace.clarification, true);
    assert.equal(snapshot.trace.ignoredOptionalScopeClarification, undefined);
    assert.equal(
      snapshot.sources.some((s) => s.kind === "web"),
      false,
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
