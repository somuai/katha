import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

test("an explicit valid Unicode inline reference supplies the requested citation without duplication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-inline-citation-"));
  let clock = 1000;
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const data = context.draft
        ? { supported: true, issues: [] }
        : {
            text: `The policy permits uploads. 【${context.evidence[0].id}】`,
            citations: [],
            comparisons: [],
          };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as typeof fetch,
  });
  const app = createKatha({
    directory,
    model: { generate: adapter.model.generate },
    search: {
      async search() {
        return [
          {
            title: "Upload policy",
            url: "https://example.com/policy",
            content: "The policy permits uploads.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "inline-only",
      expectedTailId: null,
      text: "Using the web, explain the upload policy. Cite evidence.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    const web = snapshot.sources.find((s) => s.kind === "web")!;
    assert.deepEqual(snapshot.citations, [{ sourceId: web.id }]);
    assert.deepEqual(snapshot.trace.usage, {
      inputTokens: 20,
      outputTokens: 10,
    });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unknown Unicode reference is rejected and repaired rather than silently presented", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-inline-unknown-"));
  const invented = "00000000-0000-4000-8000-000000000001";
  let clock = 1000,
    step = 0;
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const id = context.evidence[0].id;
      const data = context.draft
        ? { supported: true, issues: [] }
        : {
            text: `The policy permits uploads. 【${step++ ? id : invented}】`,
            citations: [id],
            comparisons: [],
          };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as typeof fetch,
  });
  const app = createKatha({
    directory,
    model: { generate: adapter.model.generate },
    search: {
      async search() {
        return [
          {
            title: "Upload policy",
            url: "https://example.com/policy",
            content: "The policy permits uploads.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "unknown-inline",
      expectedTailId: null,
      text: "Using the web, explain the upload policy. Cite evidence.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.doesNotMatch(snapshot.answer, new RegExp(invented));
    assert.deepEqual(snapshot.trace.usage, {
      inputTokens: 30,
      outputTokens: 15,
    });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("literal identifiers inside code examples are not interpreted as source references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-inline-code-"));
  const literal = "00000000-0000-4000-8000-000000000002";
  let clock = 1000;
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const text =
        "The policy permits uploads. Illustrative identifiers: `[" +
        literal +
        ']` and\n\n```json\n["' +
        literal +
        '"]\n```';
      const data = context.draft
        ? { supported: true, issues: [] }
        : { text, citations: [context.evidence[0].id], comparisons: [] };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as typeof fetch,
  });
  const app = createKatha({
    directory,
    model: { generate: adapter.model.generate },
    search: {
      async search() {
        return [
          {
            title: "Upload policy",
            url: "https://example.com/policy",
            content: "The policy permits uploads.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "literal-identifiers",
      expectedTailId: null,
      text: "Using the web, explain the upload policy and show an illustrative identifier example. Cite evidence.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, new RegExp(literal));
    assert.deepEqual(snapshot.trace.usage, {
      inputTokens: 20,
      outputTokens: 10,
    });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a source-prefixed inline citation cannot disguise an altered quotation", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-inline-quote-"));
  let clock = 1000;
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      const quote = context.question.includes("Quotation repair")
        ? "The policy permits uploads."
        : "The policy prohibits uploads.";
      const data = context.draft
        ? { supported: true, issues: [] }
        : {
            text: `“${quote}” [source: ${context.evidence[0].id}]`,
            citations: [],
            comparisons: [],
          };
      return Response.json({
        choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }) as typeof fetch,
  });
  const app = createKatha({
    directory,
    model: { generate: adapter.model.generate },
    search: {
      async search() {
        return [
          {
            title: "Upload policy",
            url: "https://example.com/policy",
            content: "The policy permits uploads.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "prefixed-quote",
      expectedTailId: null,
      text: "Using the web, explain the upload policy. Cite evidence.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /permits uploads/);
    assert.doesNotMatch(snapshot.answer, /prohibits/);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
