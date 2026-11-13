import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";

test("provider quota leaves relevant retained PDF evidence readable without pretending to generate an answer", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-evidence-recovery-"));
  const app = createKatha({
    directory,
    model: {
      generate: async () => {
        throw Object.assign(new Error("Provider quota exhausted"), {
          code: "RATE_LIMIT",
          retryAt: Date.now() + 600000,
        });
      },
    },
  });
  try {
    const file = await app.evidence.import({
      name: "team.pdf",
      content:
        "[Page 44]\nStudent: Alia Das Roll number: 1 Contribution: I led architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution: I tested local models. Key findings: Specific to this setup.",
    });
    const chat = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "rate-limited",
      expectedTailId: null,
      text: "What did Bo do in this PDF?",
      attachmentIds: [file.sourceId],
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const turn = await app.turns.get(receipt.turnId);
    assert.equal(turn.status, "PARTIAL");
    assert.match(turn.answer, /not a generated answer/i);
    assert.match(turn.answer, /tested local models/);
    assert.match(turn.answer, /Specific to this setup/);
    assert.doesNotMatch(turn.answer, /led architecture/);
    assert.deepEqual(turn.trace.modelFallback, {
      reasonCode: "QUOTA_WAIT_EXCEEDED",
      mode: "retained-evidence-only",
      generatedAnswer: false,
    });
    assert.ok(turn.citations.some((c) => c.sourceId === file.sourceId));
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source-only partial turns preserve attachment and contributor focus through long follow-ups", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-partial-followup-"));
  const app = createKatha({
    directory,
    model: {
      generate: async () => {
        throw Object.assign(new Error("Provider quota exhausted"), {
          code: "RATE_LIMIT",
          retryAt: Date.now() + 600000,
        });
      },
    },
  });
  try {
    const file = await app.evidence.import({
      name: "team.pdf",
      content:
        "[Page 44]\nStudent: Alia Das Roll number: 1 Contribution: I led architecture.\n\n[Page 45]\nStudent: Bo Sen Roll number: 2 Contribution: I tested local models.",
    });
    const chat = await app.workspace.createConversation();
    for (let i = 0; i < 15; i++) {
      const current = await app.workspace.getConversation(chat.id);
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: `partial-${i}`,
        expectedTailId: current.tailId,
        text:
          i === 0
            ? "What did Bo do in this PDF?"
            : "What did he do in the project?",
        attachmentIds: i === 0 ? [file.sourceId] : [],
      });
      for await (const event of app.turns.events(receipt.turnId))
        if (event.type === "complete") break;
      const turn = await app.turns.get(receipt.turnId);
      assert.equal(turn.status, "PARTIAL");
      assert.match(turn.answer, /tested local models/);
      assert.doesNotMatch(turn.answer, /led architecture/);
    }
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence recovery cannot reintroduce a source deleted during inference", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-recovery-delete-"));
  let app: ReturnType<typeof createKatha>,
    sourceId = "";
  app = createKatha({
    directory,
    model: {
      generate: async () => {
        await app.evidence.trash(sourceId);
        throw Object.assign(new Error("Model down"), {
          code: "MODEL_UNAVAILABLE",
        });
      },
    },
  });
  try {
    sourceId = (
      await app.evidence.import({
        name: "private.pdf",
        content: "[Page 1]\nPrivate token: COBALT-731.",
      })
    ).sourceId;
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "delete-race",
      expectedTailId: null,
      text: "What token is in this PDF?",
      attachmentIds: [sourceId],
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    const t = await app.turns.get(r.turnId);
    assert.equal(t.status, "CANCELLED");
    assert.doesNotMatch(t.answer, /COBALT-731/);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("provider failure never promotes historical quotes to verified current facts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-recovery-verify-"));
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T12:00:00Z"),
    model: {
      generate: async () => {
        throw Object.assign(new Error("Model down"), {
          code: "MODEL_UNAVAILABLE",
        });
      },
    },
    search: {
      search: async () => [
        {
          title: "New release",
          url: "https://fixture.example/export",
          content: "Effective 2026-11-10, export supports CSV and JSON.",
        },
      ],
    },
  });
  try {
    await app.evidence.import({
      name: "baseline.md",
      content: "Export supports JSON only.",
      occurredAt: "2026-11-03",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "unverified",
      expectedTailId: null,
      text: "Has export changed since 3 November?",
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    const t = await app.turns.get(r.turnId);
    assert.equal(t.status, "PARTIAL");
    assert.ok(t.comparisons.length);
    assert.ok(t.comparisons.every((c) => c.status === "UNVERIFIED"));
    assert.match(t.answer, /verification remains unresolved/i);
    assert.doesNotMatch(t.answer, /currently matches|supports CSV/i);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unavailable named file does not expose unrelated retained data during provider failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-recovery-scope-"));
  const app = createKatha({
    directory,
    model: {
      generate: async () => {
        throw Object.assign(new Error("Model down"), {
          code: "MODEL_UNAVAILABLE",
        });
      },
    },
  });
  try {
    await app.evidence.import({
      name: "other.csv",
      content: "customer,budget\nFalcon,700\n",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "unrelated",
      expectedTailId: null,
      text: "What budget is in invoice.pdf? Use retained sources only.",
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    const t = await app.turns.get(r.turnId);
    assert.equal(t.status, "PARTIAL");
    assert.match(t.answer, /No eligible retained excerpt/);
    assert.doesNotMatch(t.answer, /Falcon|700/);
    assert.deepEqual(t.citations, []);
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("quota recovery preserves individual unresolved coverage for every shortlisted vendor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-recovery-vendors-"));
  const app = createKatha({
    directory,
    clock: () => new Date("2026-11-13T12:00:00Z"),
    model: {
      generate: async () => {
        throw Object.assign(new Error("Model down"), {
          code: "MODEL_UNAVAILABLE",
        });
      },
    },
    search: {
      search: async () => [
        {
          title: "Current vendor information",
          url: "https://fixture.example/vendors",
          content:
            "Alder, Birch, Cedar, Maple and Willow publish product information here.",
        },
      ],
    },
  });
  try {
    await app.evidence.import({
      name: "shortlist.md",
      content:
        "We shortlisted Alder, Birch, Cedar, Maple and Willow for a 20-person sales team. No prices were retained.",
      occurredAt: "2026-11-03",
    });
    const chat = await app.workspace.createConversation();
    const r = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: "vendor-quota",
      expectedTailId: null,
      text: "Has our CRM shortlist changed since 3 November?",
    });
    for await (const e of app.turns.events(r.turnId))
      if (e.type === "complete") break;
    const t = await app.turns.get(r.turnId);
    assert.equal(t.status, "PARTIAL");
    assert.equal(t.comparisons.length, 5);
    assert.ok(t.comparisons.every((c) => c.status === "UNVERIFIED"));
    for (const name of ["Alder", "Birch", "Cedar", "Maple", "Willow"])
      assert.ok(t.comparisons.some((c) => c.claim.includes(name)));
  } finally {
    app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
