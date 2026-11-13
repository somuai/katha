// Explicitly opt in: extracted document excerpts are sent to the configured model.
import "dotenv/config";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
import { extractAttachment } from "../src/ingestion/index.ts";
const path = process.argv[process.argv.indexOf("--pdf") + 1];
if (
  !process.argv.includes("--run-live") ||
  !process.argv.includes("--pdf") ||
  !path
)
  throw Error(
    "Use --run-live --pdf /absolute/document.pdf. Sends excerpts to the configured model.",
  );
const directory = await mkdtemp(join(tmpdir(), "katha-pdf-followup-"));
const knownName = process.argv.includes("--name")
  ? process.argv[process.argv.indexOf("--name") + 1]
  : undefined;
let seeding = false;
const adapters = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
});
const app = createKatha({
  directory,
  model: {
    plan: async (c) =>
      seeding ? { mode: "general", queries: [] } : adapters.model.plan!(c),
    generate: async (c) =>
      seeding
        ? { answer: "Identity fixture recorded." }
        : adapters.model.generate(c),
  },
  search: {
    search: async () => {
      throw Error(
        "Document follow-up must stay local; web search is forbidden in this check",
      );
    },
  },
});
try {
  if (knownName) {
    seeding = true;
    const prior = await app.workspace.createConversation();
    const receipt = await app.turns.start({
      conversationId: prior.id,
      clientRequestId: "prior-name",
      expectedTailId: null,
      text: `my name is ${knownName} remember it`,
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    seeding = false;
  }
  const extracted = await extractAttachment(
    await readFile(path),
    basename(path),
    "application/pdf",
    { providers: adapters.providers },
  );
  const source = await app.evidence.import({
    name: basename(path),
    content: extracted.content,
    mimeType: "application/pdf",
  });
  const chat = await app.workspace.createConversation();
  const results = [];
  for (const [i, question] of [
    "what's my contribution in this project",
    "i think its there on page 44",
    ...(knownName
      ? [`My name is ${knownName}. What was my contribution?`]
      : []),
  ].entries()) {
    const current = await app.workspace.getConversation(chat.id);
    const receipt = await app.turns.start({
      conversationId: chat.id,
      clientRequestId: `pdf-${i}`,
      expectedTailId: current.tailId,
      text: question,
      attachmentIds: i === 0 ? [source.sourceId] : [],
    });
    for await (const event of app.turns.events(receipt.turnId))
      if (event.type === "complete") break;
    const snapshot = await app.turns.get(receipt.turnId);
    results.push(snapshot);
    console.log(
      JSON.stringify({
        question,
        status: snapshot.status,
        answer: snapshot.answer,
        error: snapshot.error,
      }),
    );
  }
  await mkdir("data/evaluations", { recursive: true });
  await writeFile(
    "data/evaluations/pdf-page-followup.json",
    JSON.stringify(
      { filename: basename(path), pages: extracted.pages, results },
      null,
      2,
    ),
  );
} finally {
  app.close();
  await rm(directory, { recursive: true, force: true });
}
