import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";

test("model-visible web excerpts retain the relevant exception branch from the stored source", async () => {
  const capture = JSON.parse(
    readFileSync(
      new URL(
        "../docs/evaluations/current-default-reviewed.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const record = capture.results.find((r: any) => r.id === "web-07");
  const original = record.snapshot.sources.find(
    (s: any) =>
      s.title === "MediaDevices: getUserMedia() method - Web APIs | MDN",
  );
  assert.ok(original.content.includes("TypeError"));
  const directory = mkdtempSync(join(tmpdir(), "katha-web-qualifier-"));
  let clock = 1000;
  const visible: string[] = [];
  const adapter = createKathaAdapters({
    groqKey: "fixture",
    clock: () => clock,
    fetcher: (async (_url, init) => {
      clock += 2000;
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      visible.push(context.evidence[0].text);
      const data = context.draft
        ? { supported: true, issues: [] }
        : {
            text: "A secure context is required. In insecure contexts mediaDevices may be unavailable, and calling an unavailable method can cause TypeError.",
            citations: [context.evidence[0].id],
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
            title: original.title,
            url: original.metadata.url,
            content: original.content,
          },
        ];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "preserve-branch",
      expectedTailId: null,
      text: "Using the web, explain whether browser microphone capture requires a secure context.",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    for (const excerpt of visible) {
      assert.match(excerpt, /TypeError/);
      assert.match(excerpt, /NotAllowedError/);
      assert.match(excerpt, /secure contexts/);
      assert.ok(excerpt.length <= 900);
    }
    assert.equal((await app.turns.get(receipt.turnId)).status, "COMPLETED");
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
