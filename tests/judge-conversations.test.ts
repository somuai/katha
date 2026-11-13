import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

for (const scenario of [
  {
    name: "Monday CRM shortlist",
    date: "2026-11-09T10:00:00Z",
    original:
      "We shortlisted Alder, Birch, Cedar, Elm and Fir CRM for a 20-person sales team.",
    question:
      "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any changed pricing since?",
    baseline: /Alder, Birch, Cedar, Elm and Fir/,
    count: 5,
  },
  {
    name: "last Tuesday Postgres question",
    date: "2026-11-10T10:00:00Z",
    original: "Which Postgres host fits us: RiverDB or CloudLake?",
    question:
      "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
    baseline: /Which Postgres host fits us/,
    count: 0,
  },
  {
    name: "November 3 paired original question",
    date: "2026-11-03T10:00:00Z",
    original: "Does the Atlas plan include audit logs?",
    question:
      "What did I ask you on 3 November? Is your answer still correct today?",
    baseline: /Does the Atlas plan include audit logs/,
    count: 0,
  },
]) {
  test(`${scenario.name}: real conversation baseline survives restart and a failed search cannot prove stability`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "katha-judge-conversation-"));
    let now = scenario.date,
      seed = true;
    const options = {
      directory,
      clock: () => new Date(now),
      model: {
        async plan() {
          return {
            mode: "verify" as const,
            queries: ["official pricing and release changes"],
          };
        },
        async generate(context: any) {
          if (seed)
            return {
              answer: "Recorded. No commercial terms were established.",
            };
          assert.match(JSON.stringify(context.baseline), scenario.baseline);
          return {
            answer: "The search failed; current changes are unverified.",
            citations: [],
            comparisons: [],
          };
        },
      },
      search: {
        async search(): Promise<never> {
          throw Error("Fixture upstream unavailable");
        },
      },
    };
    let app = createKatha(options);
    try {
      const old = await app.workspace.createConversation();
      const original = await app.turns.start({
        conversationId: old.id,
        clientRequestId: "original",
        expectedTailId: null,
        text: scenario.original,
        timezone: "UTC",
      });
      for await (const event of app.turns.events(original.turnId))
        if (event.type === "complete") break;
      app.close();
      seed = false;
      now = "2026-11-13T10:00:00Z";
      app = createKatha(options);
      const next = await app.workspace.createConversation();
      const request = await app.turns.start({
        conversationId: next.id,
        clientRequestId: "followup",
        expectedTailId: null,
        text: scenario.question,
        timezone: "UTC",
      });
      for await (const event of app.turns.events(request.turnId))
        if (event.type === "complete") break;
      const result = await app.turns.get(request.turnId);
      assert.ok(
        ["COMPLETED", "PARTIAL"].includes(result.status),
        result.error || "Turn failed",
      );
      assert.match(JSON.stringify(result.trace), /failed|unavailable/i);
      assert.ok(result.comparisons.every((c) => c.status === "UNVERIFIED"));
      if (scenario.count)
        assert.equal(result.comparisons.length, scenario.count);
      assert.doesNotMatch(
        result.answer,
        /pricing (?:is |has remained )?unchanged/i,
      );
    } finally {
      app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("a deleted private note gets an actionable missing-source explanation rather than a generic refusal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-deleted-note-"));
  const app = createKatha({
    directory,
    model: {
      async generate() {
        return { answer: "I am sorry, I cannot provide that information." };
      },
    },
  });
  try {
    const note = await app.evidence.import({
      name: "crm-note.md",
      content: "Private shortlist: Alder and Birch.",
    });
    await app.evidence.trash(note.sourceId);
    const chat = await app.workspace.createConversation();
    const request = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "removed",
      expectedTailId: null,
      text: "Summarize my deleted CRM note.",
    });
    for await (const event of app.turns.events(request.turnId))
      if (event.type === "complete") break;
    const result = await app.turns.get(request.turnId);
    assert.equal(result.status, "COMPLETED");
    assert.match(
      result.answer,
      /retained (?:file|source)|eligible (?:file|source)/i,
    );
    assert.match(result.answer, /attach|import/i);
    assert.doesNotMatch(result.answer, /Alder|Birch/);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a model price-only response leaves explicit release gaps for every shortlisted vendor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-topic-coverage-"));
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T10:00:00Z"),
    search: {
      async search() {
        return [
          {
            title: "Official information",
            url: "https://example.org/updates",
            content:
              "Alder and Birch have pricing pages; release timing is not established.",
          },
        ];
      },
    },
    model: {
      async generate(c) {
        return {
          answer: "Price evidence incomplete.",
          comparisons: ["Alder", "Birch"].map((name) => ({
            claim: `${name} pricing`,
            status: "UNVERIFIED" as const,
            explanation: "Missing old terms.",
            baselineSourceIds: (c.baseline || []).map((s) => s.id),
            evidenceSourceIds: c.evidence
              .filter((s) => s.kind === "web")
              .map((s) => s.id),
          })),
        };
      },
    },
  });
  try {
    await app.evidence.import({
      name: "Monday shortlist",
      content: "We shortlisted Alder and Birch.",
      occurredAt: "2026-11-09",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "topics",
      expectedTailId: null,
      text: "On Monday we shortlisted Alder and Birch. Has pricing changed or shipped anything big?",
      timezone: "UTC",
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const result = await app.turns.get(receipt.turnId);
    assert.equal(result.status, "COMPLETED");
    for (const name of ["Alder", "Birch"]) {
      const release = result.comparisons.find(
        (c) => c.claim === `${name} product releases`,
      );
      assert.ok(release);
      assert.equal(release.status, "UNVERIFIED");
    }
    assert.deepEqual((result.trace.topicCoverage as any).unresolved, [
      "Alder release",
      "Birch release",
    ]);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
