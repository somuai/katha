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
