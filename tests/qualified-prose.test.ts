import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

test("a version-qualified source repairs an overbroad web answer before publishing it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-prose-review-"));
  let clock = 1000,
    step = 0,
    sourceId = "";
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const packet = JSON.parse(String(init?.body));
      const context = JSON.parse(packet.messages[1].content);
      sourceId ||= context.evidence[0].id;
      const responses = [
        {
          text: "The fragment parameter is unavailable in basic search.",
          citations: [sourceId],
          comparisons: [],
        },
        {
          supported: false,
          issues: [
            "The source says basic now supports fragments; the answer repeats only the old restriction.",
          ],
        },
        {
          text: "Basic search now supports fragments. The parameter previously required advanced search.",
          citations: [sourceId],
          comparisons: [],
        },
        { supported: true, issues: [] },
      ];
      return Response.json({
        choices: [{ message: { content: JSON.stringify(responses[step++]) } }],
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
            title: "Search parameter history",
            url: "https://example.com/search-changelog",
            content:
              "The fragment parameter previously required advanced search. Now it also applies to basic search.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "qualification",
      expectedTailId: null,
      text: "Using the web, does the fragment parameter work in basic search?",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const result = await app.turns.get(receipt.turnId);
    assert.equal(result.status, "COMPLETED");
    assert.match(result.answer, /Basic search now supports/);
    assert.doesNotMatch(result.answer, /unavailable in basic/);
    assert.deepEqual(result.trace.usage, { inputTokens: 40, outputTokens: 20 });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a qualification review cannot spend a second repair after citation repair", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-prose-budget-"));
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
      const outputs = [
        {
          text: "The feature is unavailable.",
          citations: ["unknown-source"],
          comparisons: [],
        },
        {
          text: "The feature is unavailable.",
          citations: [id],
          comparisons: [],
        },
        {
          supported: false,
          issues: ["The draft treats a previous restriction as current."],
        },
      ];
      return Response.json({
        choices: [{ message: { content: JSON.stringify(outputs[step++]) } }],
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
            title: "Feature history",
            url: "https://example.com/history",
            content:
              "The feature was previously unavailable. It is now enabled.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "one-repair",
      expectedTailId: null,
      text: "Use the web to explain whether the feature is available.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "FAILED");
    assert.equal(snapshot.answer, "");
    assert.match(snapshot.error || "", /after one repair/);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("quota waiting resumes an unpublished draft's review without generating it again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-prose-quota-"));
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
      if (step++ === 0)
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "The feature is now enabled; it was previously unavailable.",
                  citations: [context.evidence[0].id],
                  comparisons: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      assert.equal(
        context.draft,
        "The feature is now enabled; it was previously unavailable.",
      );
      if (step === 2)
        return Response.json(
          { error: { message: "Please try again in 1s." } },
          { status: 429, headers: { "Retry-After": "1" } },
        );
      return Response.json({
        choices: [{ message: { content: '{"supported":true,"issues":[]}' } }],
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
            title: "Feature history",
            url: "https://example.com/history",
            content:
              "The feature was previously unavailable. It is now enabled.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "review-wait",
      expectedTailId: null,
      text: "Use the web to explain whether the feature is available.",
    });
    const statuses = [];
    for await (const event of app.turns.events(receipt.turnId)) {
      if (event.type === "status") statuses.push((event.data as any).status);
      if (event.type === "complete") break;
    }
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /now enabled/);
    assert.ok(statuses.includes("WAITING_FOR_QUOTA"));
    assert.deepEqual(snapshot.trace.usage, {
      inputTokens: 20,
      outputTokens: 10,
    });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Stop cancels source review without publishing the draft", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-prose-cancel-"));
  let clock = 1000,
    step = 0;
  let began!: () => void;
  const reviewing = new Promise<void>((resolve) => {
    began = resolve;
  });
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      if (step++ === 0) {
        const context = JSON.parse(
          JSON.parse(String(init?.body)).messages[1].content,
        );
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "An unpublished draft.",
                  citations: [context.evidence[0].id],
                  comparisons: [],
                }),
              },
            },
          ],
        });
      }
      began();
      return await new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          "abort",
          () => reject(init!.signal!.reason),
          { once: true },
        );
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
            title: "Feature history",
            url: "https://example.com/history",
            content:
              "The feature was previously unavailable. It is now enabled.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "stop-review",
      expectedTailId: null,
      text: "Use the web to explain whether the feature is available.",
    });
    await reviewing;
    const cancelled = await app.turns.cancel(receipt.turnId);
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.answer, "");
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.some(
        (m) => m.role === "assistant",
      ),
      false,
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
