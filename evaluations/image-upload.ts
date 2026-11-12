// Explicit opt-in: tests synthetic image data, never an owner's real uploads.
import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
if (!process.argv.includes("--run-live")) {
  console.log(
    "Pass --run-live to test HTTP image upload and recall using Groq.",
  );
  process.exit(0);
}
const directory = await mkdtemp(join(tmpdir(), "katha-image-http-")),
  port = 36500 + Math.floor(Math.random() * 300),
  base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    KATHA_DATA_DIR: directory,
    KATHA_EMBEDDINGS: "off",
  },
  stdio: "pipe",
});
try {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(Error("Server boot timeout")), 15000);
    child.stdout.on("data", (b) => {
      if (String(b).includes("Katha →")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.once("exit", () => reject(Error("Server exited")));
  });
  const canvas = createCanvas(750, 180),
    ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 750, 180);
  ctx.fillStyle = "black";
  ctx.font = "30px sans-serif";
  ctx.fillText("Customer Falcon", 24, 60);
  ctx.fillText("Budget: USD 700", 24, 115);
  const body = new FormData();
  body.append(
    "file",
    new Blob([new Uint8Array(canvas.toBuffer("image/png"))], {
      type: "image/png",
    }),
    "transparent-crm.png",
  );
  const uploaded = await fetch(base + "/api/sources", { method: "POST", body });
  const data: any = await uploaded.json();
  if (!uploaded.ok) throw Error(data.error);
  const response = await fetch(base + "/api/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const chat: any = await response.json();
  const receipt: any = await (
    await fetch(base + `/api/conversations/${chat.id}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientRequestId: "image-check",
        expectedTailId: null,
        text: "Which customer and budget are shown in this image?",
        attachmentIds: [data.source.id],
      }),
    })
  ).json();
  await (await fetch(base + `/api/turns/${receipt.turnId}/events`)).text();
  const turn: any = await (
    await fetch(base + `/api/turns/${receipt.turnId}`)
  ).json();
  const passed =
    turn.status === "COMPLETED" &&
    /Falcon/i.test(turn.answer) &&
    /700/.test(turn.answer);
  await mkdir("data/evaluations", { recursive: true });
  await writeFile(
    "data/evaluations/http-image.json",
    JSON.stringify(
      {
        passed,
        runAt: new Date().toISOString(),
        extracted: data.source.content,
        answer: turn.answer,
        status: turn.status,
        citations: turn.citations,
      },
      null,
      2,
    ),
  );
  console.log({ passed, status: turn.status, answer: turn.answer });
  if (!passed) process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) =>
    child.exitCode !== null ? resolve() : child.once("exit", () => resolve()),
  );
  await rm(directory, { recursive: true, force: true });
}
