import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("HTTP persists a turn and exposes complete replay without configured providers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "katha-http-")),
    port = 33000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      KATHA_DATA_DIR: dir,
      KATHA_EMBEDDINGS: "off",
      GROQ_API_KEY: "",
      TAVILY_API_KEY: "",
    },
    stdio: "pipe",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Server did not boot")),
        15000,
      );
      child.stdout.on("data", (x) => {
        if (String(x).includes("Katha →")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("exit", () => reject(Error("Server exited")));
    });
    const api = async (url: string, body?: any) => {
      const r = await fetch(
        `http://localhost:${port}${url}`,
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {},
      );
      assert.ok(r.ok, await r.clone().text());
      return r.json();
    };
    const workspace = await api("/api/workspace");
    assert.deepEqual(workspace.conversations, []);
    const c = await api("/api/conversations", { title: "HTTP fixture" });
    const input = {
      clientRequestId: "one",
      expectedTailId: null,
      text: "Hello Katha",
    };
    const t = await api(`/api/conversations/${c.id}/turns`, input);
    assert.equal(
      (await api(`/api/conversations/${c.id}/turns`, input)).turnId,
      t.turnId,
    );
    const stream = await fetch(
      `http://localhost:${port}/api/turns/${t.turnId}/events`,
    ).then((r) => r.text());
    assert.match(stream, /'?complete'?/);
    const snapshot = await api(`/api/turns/${t.turnId}`);
    assert.equal(snapshot.status, "COMPLETED");
    const chat = await api(`/api/conversations/${c.id}`);
    assert.equal(chat.messages.filter((m: any) => m.role === "user").length, 1);
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    await rm(dir, { recursive: true, force: true });
  }
});
