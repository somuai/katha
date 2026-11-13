import { chromium, firefox, webkit } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "katha-browser-")),
  port = 34400 + Math.floor(Math.random() * 300),
  base = `http://localhost:${port}`;
const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    KATHA_DATA_DIR: directory,
    KATHA_EMBEDDINGS: "off",
    GROQ_API_KEY: "",
    TAVILY_API_KEY: "",
  },
  stdio: "pipe",
});
let browser;
try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error("Server timeout")), 15000);
    child.stdout.on("data", (b) => {
      if (String(b).includes("Katha →")) {
        clearTimeout(t);
        resolve();
      }
    });
    child.once("exit", () => reject(Error("Server exited")));
  });
  const engine = { chromium, firefox, webkit }[
    process.env.BROWSER || "chromium"
  ];
  browser = await engine.launch({
    headless: true,
    ...(process.env.CHROME_PATH &&
    (!process.env.BROWSER || process.env.BROWSER === "chromium")
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [],
    devTransportWarnings = [];
  page.on("pageerror", (e) => {
    if (/^(Error: )?WebSocket closed without opened\.$/.test(e.message))
      devTransportWarnings.push(e.message);
    else errors.push(e.message);
  });
  await page.goto(base);
  await page.getByRole("heading", { name: "Ask Katha", exact: true }).waitFor();
  await mkdir("qa", { recursive: true });
  await page.screenshot({ path: "qa/composer-reference.png" });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("dialog", { name: "Connections" }).waitFor();
  await page.getByRole("heading", { name: "Notion", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Connect Notion", exact: true })
    .waitFor();
  await page.screenshot({ path: "qa/provider-picker.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "provider picker overflows on mobile",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("heading", { name: "Gmail", exact: true }).waitFor();
  await page.getByRole("heading", { name: "HubSpot", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("HTTPS MCP server URL").isVisible(),
    false,
  );
  await page.getByText("Advanced: custom MCP server", { exact: true }).click();
  await page
    .getByLabel("HTTPS MCP server URL")
    .fill("https://fixture.example/mcp");
  const connectionViolations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  assert.deepEqual(
    connectionViolations.map((v) => v.id),
    [],
  );
  await page.screenshot({ path: "qa/connections.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Message Katha" }).fill("@");
  assert.equal(
    await page.locator("#saved-source-picker").getAttribute("open"),
    "",
  );
  await page
    .getByRole("button", { name: "Connect a source…", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Connections" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Message Katha" }).fill("");

  await page.getByLabel("Memory and attachment settings").click();
  await page.getByLabel("Memory scope").selectOption("conversation");
  await page.getByLabel("Memory scope").selectOption("workspace");
  await page.getByLabel("Attachment date").fill("2026-11-03");
  await page.keyboard.press("Escape");
  let accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const initialViolations = accessibility.violations;
  await page.locator("input[type=file]").setInputFiles({
    name: "CRM note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("The price is $20. We need five seats."),
  });
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.locator(".source-list-item").getByRole("button").first().click();
  await page.getByText("Correct a fact", { exact: true }).click();
  await page
    .getByLabel("Which fact?")
    .selectOption({ label: "The price is $20." });
  await page.getByLabel("New wording").fill("The price is $25.");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Correction history", exact: true })
    .waitFor();
  assert.match(await page.locator(".source-content").innerText(), /\$20/);
  assert.match(await page.locator(".correction-lineage").innerText(), /\$25/);
  await page.getByRole("button", { name: "Close source inspector" }).click();
  await page
    .getByRole("textbox", { name: "Message Katha" })
    .fill("Hello Katha");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".message--assistant .message-content").first().waitFor();
  await page
    .getByRole("button", { name: "Original & corrections", exact: true })
    .click();
  await page
    .locator(".source-content")
    .getByText("Hello Katha", { exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  const workspaceBeforeRetry = await (
    await context.request.get(base + "/api/workspace")
  ).json();
  const retryChat = workspaceBeforeRetry.conversations[0];
  const parent = await (
    await context.request.get(base + "/api/turns/" + retryChat.tailId)
  ).json();
  assert.equal(
    parent.status,
    "PARTIAL",
    "Missing inference is visibly partial",
  );
  // Reopen persisted history so this does not depend on an in-memory last request.
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page
    .getByRole("button", { name: "Conversations", exact: true })
    .click();
  await page
    .locator(".history-item")
    .filter({ hasText: retryChat.title })
    .click();
  await page
    .getByRole("button", { name: "Retry this question", exact: true })
    .click();
  await page
    .getByText("Editing a retry · Send creates a new linked turn.")
    .waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Katha" }).inputValue(),
    "Hello Katha",
  );
  const retryResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/turns"),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const receipt = await (await retryResponse).json();
  assert.notEqual(receipt.turnId, parent.id);
  const linked = await (
    await context.request.get(base + "/api/turns/" + receipt.turnId)
  ).json();
  assert.equal(linked.retryOf, parent.id);
  assert.deepEqual(linked.attachmentIds, parent.attachmentIds);
  await page.getByText("Retried question", { exact: true }).waitFor();
  await page.screenshot({ path: "qa/conversation-reference.png" });
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `overflow at ${width}`,
    );
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: "qa/mobile-reference.png" });
  const chatViolations = (
    await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze()
  ).violations;
  const summary = {
    runAt: new Date().toISOString(),
    browser: process.env.BROWSER || "chromium",
    viewports: [375, 768, 1280, 1440],
    checks: [
      "upload",
      "source inspection",
      "assertion correction",
      "original preservation",
      "typed turn",
      "persisted linked retry with attachments",
      "keyboard Escape",
      "responsive overflow",
      "reduced motion",
    ],
    initialViolations,
    chatViolations,
    consoleErrors: errors,
    devTransportWarnings,
  };
  await writeFile(
    `qa/accessibility-${process.env.BROWSER || "chromium"}.json`,
    JSON.stringify(summary, null, 2),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    [...initialViolations, ...chatViolations].map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
  );
  console.log(
    "Browser upload/correction/conversation/responsive/accessibility checks passed.",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) =>
    child.exitCode !== null ? resolve() : child.once("exit", resolve),
  );
  await rm(directory, { recursive: true, force: true });
}
