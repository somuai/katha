// Explicit opt-in, synthetic fixtures only. Tests the real HTTP/upload/Turns path.
import "dotenv/config";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
if (!process.argv.includes("--run-live")) {
  console.log(
    "Pass --run-live to consume configured model quota using synthetic attachments.",
  );
  process.exit(0);
}
if (!process.env.GROQ_API_KEY)
  throw Error("Configure the server Groq key first.");
const textOnly = process.argv.includes("--text-only");
const imageOnly = process.argv.includes("--image-only");
if (textOnly && imageOnly)
  throw Error("Choose either --text-only or --image-only, not both.");
const expectedCaseIds = [
  ...(!textOnly
    ? ["image-initial", "image-followup", "image-after-restart"]
    : []),
  ...(!imageOnly
    ? [
        "csv-decimal-total",
        "csv-late-row",
        "csv-monday",
        "csv-tuesday",
        "csv-recommendation",
      ]
    : []),
  ...(!textOnly ? ["image-deleted", "image-restored"] : []),
];
const directory = await mkdtemp(join(tmpdir(), "katha-attachment-acceptance-"));
const port = 37000 + Math.floor(Math.random() * 500),
  base = `http://localhost:${port}`;
const results: any[] = [],
  uploads: any[] = [];
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
let child: ReturnType<typeof spawn> | undefined;
async function boot() {
  child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      KATHA_DATA_DIR: directory,
      KATHA_EMBEDDINGS: "off",
    },
    stdio: "pipe",
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Isolated server startup timeout")),
      15000,
    );
    child!.stdout!.on("data", (b) => {
      if (String(b).includes("Katha →")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child!.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Isolated server exited"));
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => child!.once("exit", () => resolve()));
}
async function api(
  path: string,
  body?: unknown,
  method?: string,
): Promise<any> {
  const response = await fetch(base + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error(`${response.status} ${value.code || ""}: ${value.error}`);
  return value;
}
async function upload(name: string, mime: string, bytes: Uint8Array) {
  let value: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type: mime }), name);
    const response = await fetch(base + "/api/sources", {
      method: "POST",
      body: form,
    });
    value = await response.json();
    if (response.ok) break;
    const delay = Number(response.headers.get("retry-after"));
    if (response.status === 429 && attempt < 2 && delay > 0 && delay <= 60) {
      console.log(
        JSON.stringify({ event: "upload-quota-wait", name, seconds: delay }),
      );
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
      continue;
    }
    throw Error(
      `Upload ${name}: ${response.status} ${value.error} (Retry-After: ${delay}s)`,
    );
  }
  const source = value.source;
  uploads.push({
    name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    method: source.metadata?.method,
    warnings: source.metadata?.warnings,
  });
  return source.id as string;
}
async function ask(
  id: string,
  chat: any,
  question: string,
  checks: RegExp[],
  attachmentIds: string[] = [],
  reject: RegExp[] = [],
) {
  const current = await api(`/api/conversations/${chat.id}`);
  const receipt = await api(`/api/conversations/${chat.id}/turns`, {
    clientRequestId: randomUUID(),
    expectedTailId: current.conversation.tailId,
    text: question,
    attachmentIds,
    timezone: "Asia/Kolkata",
  });
  await (await fetch(base + `/api/turns/${receipt.turnId}/events`)).text();
  const turn = await api(`/api/turns/${receipt.turnId}`);
  const assertions = [
    ...checks.map((pattern) => ({
      pattern: pattern.source,
      expected: "present",
      pass: pattern.test(turn.answer),
    })),
    ...reject.map((pattern) => ({
      pattern: pattern.source,
      expected: "absent",
      pass: !pattern.test(turn.answer),
    })),
  ];
  const evidenceOnly = !!turn.trace?.modelFallback;
  const passed =
    !evidenceOnly &&
    ["COMPLETED", "PARTIAL"].includes(turn.status) &&
    !!turn.answer.trim() &&
    assertions.every((a) => a.pass);
  results.push({
    id,
    question,
    status: turn.status,
    error: turn.error,
    answer: turn.answer,
    citations: turn.citations,
    evidenceOnly,
    assertions,
    passed,
    trace: turn.trace,
  });
  console.log(
    JSON.stringify({
      id,
      status: turn.status,
      passed,
      answer: turn.answer,
      error: turn.error,
    }),
  );
  await save();
}
async function save() {
  await mkdir("data/evaluations", { recursive: true });
  await writeFile(
    `data/evaluations/attachment-acceptance-${runId}.json`,
    JSON.stringify(
      {
        label:
          "Synthetic HTTP acceptance checks; regex checks are not supported-claim precision. Manually inspect answers.",
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        startedAt,
        model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b",
        mode: textOnly
          ? "CSV text comparison"
          : imageOnly
            ? "image retention acceptance"
            : "image and CSV acceptance",
        uploads,
        passed: results.filter((r) => r.passed).length,
        total: expectedCaseIds.length,
        expectedCaseIds,
        recordedCases: results.filter((r) => expectedCaseIds.includes(r.id))
          .length,
        missingCaseIds: expectedCaseIds.filter(
          (id) => !results.some((r) => r.id === id),
        ),
        evidenceOnlyResponses: results.filter((r) => r.evidenceOnly).length,
        results,
      },
      null,
      2,
    ),
  );
}
try {
  await boot();
  let image: string | undefined;
  if (!textOnly) {
    const canvas = createCanvas(750, 180),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 750, 180);
    ctx.fillStyle = "#000";
    ctx.font = "30px sans-serif";
    ctx.fillText("Customer Falcon", 24, 60);
    ctx.fillText("Budget: USD 700", 24, 115);
    image = await upload(
      "crm-card.png",
      "image/png",
      canvas.toBuffer("image/png"),
    );
    const imageChat = await api("/api/conversations", {});
    await ask(
      "image-initial",
      imageChat,
      "Which customer and budget are shown in this image?",
      [/Falcon/i, /700/],
      [image],
    );
    await ask("image-followup", imageChat, "What was that budget again?", [
      /700/,
    ]);
    await stop();
    await boot();
    const fresh = await api("/api/conversations", {});
    await ask(
      "image-after-restart",
      fresh,
      "What customer and budget were shown in crm-card.png?",
      [/Falcon/i, /700/],
    );
  }
  if (!imageOnly) {
    const csv =
      "customer,day,status,stage,amount\n" +
      Array.from(
        { length: 120 },
        (_, i) =>
          `Customer${i + 1},${i < 60 ? "Monday" : "Tuesday"},${i < 40 || i >= 60 ? "present" : "absent"},${i < 90 ? "qualified" : "new"},${i === 119 ? "120.20" : "0.10"}`,
      ).join("\n");
    const file = await upload("crm.csv", "text/csv", Buffer.from(csv));
    const chat = await api("/api/conversations", {});
    await ask(
      "csv-decimal-total",
      chat,
      "What is the exact sum of amount across all 120 rows in this CSV?",
      [/132\.1(?:0)?\b/],
      [file],
    );
    await ask(
      "csv-late-row",
      chat,
      "What amount is listed for Customer120 in this CSV?",
      [/120\.2(?:0)?\b/],
    );
    await ask(
      "csv-monday",
      chat,
      "What was Monday attendance: how many were present and absent in this CSV?",
      [
        /\b40\b[^.\n]{0,35}\bpresent\b|\bpresent\b[^.\n]{0,35}\b40\b/i,
        /\b20\b[^.\n]{0,35}\babsent\b|\babsent\b[^.\n]{0,35}\b20\b/i,
      ],
    );
    await ask(
      "csv-tuesday",
      chat,
      "How many were present and absent on Tuesday in this CSV?",
      [
        /\b60\b[^.\n]{0,35}\bpresent\b|\bpresent\b[^.\n]{0,35}\b60\b/i,
        /\b(?:0|zero|no|none)\b[^.\n]{0,30}\babsen(?:t|ce|ces)\b|\babsen(?:t|ce|ces)\b[^.\n]{0,30}\b(?:0|zero|none)\b/i,
      ],
    );
    await ask(
      "csv-recommendation",
      chat,
      "Recommend next steps based only on this CRM CSV. Separate observed facts from suggestions; don't assume these customers are employees.",
      [/suggest|recommend|could|consider|next step/i],
      [],
      [/your (?:sales )?team (?:of|has) 120|120 employees/i],
    );
  }
  if (image) {
    await api(`/api/sources/${image}/trash`, {});
    const deletedChat = await api("/api/conversations", {});
    await ask(
      "image-deleted",
      deletedChat,
      "What customer and budget were shown in crm-card.png? Use retained sources only.",
      [/no |not |cannot|can't|missing|unavailable/i],
      [],
      [/Falcon/i, /\b700\b/],
    );
    await api(`/api/sources/${image}/restore`, {});
    const restoredChat = await api("/api/conversations", {});
    await ask(
      "image-restored",
      restoredChat,
      "What customer and budget were shown in crm-card.png?",
      [/Falcon/i, /700/],
    );
  }
} catch (error) {
  results.push({
    id: "run-error",
    passed: false,
    error: error instanceof Error ? error.message : String(error),
  });
  console.log(JSON.stringify(results.at(-1)));
  process.exitCode = 1;
} finally {
  await save();
  await stop();
  await rm(directory, { recursive: true, force: true });
}
if (results.some((r) => !r.passed)) process.exitCode = 1;
