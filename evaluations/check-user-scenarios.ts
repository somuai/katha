import "dotenv/config";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createKatha } from "../src/core/index.ts";
import { createKathaAdapters } from "../src/providers/index.ts";
import { extractAttachment } from "../src/ingestion/index.ts";
const dir = await mkdtemp(join(tmpdir(), "katha-user-scenarios-"));
const adapters = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
  model: process.env.GROQ_MODEL,
});
let date = "2026-11-02T10:00:00Z";
const app = createKatha({
  directory: dir,
  clock: () => new Date(date),
  model: adapters.model,
  search: adapters.search,
});
async function ask(chat: any, text: string, attachmentIds: string[] = []) {
  const c = await app.workspace.getConversation(chat.id);
  const receipt = await app.turns.start({
    conversationId: chat.id,
    clientRequestId: crypto.randomUUID(),
    expectedTailId: c.tailId,
    text,
    attachmentIds,
    timezone: "UTC",
  });
  for await (const e of app.turns.events(receipt.turnId))
    if (e.type === "complete") break;
  const t = await app.turns.get(receipt.turnId);
  return {
    question: text,
    status: t.status,
    answer: t.answer,
    error: t.error,
    citations: t.citations.length,
    trace: t.trace,
  };
}
try {
  const csv =
    "name,attendance_monday,stage,deal_value_usd\nAsha,present,qualified,1000\nBela,absent,new,2000\nChirag,present,new,3000\nDivya,present,qualified,4000\nEsha,absent,new,5000\n";
  const extracted = await extractAttachment(
    Buffer.from(csv),
    "crm.csv",
    "text/csv",
    { providers: adapters.providers },
  );
  const csvSource = await app.evidence.import({
    name: "crm.csv",
    content: extracted.content,
    occurredAt: "2026-11-02",
    timezone: "UTC",
  });
  const pdfParts = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  ];
  const stream =
    "BT /F1 16 Tf 40 700 Td (Project Atlas: launch deadline is 18 November. Budget is USD 4200.) Tj ET";
  pdfParts.push(
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < pdfParts.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${pdfParts[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const p = await extractAttachment(
    Buffer.from(pdf),
    "atlas.pdf",
    "application/pdf",
    { providers: adapters.providers },
  );
  const pdfSource = await app.evidence.import({
    name: "atlas.pdf",
    content: p.content,
    occurredAt: "2026-11-02",
    timezone: "UTC",
  });
  const chat = await app.workspace.createConversation();
  const out = [];
  out.push(
    await ask(
      chat,
      "Based on Monday attendance in this CSV, how many were present and absent? Show your reasoning.",
      [csvSource.sourceId],
    ),
  );
  out.push(
    await ask(
      chat,
      "What practical next steps would you recommend from this CRM data?",
    ),
  );
  out.push(
    await ask(chat, "What is the Atlas deadline and budget from the PDF?", [
      pdfSource.sourceId,
    ]),
  );
  date = "2026-11-09T10:00:00Z";
  out.push(
    await ask(
      chat,
      "On Monday we shortlisted Attio, HubSpot, Close, Pipedrive and Folk for a 20-person sales team.",
    ),
  );
  const bigCsv =
    "name,amount\n" +
    Array.from({ length: 100 }, (_, i) => `Customer${i + 1},${i + 1}`).join(
      "\n",
    );
  const big = await app.evidence.import({
    name: "large-crm.csv",
    content: bigCsv,
    occurredAt: "2026-11-09",
    timezone: "UTC",
  });
  out.push(
    await ask(chat, "What is the sum of all 100 amounts in this CSV?", [
      big.sourceId,
    ]),
  );
  out.push(
    await ask(chat, "What amount is listed for Customer100 in the CSV?", [
      big.sourceId,
    ]),
  );
  date = "2026-11-12T12:00:00Z";
  out.push(await ask(chat, "What did I ask you on 2 November?"));
  out.push(
    await ask(
      chat,
      "On Monday we shortlisted Attio, HubSpot, Close, Pipedrive and Folk. Has any pricing changed since?",
    ),
  );
  await writeFile(
    "data/evaluations/user-scenarios.json",
    JSON.stringify(
      {
        csvExtracted: extracted.content,
        pdfExtracted: p.content,
        results: out,
      },
      null,
      2,
    ),
  );
  for (const r of out)
    console.log(
      JSON.stringify({
        question: r.question,
        status: r.status,
        answer: r.answer,
        error: r.error,
        citations: r.citations,
      }),
    );
} finally {
  app.close();
  await rm(dir, { recursive: true, force: true });
}
