import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
const setup = (options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "katha-test-"));
  const app = createKatha({ directory, ...options });
  return {
    app,
    cleanup: () => {
      app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
};
const wait = async (app: any, id: string) => {
  for (let i = 0; i < 100; i++) {
    const turn = await app.turns.get(id);
    if (
      ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "INTERRUPTED"].includes(
        turn.status,
      )
    )
      return turn;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Turn did not terminate");
};

test("duplicate submission returns one durable user message even with a stale tail", async () => {
  const { app, cleanup } = setup();
  try {
    const chat = await app.workspace.createConversation();
    const input = {
      conversationId: chat.id,
      clientRequestId: "one",
      expectedTailId: null,
      text: "Hello",
    };
    const a = await app.turns.start(input);
    const b = await app.turns.start(input);
    assert.equal(a.turnId, b.turnId);
    assert.equal(
      (await app.workspace.getConversation(chat.id)).messages.filter(
        (x: any) => x.role === "user",
      ).length,
      1,
    );
    await assert.rejects(app.turns.start({ ...input, text: "Different" }), {
      code: "REQUEST_CONFLICT",
    });
  } finally {
    cleanup();
  }
});

test("an imported date is recalled using the local calendar rather than upload time", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-11T12:00:00Z"),
  });
  try {
    const source = await app.evidence.import({
      name: "Monday shortlist",
      content: "We shortlisted Attio and Pipedrive.",
      occurredAt: "2026-11-03",
      timezone: "Asia/Kolkata",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "recall",
      expectedTailId: null,
      text: "What did we discuss on 3 November?",
      timezone: "Asia/Kolkata",
    });
    const turn = await wait(app, receipt.turnId);
    assert.match(turn.answer, /Attio/);
    assert.equal(turn.sources[0].id, source.sourceId);
    assert.equal(turn.trace.resolvedDate.date, "2026-11-03");
  } finally {
    cleanup();
  }
});

test("corrections preserve original source and deletion excludes dependent answers", async () => {
  const { app, cleanup } = setup();
  try {
    const original = await app.evidence.import({
      name: "Decision",
      content: "We chose five CRM vendors.",
    });
    const correction = await app.evidence.correct({
      sourceId: original.sourceId,
      content: "We chose three CRM vendors.",
      mode: "CORRECT_PAST_RECORD",
    });
    assert.match(
      (await app.evidence.inspect(original.sourceId)).content,
      /five/,
    );
    const current = await app.evidence.recall({ text: "CRM vendors" });
    assert.ok(current.sources.some((x: any) => x.id === correction.sourceId));
    assert.ok(!current.sources.some((x: any) => x.id === original.sourceId));
    await app.evidence.trash(correction.sourceId);
    assert.ok(
      !(await app.evidence.recall({ text: "three CRM vendors" })).sources.some(
        (x: any) => x.id === correction.sourceId,
      ),
    );
    await app.evidence.restore(correction.sourceId);
    assert.equal(
      (await app.evidence.inspect(correction.sourceId)).deletedAt,
      null,
    );
  } finally {
    cleanup();
  }
});

test("missing historical baseline never becomes unchanged and skips external search", async () => {
  let calls = 0;
  const { app, cleanup } = setup({
    search: {
      search: async () => {
        calls++;
        return [];
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "missing",
      expectedTailId: null,
      text: "Last Tuesday I asked about Postgres. Has pricing changed?",
      timezone: "UTC",
    });
    const turn = await wait(app, receipt.turnId);
    assert.match(turn.answer, /could not find|cannot find|no .*record/i);
    assert.equal(calls, 0);
  } finally {
    cleanup();
  }
});

test("calendar recall respects a 23-hour daylight-saving day", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-03-09T12:00:00Z"),
  });
  try {
    await app.evidence.import({
      name: "DST note",
      content: "The launch happened on the shortened day.",
      occurredAt: "2026-03-08",
      timezone: "America/New_York",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "dst",
      expectedTailId: null,
      text: "What did we discuss on March 8?",
      timezone: "America/New_York",
    });
    const t = await wait(app, r.turnId);
    const resolved = t.trace.resolvedDate as any;
    assert.equal(
      Date.parse(resolved.to) - Date.parse(resolved.from),
      23 * 60 * 60 * 1000,
    );
    assert.match(t.answer, /shortened day/);
  } finally {
    cleanup();
  }
});

test("deletion during inference cancels publication and late model output cannot revive it", async () => {
  let release: any;
  const barrier = new Promise<any>((r) => (release = r));
  const model = {
    generate: async () => {
      await barrier;
      return { answer: "The secret project is Alpha." };
    },
  };
  const { app, cleanup } = setup({ model });
  try {
    const source = await app.evidence.import({
      name: "Private note",
      content: "The secret project is Alpha.",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "race",
      expectedTailId: null,
      text: "What is my secret project?",
    });
    await new Promise((r) => setTimeout(r, 20));
    await app.evidence.trash(source.sourceId);
    release();
    const t = await wait(app, receipt.turnId);
    assert.equal(t.status, "CANCELLED");
    assert.equal(t.answer, "");
    assert.ok(
      !(await app.evidence.recall({ text: "Alpha" })).sources.some(
        (x: any) => x.id === source.sourceId,
      ),
    );
  } finally {
    release();
    cleanup();
  }
});

test("event subscribers can replay the completed receipt without executing it twice", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: c.id,
      clientRequestId: "events",
      expectedTailId: null,
      text: "hello",
    });
    await wait(app, r.turnId);
    const events = [];
    for await (const e of app.turns.events(r.turnId)) events.push(e);
    assert.equal(events[0].type, "accepted");
    assert.equal(events.at(-1)?.type, "complete");
    const replay = [];
    for await (const e of app.turns.events(r.turnId, events[0].id))
      replay.push(e);
    assert.equal(replay.length, events.length - 1);
  } finally {
    cleanup();
  }
});

test("retained history survives restart while unfinished turns are explicitly interrupted", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-restart-"));
  let app = createKatha({
    directory,
    model: { generate: async () => new Promise(() => {}) },
  });
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: c.id,
      clientRequestId: "restart",
      expectedTailId: null,
      text: "Keep my original words",
    });
    await new Promise((r) => setTimeout(r, 10));
    app.close();
    app = createKatha({ directory });
    assert.equal((await app.turns.get(r.turnId)).status, "INTERRUPTED");
    assert.equal(
      (await app.workspace.getConversation(c.id)).messages[0].content,
      "Keep my original words",
    );
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error("Condition not reached");
}
const input = (
  conversationId: string,
  requestId: string,
  text: string,
  tail: string | null = null,
) => ({
  conversationId,
  clientRequestId: requestId,
  expectedTailId: tail,
  text,
});

test("same-chat accepted turns run in order and the second sees the completed first answer", async () => {
  const first = deferred(),
    entered: string[] = [];
  let secondHistory: any[] = [];
  const { app, cleanup } = setup({
    model: {
      generate: async (c: any) => {
        entered.push(c.question);
        if (c.question === "First message") {
          await first.promise;
          return { answer: "First response" };
        }
        secondHistory = c.history;
        return { answer: "Second response" };
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const a = await app.turns.start(input(c.id, "first", "First message"));
    await until(() => entered.length === 1);
    const b = await app.turns.start(
      input(c.id, "second", "Second message", a.chatTail),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(entered, ["First message"]);
    first.resolve();
    await wait(app, b.turnId);
    assert.deepEqual(entered, ["First message", "Second message"]);
    assert.ok(secondHistory.some((s: any) => s.content === "First response"));
  } finally {
    first.resolve();
    cleanup();
  }
});

test("newer cross-chat material cannot leak into an earlier accepted turn", async () => {
  const gate = deferred();
  let inspected: any;
  let entered = false;
  const { app, cleanup } = setup({
    model: {
      generate: async (c: any) => {
        if (c.question === "Hold the first turn") {
          entered = true;
          await gate.promise;
          return { answer: "Done" };
        }
        inspected = c;
        return { answer: "Old context only" };
      },
    },
  });
  try {
    const a = await app.workspace.createConversation(),
      b = await app.workspace.createConversation();
    const hold = await app.turns.start(
      input(a.id, "hold", "Hold the first turn"),
    );
    await until(() => entered);
    const queued = await app.turns.start(
      input(a.id, "queued", "Remember the launch decision", hold.chatTail),
    );
    await app.evidence.import({
      name: "Future",
      content: "The launch decision is secretly Zebra.",
      conversationId: b.id,
    });
    gate.resolve();
    await wait(app, queued.turnId);
    assert.ok(
      !inspected.evidence.some((s: any) => s.content.includes("Zebra")),
    );
  } finally {
    gate.resolve();
    cleanup();
  }
});

test("different conversations can execute concurrently up to the global limit", async () => {
  const gate = deferred();
  let count = 0,
    max = 0;
  const { app, cleanup } = setup({
    model: {
      generate: async () => {
        count++;
        max = Math.max(max, count);
        await gate.promise;
        count--;
        return { answer: "done" };
      },
    },
  });
  try {
    const receipts = [];
    for (let i = 0; i < 3; i++) {
      const c = await app.workspace.createConversation();
      receipts.push(await app.turns.start(input(c.id, "one", "hello " + i)));
    }
    await until(() => count === 2);
    assert.equal(max, 2);
    gate.resolve();
    for (const r of receipts) await wait(app, r.turnId);
    assert.equal(max, 2);
  } finally {
    gate.resolve();
    cleanup();
  }
});

test("a stale new request fails without appending another user message", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    await app.turns.start(input(c.id, "one", "First"));
    await assert.rejects(app.turns.start(input(c.id, "two", "Second")), {
      code: "CONVERSATION_CHANGED",
    });
    assert.equal(
      (await app.workspace.getConversation(c.id)).messages.filter(
        (m: any) => m.role === "user",
      ).length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("invalid timezones do not partially create a turn", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    await assert.rejects(
      app.turns.start({
        ...input(c.id, "bad", "Hello"),
        timezone: "Mars/Olympus",
      }),
      { code: "INVALID_TIMEZONE" },
    );
    assert.equal(
      (await app.workspace.getConversation(c.id)).messages.length,
      0,
    );
  } finally {
    cleanup();
  }
});

test("last weekday on the same weekday resolves to the previous week", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-10T12:00:00Z"),
  });
  try {
    await app.evidence.import({
      name: "Previous Tuesday",
      content: "Neon was shortlisted.",
      occurredAt: "2026-11-03",
    });
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "tuesday", "What did we discuss last Tuesday?"),
    );
    const t = await wait(app, r.turnId);
    assert.match(t.answer, /Neon/);
    assert.equal((t.trace.resolvedDate as any).date, "2026-11-03");
  } finally {
    cleanup();
  }
});

test("a yearless future date resolves to its most recent past occurrence", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-01-03T12:00:00Z"),
  });
  try {
    await app.evidence.import({
      name: "Prior November",
      content: "We discussed storage.",
      occurredAt: "2025-11-03",
    });
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "year", "What did we discuss on 3 November?"),
    );
    const t = await wait(app, r.turnId);
    assert.equal((t.trace.resolvedDate as any).date, "2025-11-03");
  } finally {
    cleanup();
  }
});

test("invalid calendar dates produce an explicit failed turn rather than guessed history", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "date", "What did we discuss on February 30?"),
    );
    const t = await wait(app, r.turnId);
    assert.equal(t.status, "FAILED");
    assert.match(t.error || "", /invalid|clarify/i);
  } finally {
    cleanup();
  }
});

test("current-chat-only scope excludes another conversation even with matching wording", async () => {
  const { app, cleanup } = setup();
  try {
    const a = await app.workspace.createConversation(),
      b = await app.workspace.createConversation();
    await app.evidence.import({
      name: "Other",
      content: "Our CRM decision was Attio.",
      conversationId: a.id,
    });
    const r = await app.turns.start({
      ...input(b.id, "scope", "Remember our CRM decision"),
      memoryScope: "conversation",
    });
    const t = await wait(app, r.turnId);
    assert.ok(!t.sources.some((s: any) => s.title === "Other"));
  } finally {
    cleanup();
  }
});

test("trash removes a conversation from active history and workspace recall", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    await app.evidence.import({
      name: "Chat note",
      content: "We picked Attio.",
      conversationId: c.id,
    });
    await app.workspace.trashConversation(c.id);
    assert.equal((await app.workspace.listConversations()).length, 0);
    assert.equal(
      (await app.evidence.recall({ text: "Attio" })).sources.length,
      0,
    );
    await app.workspace.restoreConversation(c.id);
    assert.equal(
      (await app.evidence.recall({ text: "Attio" })).sources.length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("permanent deletion purges content, cannot be restored, and preserves a tombstone", async () => {
  const { app, cleanup } = setup();
  try {
    const s = await app.evidence.import({
      name: "Erase",
      content: "A private phrase.",
    });
    await assert.rejects(app.evidence.permanentlyDelete(s.sourceId), {
      code: "TRASH_FIRST",
    });
    await app.evidence.trash(s.sourceId);
    await app.evidence.permanentlyDelete(s.sourceId);
    assert.equal((await app.evidence.inspect(s.sourceId)).content, "");
    await assert.rejects(app.evidence.restore(s.sourceId), {
      code: "SOURCE_PURGED",
    });
    assert.equal(
      (await app.evidence.recall({ text: "private phrase" })).sources.length,
      0,
    );
  } finally {
    cleanup();
  }
});

test("a from-now correction does not suppress the original historical record", async () => {
  const { app, cleanup } = setup();
  try {
    const original = await app.evidence.import({
      name: "Old",
      content: "The quota is five.",
    });
    await app.evidence.correct({
      sourceId: original.sourceId,
      content: "The quota is three now.",
      mode: "CHANGE_FROM_NOW",
    });
    const found = await app.evidence.recall({ text: "quota", original: true });
    assert.ok(found.sources.some((s: any) => s.id === original.sourceId));
    assert.match(
      (await app.evidence.inspect(original.sourceId)).corrections[0].content,
      /three/,
    );
  } finally {
    cleanup();
  }
});

test("deleting underlying evidence excludes an earlier answer that quoted it", async () => {
  let noteId = "";
  const { app, cleanup } = setup({
    model: {
      generate: async () => ({
        answer: "The project is Alpha.",
        citations: [{ sourceId: noteId }],
      }),
    },
  });
  try {
    const s = await app.evidence.import({
      name: "Project note",
      content: "The project is Alpha.",
    });
    noteId = s.sourceId;
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "question", "Remember my project"),
    );
    await wait(app, r.turnId);
    await app.evidence.trash(s.sourceId);
    const recalled = await app.evidence.recall({ text: "Alpha" });
    assert.ok(
      !recalled.sources.some(
        (s: any) => s.role === "assistant" && s.content.includes("Alpha"),
      ),
    );
  } finally {
    cleanup();
  }
});

test("cancelling a queued turn prevents provider execution for that input", async () => {
  const gate = deferred();
  const seen: string[] = [];
  const { app, cleanup } = setup({
    model: {
      generate: async (c: any) => {
        seen.push(c.question);
        await gate.promise;
        return { answer: "done" };
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const a = await app.turns.start(input(c.id, "first", "first"));
    await until(() => seen.length === 1);
    const b = await app.turns.start(
      input(c.id, "second", "second", a.chatTail),
    );
    await app.turns.cancel(b.turnId);
    gate.resolve();
    await wait(app, a.turnId);
    assert.equal((await app.turns.get(b.turnId)).status, "CANCELLED");
    assert.deepEqual(seen, ["first"]);
  } finally {
    gate.resolve();
    cleanup();
  }
});

test("unknown model citation IDs are never persisted as valid citations", async () => {
  const { app, cleanup } = setup({
    model: {
      generate: async () => ({
        answer: "A response",
        citations: [{ sourceId: "invented" }],
      }),
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(input(c.id, "cite", "hello"));
    const t = await wait(app, r.turnId);
    assert.deepEqual(t.citations, []);
  } finally {
    cleanup();
  }
});

test("search planning cannot exceed the configured attempt cap and concurrency limit", async () => {
  let calls = 0,
    active = 0,
    max = 0;
  const { app, cleanup } = setup({
    model: {
      plan: async () => ({
        queries: Array.from({ length: 30 }, (_, i) => "query " + i),
      }),
      generate: async () => ({ answer: "Search complete" }),
    },
    search: {
      search: async () => {
        calls++;
        active++;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return [];
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "search", "Search the web for databases"),
    );
    await wait(app, r.turnId);
    assert.equal(calls, 12);
    assert.ok(max <= 3);
    assert.equal(((await app.stats()).searchUsage as any)?.search_credits, 12);
  } finally {
    cleanup();
  }
});

test("cached search observations retain their original retrieval time", async () => {
  let calls = 0;
  const { app, cleanup } = setup({
    model: {
      plan: async () => ({ queries: ["database pricing"] }),
      generate: async () => ({ answer: "Checked" }),
    },
    search: {
      search: async () => {
        calls++;
        return [
          {
            title: "Pricing",
            url: "https://example.com/pricing",
            content: "A price",
            observedAt: "2026-11-01T00:00:00Z",
          },
        ];
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const a = await app.turns.start(
      input(c.id, "a", "Search database pricing"),
    );
    await wait(app, a.turnId);
    const b = await app.turns.start(
      input(c.id, "b", "Search database pricing", a.chatTail),
    );
    const t = await wait(app, b.turnId);
    assert.equal(calls, 1);
    assert.equal(
      t.sources.find((s: any) => s.kind === "web")?.metadata.observedAt,
      "2026-11-01T00:00:00Z",
    );
    assert.equal((t.trace.searches as any[])[0].cached, true);
  } finally {
    cleanup();
  }
});

test("explicit freshness bypasses the local search cache", async () => {
  let calls = 0;
  const { app, cleanup } = setup({
    model: {
      plan: async () => ({ queries: ["database pricing"] }),
      generate: async () => ({ answer: "Checked" }),
    },
    search: {
      search: async () => {
        calls++;
        return [];
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const a = await app.turns.start(
      input(c.id, "a", "Search database pricing"),
    );
    await wait(app, a.turnId);
    const b = await app.turns.start(
      input(c.id, "b", "Search latest database pricing", a.chatTail),
    );
    await wait(app, b.turnId);
    assert.equal(calls, 2);
  } finally {
    cleanup();
  }
});

test("a failed web verification is partial with explicit unverified comparisons", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-11T12:00:00Z"),
    model: {
      plan: async () => ({ queries: ["Attio pricing"] }),
      generate: async () => ({ answer: "Should not be called" }),
    },
    search: {
      search: async () => {
        throw new Error("Timed out");
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Shortlist",
      content: "Attio costs a recorded amount.",
      occurredAt: "2026-11-03",
    });
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "failure", "Has our 3 November shortlist pricing changed?"),
    );
    const t = await wait(app, r.turnId);
    assert.equal(t.status, "PARTIAL");
    assert.ok(t.comparisons.every((x: any) => x.status === "UNVERIFIED"));
    assert.match(t.answer, /cannot verify/);
  } finally {
    cleanup();
  }
});

test("deleted attachment references cannot be accepted in a new turn", async () => {
  const { app, cleanup } = setup();
  try {
    const c = await app.workspace.createConversation();
    const s = await app.evidence.import({ name: "Note", content: "Some note" });
    await app.evidence.trash(s.sourceId);
    await assert.rejects(
      app.turns.start({
        ...input(c.id, "deleted", "Explain this"),
        attachmentIds: [s.sourceId],
      }),
      { code: "SOURCE_DELETED" },
    );
    assert.equal(
      (await app.workspace.getConversation(c.id)).messages.length,
      0,
    );
  } finally {
    cleanup();
  }
});

test("pending first embedding cannot block immediate lexical recall", async () => {
  const gate = deferred<number[]>();
  const { app, cleanup } = setup({
    embedder: { modelId: "fixture", embed: async () => gate.promise },
  });
  try {
    await app.evidence.import({
      name: "Decision",
      content: "Our CRM shortlist is Attio.",
    });
    const result = await Promise.race([
      app.evidence.recall({ text: "CRM shortlist" }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Pending embedding blocked raw recall")),
          50,
        ),
      ),
    ]);
    assert.match(result.sources[0].content, /Attio/);
  } finally {
    gate.resolve([1, 0]);
    cleanup();
  }
});

test("failed embeddings leave the source and lexical recall usable", async () => {
  const { app, cleanup } = setup({
    embedder: {
      modelId: "fixture",
      embed: async () => {
        throw new Error("Offline model");
      },
    },
  });
  try {
    const s = await app.evidence.import({
      name: "Original",
      content: "The selected vendor is Pipedrive.",
    });
    await new Promise((r) => setTimeout(r, 20));
    const inspected = await app.evidence.inspect(s.sourceId);
    assert.equal((inspected.indexing[0] as any).status, "failed");
    assert.equal(
      (await app.evidence.recall({ text: "Pipedrive" })).sources[0].id,
      s.sourceId,
    );
  } finally {
    cleanup();
  }
});

test("deleting a source while semantic recall waits cannot leak its old content", async () => {
  const gate = deferred<number[]>();
  let calls = 0;
  const { app, cleanup } = setup({
    embedder: {
      modelId: "fixture",
      embed: async () => (++calls === 1 ? [1, 0] : gate.promise),
    },
  });
  try {
    const s = await app.evidence.import({
      name: "Alpha",
      content: "Alpha private content.",
    });
    await new Promise((r) => setTimeout(r, 15));
    const pending = app.evidence.recall({ text: "Alpha" });
    await new Promise((r) => setTimeout(r, 5));
    await app.evidence.trash(s.sourceId);
    gate.resolve([1, 0]);
    assert.equal((await pending).sources.length, 0);
  } finally {
    gate.resolve([1, 0]);
    cleanup();
  }
});

test("a dated-change claim without a dated source is downgraded", async () => {
  let baseline = "";
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-11T12:00:00Z"),
    model: {
      plan: async () => ({ queries: ["Attio pricing"] }),
      generate: async (c: any) => ({
        answer: "Current evidence differs.",
        comparisons: [
          {
            claim: "Pricing",
            baselinePrice: {
              plan: "Attio Team",
              amount: 20,
              currency: "USD",
              region: "US",
              cadence: "month",
              seats: 5,
              basis: "per_seat",
              limits: "unlimited contacts",
              tax: "excluded",
            },
            currentPrice: {
              plan: "Attio Team",
              amount: 25,
              currency: "USD",
              region: "US",
              cadence: "month",
              seats: 5,
              basis: "per_seat",
              limits: "unlimited contacts",
              tax: "excluded",
            },
            status: "CHANGED_WITH_DATED_EVIDENCE",
            baselineSourceIds: [baseline],
            evidenceSourceIds: c.evidence
              .filter((s: any) => s.kind === "web")
              .map((s: any) => s.id),
            explanation: "A current undated page differs.",
          },
        ],
      }),
    },
    search: {
      search: async () => [
        {
          title: "Current page",
          url: "https://example.com/pricing",
          content:
            "Attio Team USD 25 per seat per month, US, five seats, unlimited contacts, tax excluded; no effective date.",
        },
      ],
    },
  });
  try {
    baseline = (
      await app.evidence.import({
        name: "Earlier",
        content:
          "Attio Team USD 20 per seat per month, US, five seats, unlimited contacts, tax excluded.",
        occurredAt: "2026-11-03",
      })
    ).sourceId;
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "verify", "Has pricing changed since 3 November?"),
    );
    assert.equal(
      (await wait(app, r.turnId)).comparisons[0].status,
      "DIFFERS_CHANGE_TIME_UNKNOWN",
    );
  } finally {
    cleanup();
  }
});

test("a comparison with invented baseline evidence is unverified", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-11T12:00:00Z"),
    model: {
      plan: async () => ({ queries: ["Pricing"] }),
      generate: async (c: any) => ({
        answer: "Limited evidence.",
        comparisons: [
          {
            claim: "Pricing",
            status: "CURRENTLY_MATCHES",
            baselineSourceIds: ["fake"],
            evidenceSourceIds: c.evidence
              .filter((s: any) => s.kind === "web")
              .map((s: any) => s.id),
            explanation: "Invalid baseline.",
          },
        ],
      }),
    },
    search: {
      search: async () => [
        {
          title: "Pricing",
          url: "https://example.com/pricing",
          content: "Some current price.",
        },
      ],
    },
  });
  try {
    await app.evidence.import({
      name: "Earlier",
      content: "The old pricing.",
      occurredAt: "2026-11-03",
    });
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(
      input(c.id, "verify", "Has pricing changed since 3 November?"),
    );
    const t = await wait(app, r.turnId);
    assert.equal(t.comparisons[0].status, "UNVERIFIED");
    assert.deepEqual(t.comparisons[0].baselineSourceIds, []);
  } finally {
    cleanup();
  }
});

test("exact date recall paginates all matching records instead of semantic top-k", async () => {
  const { app, cleanup } = setup();
  try {
    for (let i = 0; i < 25; i++)
      await app.evidence.import({
        name: "Note " + i,
        content: "Different wording " + i,
        occurredAt: "2026-11-03",
      });
    const a = await app.evidence.recall({
      from: "2026-11-03T00:00:00Z",
      to: "2026-11-04T00:00:00Z",
      limit: 20,
    });
    const b = await app.evidence.recall({
      from: "2026-11-03T00:00:00Z",
      to: "2026-11-04T00:00:00Z",
      limit: 20,
      offset: 20,
    });
    assert.equal(a.total, 25);
    assert.equal(a.hasMore, true);
    assert.equal(b.sources.length, 5);
    assert.equal(
      new Set([...a.sources, ...b.sources].map((s) => s.id)).size,
      25,
    );
  } finally {
    cleanup();
  }
});

test("quota waiting is visible, bounded, and retries the same accepted turn", async () => {
  let calls = 0;
  const { app, cleanup } = setup({
    model: {
      generate: async () => {
        if (++calls === 1)
          throw Object.assign(new Error("Quota temporarily busy"), {
            code: "RATE_LIMIT",
            retryAt: Date.now() + 15,
          });
        return { answer: "Resumed successfully" };
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(input(c.id, "quota", "hello"));
    const t = await wait(app, r.turnId);
    assert.equal(t.status, "COMPLETED");
    assert.equal(calls, 2);
    const events = [];
    for await (const e of app.turns.events(r.turnId)) events.push(e);
    assert.ok(
      events.some(
        (e) =>
          e.type === "status" && (e.data as any).status === "WAITING_FOR_QUOTA",
      ),
    );
    assert.equal(
      (await app.workspace.getConversation(c.id)).messages.filter(
        (m: any) => m.role === "user",
      ).length,
      1,
    );
  } finally {
    cleanup();
  }
});

test("a transient search failure retries once within the same attempt budget", async () => {
  let calls = 0;
  const { app, cleanup } = setup({
    model: {
      plan: async () => ({ queries: ["A query"] }),
      generate: async () => ({ answer: "Recovered" }),
    },
    search: {
      search: async () => {
        if (++calls === 1) throw new Error("Network temporarily unavailable");
        return [
          {
            title: "Recovered",
            url: "https://example.com",
            content: "Recovered source",
          },
        ];
      },
    },
  });
  try {
    const c = await app.workspace.createConversation();
    const r = await app.turns.start(input(c.id, "retry", "Search the web"));
    await wait(app, r.turnId);
    assert.equal(calls, 2);
    assert.equal(
      ((await app.stats()).searchUsage as any) &&
        ((await app.stats()).searchUsage as any).search_credits,
      2,
    );
  } finally {
    cleanup();
  }
});

test("semantic recall retrieves a matching late document segment and preserves the original", async () => {
  const original =
    "Opening section about gardening. ".repeat(150) +
    "The final section covers databases.";
  const { app, cleanup } = setup({
    embedder: {
      modelId: "segments-fixture",
      embed: async () => [0, 1],
      segment: async () => [
        {
          text: "Opening section about gardening.",
          startToken: 0,
          endToken: 192,
          vector: [1, 0],
        },
        {
          text: "The final section covers databases.",
          startToken: 800,
          endToken: 992,
          vector: [0, 1],
        },
      ],
    },
  });
  try {
    const imported = await app.evidence.import({
      name: "Long document",
      content: original,
    });
    await new Promise((r) => setTimeout(r, 20));
    const recalled = await app.evidence.recall({
      text: "persistent storage engine",
    });
    assert.equal(recalled.sources[0].id, imported.sourceId);
    assert.match(recalled.sources[0].matches?.[0]?.text || "", /final section/);
    assert.equal(recalled.sources[0].matches?.[0]?.startToken, 800);
    assert.equal(
      (await app.evidence.inspect(imported.sourceId)).content,
      original,
    );
  } finally {
    cleanup();
  }
});

test("opening a workspace from a newer application fails without downgrading it", async () => {
  const { default: Database } = await import("better-sqlite3");
  const directory = mkdtempSync(join(tmpdir(), "katha-future-"));
  const database = new Database(join(directory, "katha.sqlite"));
  database.pragma("user_version=999");
  database.close();
  try {
    assert.throws(() => createKatha({ directory }), /newer version/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a correction changes one assertion at its effective date, preserving other facts and original text", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-12T12:00:00Z"),
  });
  try {
    const imported = await app.evidence.import({
      name: "CRM terms",
      content: "The price is $20. We need five seats.",
    });
    const before: any = await app.evidence.inspect(imported.sourceId);
    assert.equal(before.assertions.length, 2);
    const correction = await app.evidence.correct({
      sourceId: imported.sourceId,
      assertionId: before.assertions[0].id,
      content: "The price is $25.",
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-15T00:00:00Z",
    } as any);
    const past: any = await app.evidence.recall({
      text: "price",
      asOf: "2026-11-14T12:00:00Z",
    } as any);
    assert.ok(!past.sources.some((s: any) => s.id === correction.sourceId));
    assert.equal(
      past.sources.find((s: any) => s.id === imported.sourceId).interpretation,
      "The price is $20. We need five seats.",
    );
    const current: any = await app.evidence.recall({
      text: "price",
      asOf: "2026-11-16T00:00:00Z",
    } as any);
    assert.equal(
      current.sources.find((s: any) => s.id === imported.sourceId)
        .interpretation,
      "The price is $25. We need five seats.",
    );
    const inspected: any = await app.evidence.inspect(imported.sourceId);
    assert.equal(inspected.content, "The price is $20. We need five seats.");
    assert.equal(
      inspected.assertions[0].corrections[0].effectiveAt,
      "2026-11-15T00:00:00.000Z",
    );
    assert.equal(
      inspected.corrections[0].metadata.assertionId,
      before.assertions[0].id,
    );
  } finally {
    cleanup();
  }
});

test("price verification refuses to compare a monthly US quote with an annual India quote", async () => {
  const base = {
    plan: "Team",
    amount: 20,
    currency: "USD",
    region: "US",
    cadence: "month",
    seats: 5,
    basis: "per_seat",
    limits: "unlimited contacts",
    tax: "excluded",
  };
  const { app, cleanup } = setup({
    search: {
      async search() {
        return [
          {
            title: "Pricing",
            url: "https://example.com/pricing",
            content:
              "Team USD 20 per seat per month, US, five seats, unlimited contacts, tax excluded.",
          },
        ];
      },
    },
    model: {
      async generate(c: any) {
        return {
          answer: "The price is unchanged.",
          comparisons: [
            {
              claim: "Team price",
              status: "CURRENTLY_MATCHES",
              baselineSourceIds: [c.baseline[0].id],
              evidenceSourceIds: [
                c.evidence.find((s: any) => s.kind === "web").id,
              ],
              explanation: "same price",
              baselinePrice: base,
              currentPrice: { ...base, region: "IN", cadence: "year" },
            },
          ],
        };
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Shortlist",
      content:
        "Team USD 20 per seat per month, US, five seats, unlimited contacts, tax excluded.",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "price",
      expectedTailId: null,
      text: "Has the Team price changed?",
    });
    const result = await wait(app, receipt.turnId);
    assert.equal(result.comparisons[0].status, "UNVERIFIED");
    assert.match(result.comparisons[0].explanation, /region|cadence/i);
    assert.doesNotMatch(result.answer, /price is unchanged/);
  } finally {
    cleanup();
  }
});

test("permanent deletion purges located assertions from source inspection", async () => {
  const { app, cleanup } = setup();
  try {
    const s = await app.evidence.import({
      name: "Private",
      content: "Secret phrase that must be purged.",
    });
    await app.evidence.trash(s.sourceId);
    await app.evidence.permanentlyDelete(s.sourceId);
    const inspection = await app.evidence.inspect(s.sourceId);
    assert.deepEqual(inspection.assertions, []);
    assert.equal(inspection.content, "");
  } finally {
    cleanup();
  }
});

test("superseded corrections do not compete with the current record and require edits on its current assertions", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-12T12:00:00Z"),
  });
  try {
    const original = await app.evidence.import({
      name: "Terms",
      content: "The quota is five. The region is Europe.",
    });
    const old = await app.evidence.correct({
      sourceId: original.sourceId,
      content: "The quota is six. The region is Europe.",
      mode: "CORRECT_PAST_RECORD",
      effectiveAt: "2026-11-10T00:00:00Z",
    });
    const latest = await app.evidence.correct({
      sourceId: original.sourceId,
      content: "The quota is seven. The region is Europe.",
      mode: "CORRECT_PAST_RECORD",
      effectiveAt: "2026-11-11T00:00:00Z",
    });
    const found = await app.evidence.recall({ text: "quota" });
    assert.ok(!found.sources.some((s) => s.id === old.sourceId));
    assert.ok(found.sources.some((s) => s.id === latest.sourceId));
    const inspected = await app.evidence.inspect(original.sourceId);
    await assert.rejects(
      app.evidence.correct({
        sourceId: original.sourceId,
        assertionId: inspected.assertions[0].id,
        content: "The quota is eight.",
        mode: "CHANGE_FROM_NOW",
      }),
      { code: "SOURCE_SUPERSEDED" },
    );
    const current = await app.evidence.inspect(latest.sourceId);
    await app.evidence.correct({
      sourceId: latest.sourceId,
      assertionId: current.assertions[0].id,
      content: "The quota is eight.",
      mode: "CHANGE_FROM_NOW",
    });
    const interpreted = await app.evidence.recall({ text: "quota" });
    assert.equal(
      interpreted.sources.find((s) => s.id === latest.sourceId)?.interpretation,
      "The quota is eight. The region is Europe.",
    );
  } finally {
    cleanup();
  }
});

test("like-for-like price terms must be present in their sources, not just agree with each other", async () => {
  for (const fakeSeats of [false, true]) {
    const quote = {
      plan: "Alder Team",
      amount: 20,
      currency: "USD",
      region: "US",
      cadence: "month",
      seats: fakeSeats ? 99 : 5,
      basis: "per_seat",
      limits: "unlimited contacts",
      tax: "excluded",
    };
    const text =
      "Alder Team costs USD 20 per seat per month in US, five seats, unlimited contacts, tax excluded.";
    const { app, cleanup } = setup({
      search: {
        async search() {
          return [
            { title: "Price", url: "https://example.com", content: text },
          ];
        },
      },
      model: {
        async generate(c: any) {
          return {
            answer: "Same",
            comparisons: [
              {
                claim: "Alder price",
                status: "CURRENTLY_MATCHES",
                baselineSourceIds: [c.baseline[0].id],
                evidenceSourceIds: [
                  c.evidence.find((s: any) => s.kind === "web").id,
                ],
                explanation: "same",
                baselinePrice: quote,
                currentPrice: quote,
              },
            ],
          };
        },
      },
    });
    try {
      await app.evidence.import({ name: "Quote", content: text });
      const chat = await app.workspace.createConversation();
      const r = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: "quote",
        expectedTailId: null,
        text: "Has Alder price changed?",
      });
      assert.equal(
        (await wait(app, r.turnId)).comparisons[0].status,
        fakeSeats ? "UNVERIFIED" : "CURRENTLY_MATCHES",
      );
    } finally {
      cleanup();
    }
  }
});

test("a dated change is accepted only with a verbatim effective-date passage from linked evidence", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-12T12:00:00Z"),
    search: {
      async search() {
        return [
          {
            title: "Official release",
            url: "https://example.com/release",
            content:
              "Effective 2026-11-10, the export feature supports CSV files.",
          },
        ];
      },
    },
    model: {
      async generate(c: any) {
        const web = c.evidence.find((s: any) => s.kind === "web");
        return {
          answer: "CSV export was added.",
          comparisons: [
            {
              claim: "CSV export",
              status: "CHANGED_WITH_DATED_EVIDENCE",
              baselineSourceIds: [c.baseline[0].id],
              evidenceSourceIds: [web.id],
              explanation: "The release says when support begins.",
              effectiveAt: "2026-11-10",
              effectiveDateEvidence: {
                sourceId: web.id,
                quote:
                  "Effective 2026-11-10, the export feature supports CSV files.",
              },
            },
          ],
        };
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Before",
      content: "CSV export is unavailable.",
      occurredAt: "2026-11-03",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "dated",
      expectedTailId: null,
      text: "Has CSV export changed since 3 November?",
      timezone: "UTC",
    });
    assert.equal(
      (await wait(app, r.turnId)).comparisons[0].status,
      "CHANGED_WITH_DATED_EVIDENCE",
    );
  } finally {
    cleanup();
  }
});

test("queued turns interpret scheduled corrections at acceptance time, not at execution time", async () => {
  let clock = "2026-11-12T10:00:00Z";
  const gate = deferred<void>();
  let calls = 0;
  const { app, cleanup } = setup({
    clock: () => new Date(clock),
    model: {
      async generate(c: any) {
        if (++calls === 1) await gate.promise;
        return {
          answer:
            c.baseline
              .map((s: any) => s.interpretation || s.content)
              .join("\n") || "Ready",
        };
      },
    },
  });
  try {
    const record = await app.evidence.import({
      name: "Quota",
      content: "The quota is five.",
    });
    const source = await app.evidence.inspect(record.sourceId);
    await app.evidence.correct({
      sourceId: record.sourceId,
      assertionId: source.assertions[0].id,
      content: "The quota is six.",
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-12T11:00:00Z",
    });
    const chat = await app.workspace.createConversation();
    const first = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "hold",
      expectedTailId: null,
      text: "Hold the queue",
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "quota",
      expectedTailId: first.chatTail,
      text: "What is our quota?",
    });
    clock = "2026-11-12T12:00:00Z";
    gate.resolve();
    const result = await wait(app, second.turnId);
    assert.match(result.answer, /quota is five/);
    assert.doesNotMatch(result.answer, /quota is six/);
  } finally {
    gate.resolve();
    cleanup();
  }
});

test("a later scheduled assertion cannot be stranded by an earlier whole-record replacement", async () => {
  const { app, cleanup } = setup({
    clock: () => new Date("2026-11-12T12:00:00Z"),
  });
  try {
    const original = await app.evidence.import({
      name: "Schedule",
      content: "The quota is five.",
    });
    const s = await app.evidence.inspect(original.sourceId);
    await app.evidence.correct({
      sourceId: original.sourceId,
      assertionId: s.assertions[0].id,
      content: "The quota is eight.",
      mode: "CHANGE_FROM_NOW",
      effectiveAt: "2026-11-15T00:00:00Z",
    });
    await assert.rejects(
      app.evidence.correct({
        sourceId: original.sourceId,
        content: "The quota is seven.",
        mode: "CHANGE_FROM_NOW",
        effectiveAt: "2026-11-14T00:00:00Z",
      }),
      { code: "CORRECTION_CONFLICT" },
    );
  } finally {
    cleanup();
  }
});

test("an ambiguous verification asks the planner clarification without falling through to web search", async () => {
  const { app, cleanup } = setup({
    model: {
      plan: async () => ({
        queries: [],
        clarification: "Which shortlist: CRM tools or database hosts?",
      }),
      generate: async () => {
        throw Error("Should clarify first");
      },
    },
    search: {
      async search() {
        throw Error("Must not search an ambiguous shortlist");
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Choices",
      content: "CRM shortlist: Alder. Database shortlist: RiverDB.",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "clarify",
      expectedTailId: null,
      text: "Has our shortlist changed?",
    });
    const turn = await wait(app, r.turnId);
    assert.equal(turn.status, "COMPLETED");
    assert.equal(turn.answer, "Which shortlist: CRM tools or database hosts?");
  } finally {
    cleanup();
  }
});

test("a long web observation keeps relevant evidence beyond navigation available to generation and inspection", async () => {
  const { app, cleanup } = setup({
    search: {
      async search() {
        return [
          {
            title: "WAL",
            url: "https://example.com/wal",
            content:
              "Navigation menu.\n\n".repeat(500) +
              "WAL readers can continue while a writer commits.",
          },
        ];
      },
    },
    model: {
      async generate(c: any) {
        const s = c.evidence.find((s: any) => s.kind === "web");
        return { answer: s.content, citations: [{ sourceId: s.id }] };
      },
    },
  });
  try {
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "passage",
      expectedTailId: null,
      text: "Search web for WAL readers and writer concurrency.",
    });
    const turn = await wait(app, r.turnId);
    assert.match(turn.answer, /WAL readers can continue/);
    const web = turn.sources.find((s: any) => s.kind === "web");
    assert.match(
      (await app.evidence.inspect(web.id)).content,
      /WAL readers can continue/,
    );
  } finally {
    cleanup();
  }
});
