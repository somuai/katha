import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
test("asking which vendor our records selected does not invoke external planning", async () => {
  const turn = await run(
    "Which vendor do our records say is selected now?",
    {
      model: {
        plan: async () => {
          throw Error("A retained decision does not need web planning");
        },
        generate: async (c: any) => ({
          answer: c.baseline.some((s: any) => s.content.includes("Cedar"))
            ? "Cedar"
            : "No record",
        }),
      },
      search: {
        search: async () => {
          throw Error("No search for a retained selection");
        },
      },
    },
    {
      text: "The selected vendor is Alder.",
      name: "Synthetic original record",
      correction: "The selected vendor is Cedar.",
    },
  );
  assert.equal(turn.answer, "Cedar");
  assert.deepEqual(turn.trace.searches, []);
});
test("an unspecified shortlist asks which retained decision before web search", async () => {
  const turn = await run(
    "Did the shortlist change?",
    {
      model: {
        plan: async () => {
          throw Error(
            "Explicit shortlist alternatives must not need model planning",
          );
        },
        generate: async () => ({ answer: "Should not generate" }),
      },
      search: {
        search: async () => {
          throw Error("Ambiguous decision must not search");
        },
      },
    },
    {
      text: "CRM shortlist: Alder and Birch. Database shortlist: RiverDB and CloudLake. These are separate decisions.",
    },
  );
  assert.match(turn.answer || "", /which shortlist/i);
  assert.match(turn.answer || "", /CRM/);
  assert.match(turn.answer || "", /Database/);
  assert.deepEqual(turn.trace.searches, []);
});
async function run(
  question: string,
  options: any = {},
  source?: {
    text: string;
    attach?: boolean;
    name?: string;
    correction?: string;
  },
) {
  const directory = mkdtempSync(join(tmpdir(), "katha-route-"));
  const app = createKatha({ directory, ...options });
  try {
    let attachmentIds: string[] = [];
    if (source) {
      const s = await app.evidence.import({
        name: source.name || "private.csv",
        content: source.text,
      });
      if (source.correction)
        await app.evidence.correct({
          sourceId: s.sourceId,
          content: source.correction,
          mode: "CHANGE_FROM_NOW",
          effectiveAt: "2026-11-10T00:00:00Z",
        });
      if (source.attach) attachmentIds = [s.sourceId];
    }
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "one",
      expectedTailId: null,
      text: question,
      attachmentIds,
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    return await app.turns.get(r.turnId);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test("a generic external question uses planner-selected web search without a web keyword", async () => {
  const turn = await run("Which hosted Postgres options fit my startup?", {
    model: {
      plan: async () => ({
        mode: "current",
        queries: ["Postgres hosting official plans"],
      }),
      generate: async (c: any) => ({
        answer: c.evidence.some((s: any) => s.kind === "web")
          ? "External evidence found."
          : "No web used.",
      }),
    },
    search: {
      search: async () => [
        {
          title: "Hosting",
          url: "https://example.com",
          content: "External evidence.",
        },
      ],
    },
  });
  assert.equal(turn.answer, "External evidence found.");
  assert.equal((turn.trace.searches as any[]).length, 1);
});
test("sources-only is a hard restriction even if a planner would request the web", async () => {
  const turn = await run(
    "Use only my uploaded sources. Is the current attendance still correct?",
    {
      model: {
        plan: async () => ({
          mode: "verify",
          queries: ["private attendance names"],
        }),
        generate: async (c: any) => ({
          answer: c.evidence.some((s: any) => s.kind === "web")
            ? "Leaked to web"
            : "Used retained data.",
        }),
      },
      search: {
        search: async () => {
          throw Error("Private source request must not reach search");
        },
      },
    },
    { text: "attendance,present\nMonday,3", attach: true },
  );
  assert.equal(turn.answer, "Used retained data.");
  assert.deepEqual(turn.trace.searches, []);
});
test("planner general mode keeps a current-looking source analysis local", async () => {
  const turn = await run(
    "How many current leads are qualified?",
    {
      model: {
        plan: async () => ({ mode: "general", queries: [] }),
        generate: async (c: any) => ({
          answer: c.evidence.some((s: any) => s.kind === "web")
            ? "Wrong route"
            : "Source analysis.",
        }),
      },
      search: {
        search: async () => {
          throw Error("No external lookup required");
        },
      },
    },
    { text: "lead,stage\nAsha,qualified" },
  );
  assert.equal(turn.answer, "Source analysis.");
  assert.deepEqual(turn.trace.searches, []);
});

test("planner-produced contact data is not sent to external search", async () => {
  const turn = await run("Which CRM options would fit my startup?", {
    model: {
      plan: async () => ({
        mode: "current",
        queries: ["CRM options for alice@example.com"],
      }),
      generate: async (c: any) => ({
        answer: c.evidence.some((s: any) => s.kind === "web")
          ? "Wrong route"
          : "No private query sent.",
      }),
    },
    search: {
      search: async () => {
        throw Error("Contact data must not be sent");
      },
    },
  });
  assert.equal(turn.answer, "No private query sent.");
  assert.deepEqual(turn.trace.searches, []);
});

test("dated public searches survive the private-contact filter", async () => {
  const turn = await run("Which hosted database plans have changed?", {
    model: {
      plan: async () => ({
        mode: "current",
        queries: ["Postgres pricing since 2026-11-03"],
      }),
      generate: async (c: any) => ({
        answer: c.evidence.some((s: any) => s.kind === "web")
          ? "Dated public evidence."
          : "No evidence.",
      }),
    },
    search: {
      search: async () => [
        {
          title: "Pricing",
          url: "https://example.com",
          content: "Dated public evidence.",
        },
      ],
    },
  });
  assert.equal(turn.answer, "Dated public evidence.");
  assert.equal(
    (turn.trace.searches as any[])[0].query,
    "Postgres pricing since 2026-11-03",
  );
});

test("Monday attendance correctness stays local without a sources-only instruction", async () => {
  const turn = await run(
    "Is Monday's attendance still correct?",
    {
      model: {
        plan: async () => ({
          mode: "verify",
          queries: ["Monday attendance Asha present"],
        }),
        generate: async (c: any) => ({
          answer: c.verification
            ? "Wrong external verification"
            : "Only the retained attendance can establish this; no new register was provided.",
        }),
      },
      search: {
        search: async () => {
          throw Error("Private attendance must not reach search");
        },
      },
    },
    { text: "day,name,status\nMonday,Asha,present", attach: true },
  );
  assert.equal(turn.status, "COMPLETED");
  assert.match(turn.answer, /retained attendance/);
  assert.deepEqual(turn.trace.searches, []);
});

test("external CRM pricing still searches when the shortlist is an attachment", async () => {
  const turn = await run(
    "Has Attio pricing changed since Monday?",
    {
      model: {
        plan: async () => ({
          mode: "verify",
          queries: ["Attio official pricing"],
        }),
        generate: async () => ({
          answer: "Current pricing evidence requires comparison.",
          comparisons: [],
        }),
      },
      search: {
        search: async () => [
          {
            title: "Attio pricing",
            url: "https://attio.com/pricing",
            content: "Current official pricing.",
          },
        ],
      },
    },
    {
      text: "On Monday we shortlisted Attio for our sales team.",
      attach: true,
    },
  );
  assert.equal((turn.trace.searches as any[]).length, 1);
  assert.equal(
    (turn.trace.searches as any[])[0].query,
    "Attio official pricing",
  );
});

test("latest stock price searches even if planner mistakenly says general", async () => {
  const turn = await run("What is the latest stock price of Nvidia?", {
    model: {
      plan: async () => ({ mode: "general", queries: [] }),
      generate: async (c: any) => ({
        answer: c.evidence.some((s: any) => s.kind === "web")
          ? "Quote evidence found."
          : "No quote.",
      }),
    },
    search: {
      search: async () => [
        {
          title: "Quote",
          url: "https://example.com/nvda",
          content: "NVDA quote timestamp.",
        },
      ],
    },
  });
  assert.equal(turn.answer, "Quote evidence found.");
  assert.equal((turn.trace.searches as any[]).length, 1);
});

test("a planner cannot smuggle an unsupported answer through its clarification field", async () => {
  const turn = await run(
    "Using the web, explain snapshot isolation and cite sources.",
    {
      model: {
        plan: async () => ({
          mode: "general",
          queries: [],
          clarification:
            "Snapshot isolation always prevents every concurrency error.",
        }),
        generate: async (c: any) => ({
          answer: c.evidence.some((s: any) => s.kind === "web")
            ? "Answered from actual retained web evidence."
            : "No web evidence.",
        }),
      },
      search: {
        search: async () => [
          {
            title: "Official database documentation",
            url: "https://example.org/snapshots",
            content: "Snapshot isolation has documented constraints.",
          },
        ],
      },
    },
  );
  assert.equal(turn.answer, "Answered from actual retained web evidence.");
  assert.equal(turn.trace.rejectedPlannerClarification, true);
  assert.doesNotMatch(turn.answer, /prevents every/);
});
test("an explicit web request is honored even when planning says general", async () => {
  const turn = await run("Using the web, explain snapshot isolation.", {
    model: {
      plan: async () => ({ mode: "general", queries: [] }),
      generate: async (c: any) => ({
        answer: c.evidence.some((s: any) => s.kind === "web")
          ? "Web evidence retained."
          : "No web evidence.",
      }),
    },
    search: {
      search: async () => [
        {
          title: "Documentation",
          url: "https://example.org/snapshots",
          content: "Snapshot information.",
        },
      ],
    },
  });
  assert.equal(turn.answer, "Web evidence retained.");
});

test("a short genuine planner question remains a clarification", async () => {
  const turn = await run("Can you check its latest price?", {
    model: {
      plan: async () => ({
        mode: "current",
        queries: [],
        clarification: "Which product do you mean?",
      }),
      generate: async () => {
        throw Error("Must clarify before answering");
      },
    },
    search: {
      search: async () => {
        throw Error("Must clarify before search");
      },
    },
  });
  assert.equal(turn.answer, "Which product do you mean?");
  assert.equal(turn.trace.clarification, true);
});
