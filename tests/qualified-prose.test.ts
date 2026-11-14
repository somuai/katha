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

test("an ordinary web explanation cannot silently turn into a historical comparison", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-answer-path-"));
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
      if (context.draft)
        return Response.json({
          choices: [{ message: { content: '{"supported":true,"issues":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      const id = context.evidence[0].id;
      const data =
        step++ === 0
          ? {
              text: "Basic costs one credit; advanced costs two.",
              citations: [id],
              comparisons: [
                {
                  claim: "Credit cost",
                  status: "CURRENTLY_MATCHES",
                  baselineSourceIds: [],
                  evidenceIds: [id],
                  explanation: "The credit amounts match.",
                },
              ],
            }
          : {
              text: "Basic costs one credit per request; advanced costs two.",
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
            title: "Credit policy",
            url: "https://example.com/credits",
            content:
              "Basic costs one credit per request. Advanced costs two credits per request.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "ordinary-explanation",
      expectedTailId: null,
      text: "Using the web, explain the credit costs of basic and advanced search.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /Basic costs one credit/);
    assert.doesNotMatch(snapshot.answer, /cannot establish a change/);
    assert.deepEqual(snapshot.comparisons, []);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a current-price explanation does not take the historical offer-comparison shortcut", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-current-price-"));
  const terms = (amount: number) =>
    `Alder Team: USD ${amount} per seat per month, billed monthly; region US; 5 seats; unlimited contacts; tax excluded.`;
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    fetcher: (async (_url, init) => {
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      if (context.draft)
        return Response.json({
          choices: [{ message: { content: '{"supported":true,"issues":[]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "The current quote is USD 25 per seat per month for five seats, monthly billing, US region, unlimited contacts and tax excluded.",
                citations: [context.evidence[0].id],
                comparisons: [],
              }),
            },
          },
        ],
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
            title: "Alder pricing",
            url: "https://example.com/pricing",
            content: terms(25),
          },
        ];
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Alder retained offer",
      content: terms(20),
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "current-price",
      expectedTailId: null,
      text: "Using the web, explain current pricing for Alder Team.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /current quote is USD 25/);
    assert.doesNotMatch(snapshot.answer, /changed|differs|20 to 25/);
    assert.deepEqual(snapshot.comparisons, []);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary web prose is checked for unsupported mechanics even without version markers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-billing-support-"));
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
          text: "Basic costs one credit; advanced costs two. Charges are deducted from a prepaid cash balance.",
          citations: [id],
          comparisons: [],
        },
        {
          supported: false,
          issues: [
            "The source establishes unit costs, not a prepaid cash-balance mechanism.",
          ],
        },
        {
          text: "Basic costs one credit per search; advanced costs two.",
          citations: [id],
          comparisons: [],
        },
        { supported: true, issues: [] },
      ];
      return Response.json({
        choices: [{ message: { content: JSON.stringify(outputs[step++]) } }],
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
            title: "Search credits",
            url: "https://example.com/credits",
            content:
              "Basic search costs one credit. Advanced search costs two credits.",
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "unsupported-mechanic",
      expectedTailId: null,
      text: "Using the web, explain the credit cost of basic and advanced search.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    assert.equal(snapshot.status, "COMPLETED");
    assert.match(snapshot.answer, /Basic costs one credit per search/);
    assert.doesNotMatch(snapshot.answer, /prepaid|cash balance/);
    assert.deepEqual(snapshot.trace.usage, {
      inputTokens: 40,
      outputTokens: 20,
    });
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
