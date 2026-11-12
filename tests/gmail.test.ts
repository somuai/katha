import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createGmailConnector } from "../src/connectors/gmail.ts";
import { providerCatalog } from "../src/connectors/catalog.ts";
import { createKatha } from "../src/core/index.ts";

const redirectUri = "http://127.0.0.1:3000/api/connections/gmail/callback";
const scope = "https://www.googleapis.com/auth/gmail.readonly";
const encode = (text: string) => Buffer.from(text).toString("base64url");
function fixture(
  options: {
    payload?: unknown;
    count?: number;
    tokenFail?: boolean;
    badScope?: boolean;
  } = {},
) {
  const calls: { url: string; method: string; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.href,
      method: init?.method || "GET",
      body: String(init?.body || ""),
    });
    assert.equal(init?.redirect, "error");
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.hostname === "oauth2.googleapis.com")
      return options.tokenFail
        ? json(
            {
              error: "invalid_grant",
              error_description: "secret-provider-details",
            },
            400,
          )
        : json({
            access_token: "fixture-token",
            refresh_token: "fixture-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            scope: options.badScope ? "https://mail.google.com/" : scope,
          });
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture-token",
    );
    if (url.pathname.endsWith("/messages"))
      return json({
        messages: Array.from({ length: options.count || 1 }, (_, i) => ({
          id: "mail" + i,
        })),
        nextPageToken: "page-2",
      });
    const id = url.pathname.split("/").at(-1)!;
    if (url.searchParams.get("format") === "metadata")
      return json({
        id,
        threadId: "thread",
        snippet: "Mail preview",
        payload: {
          headers: [
            { name: "Subject", value: "Monday CRM shortlist" },
            { name: "From", value: "team@example.test" },
            { name: "Date", value: "Mon, 2 Nov 2026 10:00:00 +0000" },
          ],
        },
      });
    if (url.pathname.includes("/attachments/"))
      return json({ data: encode("Inline body from Gmail body storage") });
    return json({
      id,
      threadId: "thread",
      internalDate: "1793613600000",
      payload: options.payload || {
        mimeType: "text/plain",
        headers: [{ name: "Subject", value: "Monday CRM shortlist" }],
        body: {
          data: encode("We shortlisted Acme CRM and Orbit CRM for 20 seats."),
        },
      },
    });
  };
  return { calls, fetcher };
}
function setup(options: Parameters<typeof fixture>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), "katha-gmail-")),
    remote = fixture(options);
  let now = 1000000;
  const config = {
    directory: join(directory, "private"),
    redirectUri,
    clientId: "fixture-google-client",
    clientSecret: "fixture-secret",
    fetcher: remote.fetcher,
    clock: () => now,
  };
  const gmail = createGmailConnector(config);
  return {
    directory,
    remote,
    gmail,
    config,
    advance(ms: number) {
      now += ms;
    },
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function authorize(gmail: ReturnType<typeof createGmailConnector>) {
  const { authorizationUrl } = await gmail.start();
  const url = new URL(authorizationUrl);
  await gmail.finish(url.searchParams.get("state")!, "code");
  return url;
}

test("Gmail readonly PKCE consent survives restart and never exposes tokens in status", async () => {
  const f = setup();
  try {
    const start = await f.gmail.start(),
      url = new URL(start.authorizationUrl);
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("scope"), scope);
    assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const path = join(f.config.directory, "gmail.json"),
      saved = JSON.parse(readFileSync(path, "utf8"));
    assert.notEqual(saved.pending.stateHash, url.searchParams.get("state"));
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(saved.pending.verifier).digest("base64url"),
    );
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o777, 0o600);
    if (process.platform !== "win32")
      assert.equal(statSync(f.config.directory).mode & 0o777, 0o700);
    await f.gmail.finish(url.searchParams.get("state")!, "code");
    const exchange = new URLSearchParams(f.remote.calls[0].body);
    assert.equal(exchange.get("code_verifier"), saved.pending.verifier);
    assert.equal(exchange.get("client_secret"), "fixture-secret");
    assert.equal(exchange.get("redirect_uri"), redirectUri);
    const restarted = createGmailConnector(f.config);
    assert.equal(restarted.status().connected, true);
    assert.equal(
      JSON.stringify(restarted.status()).includes("fixture-token"),
      false,
    );
    await assert.rejects(
      f.gmail.finish(url.searchParams.get("state")!, "code"),
      { code: "GMAIL_STATE_INVALID" },
    );
    f.advance(3600000);
    await restarted.list();
    assert.equal(
      f.remote.calls.some(
        (c) =>
          new URLSearchParams(c.body).get("grant_type") === "refresh_token",
      ),
      true,
    );
  } finally {
    f.close();
  }
});

test("explicitly selected Gmail message imports into real evidence with provenance and supports recall", async () => {
  const f = setup(),
    app = createKatha({ directory: join(f.directory, "workspace") });
  try {
    await authorize(f.gmail);
    await assert.rejects(f.gmail.importMessage("mail0", app.evidence), {
      code: "GMAIL_MESSAGE_NOT_LISTED",
    });
    const list = await f.gmail.list("after:2026/11/01 CRM", "cursor");
    assert.equal(list.messages[0].subject, "Monday CRM shortlist");
    assert.equal(list.nextCursor, "page-2");
    const query = new URL(
      f.remote.calls.find((c) => c.url.includes("maxResults"))!.url,
    );
    assert.equal(query.searchParams.get("maxResults"), "20");
    assert.equal(query.searchParams.get("q"), "after:2026/11/01 CRM");
    const receipt = await f.gmail.importMessage("mail0", app.evidence);
    assert.equal(receipt.resourceUri, "gmail://messages/mail0");
    const inspected = await app.evidence.inspect(receipt.sourceId);
    assert.match(JSON.stringify(inspected), /Acme CRM/);
    assert.match(JSON.stringify(inspected), /gmail-selected-message/);
    const recalled = await app.evidence.recall({ text: "Acme CRM" });
    assert.match(JSON.stringify(recalled), /20 seats/);
    assert.equal(
      f.remote.calls.every(
        (c) => c.url.includes("oauth2.googleapis.com") || c.method === "GET",
      ),
      true,
    );
  } finally {
    app.close();
    f.close();
  }
});

test("MIME parser prefers plain alternatives, keeps nested bodies and skips file attachments", async () => {
  const f = setup({
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/html",
              body: { data: encode("<p>Duplicate HTML alternative</p>") },
            },
            {
              mimeType: "text/plain",
              body: { data: encode("Original plain wording") },
            },
          ],
        },
        {
          mimeType: "multipart/related",
          parts: [
            {
              mimeType: "text/html",
              body: {
                data: encode(
                  "<script>bad()</script><p>Additional &amp; quoted &#x20b9; text</p>",
                ),
              },
            },
            { mimeType: "image/png", body: { data: encode("binary") } },
          ],
        },
        {
          mimeType: "text/plain",
          filename: "private-notes.txt",
          body: { attachmentId: "not-requested" },
        },
        { mimeType: "text/plain", body: { attachmentId: "inline-body" } },
      ],
    },
  });
  const imports: any[] = [];
  try {
    await authorize(f.gmail);
    await f.gmail.list();
    await f.gmail.importMessage("mail0", {
      async import(input) {
        imports.push(input);
        return { sourceId: "source" };
      },
    });
    assert.match(imports[0].content, /Original plain wording/);
    assert.match(imports[0].content, /Additional & quoted ₹ text/);
    assert.match(imports[0].content, /Inline body from Gmail body storage/);
    assert.doesNotMatch(
      imports[0].content,
      /Duplicate HTML|bad\(\)|private-notes/,
    );
    assert.deepEqual(imports[0].metadata.extractionMethods, [
      "plain-text",
      "html-to-inert-text",
    ]);
    assert.equal(imports[0].metadata.attachmentsImported, false);
    assert.equal(
      f.remote.calls.some((c) => c.url.includes("not-requested")),
      false,
    );
  } finally {
    f.close();
  }
});

test("list and imports are bounded; stale selections and oversized MIME text reject", async () => {
  const f = setup({
    count: 25,
    payload: {
      mimeType: "text/plain",
      body: { size: 1024 * 1024 + 1, data: encode("too large") },
    },
  });
  try {
    await authorize(f.gmail);
    const list = await f.gmail.list();
    assert.equal(list.messages.length, 20);
    await assert.rejects(
      f.gmail.importMessage("mail0", {
        async import() {
          throw Error("Must not import");
        },
      }),
      { code: "GMAIL_MESSAGE_TOO_LARGE" },
    );
    f.advance(300000);
    await assert.rejects(
      f.gmail.importMessage("mail0", {
        async import() {
          throw Error("Must not import");
        },
      }),
      { code: "GMAIL_MESSAGE_NOT_LISTED" },
    );
    await assert.rejects(f.gmail.list("x".repeat(1001)), {
      code: "GMAIL_QUERY_TOO_LONG",
    });
  } finally {
    f.close();
  }
});

test("expiry, failed consent and excessive scopes do not establish connected status", async () => {
  for (const options of [{ tokenFail: true }, { badScope: true }, {}]) {
    const f = setup(options);
    try {
      const start = await f.gmail.start(),
        state = new URL(start.authorizationUrl).searchParams.get("state")!;
      if (!options.tokenFail && !options.badScope) f.advance(600000);
      await assert.rejects(f.gmail.finish(state, "code"));
      assert.equal(f.gmail.status().connected, false);
      await assert.rejects(f.gmail.finish(state, "code"), {
        code: "GMAIL_STATE_INVALID",
      });
    } finally {
      f.close();
    }
  }
});

test("disconnect during an exchange cannot restore tokens; provider catalog is honest", async () => {
  const f = setup();
  let release!: () => void, entered!: () => void;
  const wait = new Promise<void>((resolve) => {
      release = resolve;
    }),
    entry = new Promise<void>((resolve) => {
      entered = resolve;
    });
  const gmail = createGmailConnector({
    ...f.config,
    fetcher: async (input, init) => {
      entered();
      await wait;
      return f.remote.fetcher(input, init);
    },
  });
  try {
    const start = await gmail.start(),
      pending = gmail.finish(
        new URL(start.authorizationUrl).searchParams.get("state")!,
        "code",
      );
    await entry;
    gmail.disconnect();
    release();
    await assert.rejects(pending, { code: "GMAIL_SESSION_CHANGED" });
    assert.equal(gmail.status().connected, false);
    const catalog = providerCatalog({
      gmailConfigured: false,
      gmailConnected: false,
    });
    assert.equal(
      catalog
        .filter((p) => p.id !== "notion")
        .every((p) => !p.available && !p.connected),
      true,
    );
    const enabled = providerCatalog({
      gmailConfigured: true,
      gmailConnected: true,
    });
    assert.equal(enabled.filter((p) => p.available).length, 2);
    assert.equal(enabled.find((p) => p.id === "gmail")?.connected, true);
    assert.equal(
      catalog.find((p) => p.id === "notion")?.integration,
      "Official MCP",
    );
    assert.throws(
      () =>
        createGmailConnector({
          directory: f.directory,
          redirectUri: "http://evil.example:3000/callback",
        }),
      { code: "GMAIL_CALLBACK_INVALID" },
    );
    const unconfigured = createGmailConnector({
      directory: join(f.directory, "none"),
      redirectUri,
    });
    await assert.rejects(unconfigured.start(), {
      code: "GMAIL_NOT_CONFIGURED",
    });
  } finally {
    release();
    f.close();
  }
});

test("Gmail surfaces bounded Retry-After for plain-text 429/503 without retrying or caching failures", async () => {
  for (const scenario of [
    { status: 429, header: "9999", expected: 120 },
    { status: 429, header: "17", expected: 17 },
    { status: 503, header: new Date(1045000).toUTCString(), expected: 45 },
    { status: 503, header: "invalid", expected: 30 },
  ]) {
    const f = setup();
    let limited = false,
      attempts = 0;
    const gmail = createGmailConnector({
      ...f.config,
      fetcher: async (input, init) => {
        if (limited) {
          attempts++;
          return new Response(
            "Provider temporarily unavailable: private diagnostics",
            {
              status: scenario.status,
              headers: { "Retry-After": scenario.header },
            },
          );
        }
        return f.remote.fetcher(input, init);
      },
    });
    try {
      await authorize(gmail);
      limited = true;
      await assert.rejects(
        gmail.list(),
        (error: any) =>
          error.status === scenario.status &&
          error.retryAfter === scenario.expected &&
          !error.message.includes("private"),
      );
      assert.equal(attempts, 1);
      limited = false;
      assert.equal((await gmail.list()).messages.length, 1);
      assert.equal(gmail.status().connected, true);
    } finally {
      f.close();
    }
  }
});

test("Gmail disconnect during selected-message fetch prevents a stale evidence import", async () => {
  const f = setup();
  let entered!: () => void,
    release!: () => void,
    imported = false;
  const entry = new Promise<void>((r) => {
      entered = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const gmail = createGmailConnector({
    ...f.config,
    fetcher: async (input, init) => {
      if (String(input).includes("format=full")) {
        entered();
        await wait;
      }
      return f.remote.fetcher(input, init);
    },
  });
  try {
    await authorize(gmail);
    await gmail.list();
    const pending = gmail.importMessage("mail0", {
      async import() {
        imported = true;
        return { sourceId: "stale" };
      },
    });
    await entry;
    gmail.disconnect();
    release();
    await assert.rejects(pending, { code: "GMAIL_SESSION_CHANGED" });
    assert.equal(imported, false);
  } finally {
    release();
    f.close();
  }
});
