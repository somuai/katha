import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createKatha } from "../src/core/index.ts";
const helper = fileURLToPath(
  new URL("./fixtures/workspace-owner.ts", import.meta.url),
);
test(
  "a second process cannot interrupt the active workspace owner; close permits the next owner",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "katha-owner-"));
    const app = createKatha({
      directory,
      model: {
        generate: ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          ),
      },
    });
    let closed = false;
    try {
      const chat = await app.workspace.createConversation();
      const receipt = await app.turns.start({
        conversationId: chat.id,
        clientRequestId: "owner",
        expectedTailId: null,
        text: "Preserve the active owner record.",
      });
      for await (const event of app.turns.events(receipt.turnId))
        if (event.type === "status" && (event.data as any).status === "RUNNING")
          break;
      const probe = spawnSync(
        process.execPath,
        ["--import", "tsx", helper, directory, "probe"],
        { encoding: "utf8", timeout: 15000 },
      );
      assert.equal(probe.status, 0, probe.stderr);
      const result = JSON.parse(probe.stdout.trim());
      assert.equal(result.ok, false);
      assert.equal(result.code, "WORKSPACE_IN_USE");
      assert.equal((await app.turns.get(receipt.turnId)).status, "RUNNING");
      await app.turns.cancel(receipt.turnId);
      app.close();
      closed = true;
      const next = createKatha({ directory });
      try {
        assert.equal(
          (await next.turns.get(receipt.turnId)).status,
          "CANCELLED",
        );
        assert.ok(
          (await next.workspace.getConversation(chat.id)).messages.some(
            (m) => m.content === "Preserve the active owner record.",
          ),
        );
      } finally {
        next.close();
      }
    } finally {
      if (!closed) app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
test(
  "a killed owner releases SQLite locks and the successor recovers accepted history",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "katha-crash-owner-"));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", helper, directory, "hold"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const ready = await new Promise<{
        ok: boolean;
        conversationId: string;
        turnId: string;
      }>((resolve, reject) => {
        let buffer = "";
        child.stdout.on("data", (data) => {
          buffer += String(data);
          if (buffer.includes("\n")) {
            try {
              resolve(JSON.parse(buffer.split("\n")[0]));
            } catch (error) {
              reject(error);
            }
          }
        });
        child.once("error", reject);
        child.once("exit", (code) =>
          reject(Error(`Owner exited before ready: ${code}`)),
        );
      });
      assert.equal(ready.ok, true);
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
      const successor = createKatha({ directory });
      try {
        assert.equal(
          (await successor.turns.get(ready.turnId)).status,
          "INTERRUPTED",
        );
        assert.ok(
          (
            await successor.workspace.getConversation(ready.conversationId)
          ).messages.some(
            (m) => m.content === "Crash-persistent accepted input.",
          ),
        );
      } finally {
        successor.close();
      }
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("failed startup releases ownership instead of leaking a locked connection", () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-failed-owner-"));
  try {
    assert.throws(
      () =>
        createKatha({
          directory,
          clock: () => {
            throw Error("fixture startup clock failed");
          },
        }),
      /fixture startup clock failed/,
    );
    const next = createKatha({ directory });
    next.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "simultaneous startup has exactly one owner and cannot mutate the winner's turn",
  { timeout: 30000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "katha-owner-race-"));
    const children = [0, 1].map(() =>
      spawn(process.execPath, ["--import", "tsx", helper, directory, "hold"], {
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    try {
      const results = await Promise.all(
        children.map(
          (child) =>
            new Promise<any>((resolve, reject) => {
              let buffer = "";
              child.stdout.on("data", (data) => {
                buffer += String(data);
                if (buffer.includes("\n")) {
                  try {
                    resolve(JSON.parse(buffer.split("\n")[0]));
                  } catch (error) {
                    reject(error);
                  }
                }
              });
              child.once("error", reject);
              child.once("exit", (code) =>
                reject(Error(`Child exited before result: ${code}`)),
              );
            }),
        ),
      );
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(
        results.filter((r) => r.code === "WORKSPACE_IN_USE").length,
        1,
      );
      const winner = results.find((r) => r.ok);
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
          }
        }),
      );
      const successor = createKatha({ directory });
      try {
        assert.equal(
          (await successor.turns.get(winner.turnId)).status,
          "INTERRUPTED",
        );
        assert.ok(
          (
            await successor.workspace.getConversation(winner.conversationId)
          ).messages.some(
            (m) => m.content === "Crash-persistent accepted input.",
          ),
        );
      } finally {
        successor.close();
      }
    } finally {
      await Promise.all(
        children.map(async (child) => {
          if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
          }
        }),
      );
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
