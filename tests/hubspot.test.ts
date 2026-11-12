import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHubspotConnector,
  type HubspotObjectKind,
} from "../src/connectors/hubspot.ts";
import { providerCatalog } from "../src/connectors/catalog.ts";
import { createKatha } from "../src/core/index.ts";
const redirectUri = "http://127.0.0.1:3000/api/connections/hubspot/callback";
function fixture(
  options: {
    kinds?: HubspotObjectKind[];
    writeScope?: boolean;
    count?: number;
    failToken?: boolean;
    large?: boolean;
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
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/oauth/v3/token") {
      assert.equal(url.hostname, "api.hubspot.com");
      return options.failToken
        ? json(
            { error: "invalid_grant", message: "private upstream details" },
            400,
          )
        : json({
            access_token: "fixture-token",
            refresh_token: "fixture-refresh",
            token_type: "bearer",
            scopes: [
              "oauth",
              ...(options.kinds || ["contacts"]).map(
                (k) => `crm.objects.${k}.read`,
              ),
              ...(options.writeScope ? ["crm.objects.contacts.write"] : []),
            ],
            expires_in: 1800,
          });
    }
    assert.equal(url.hostname, "api.hubapi.com");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer fixture-token",
    );
    const kind = url.pathname.split("/")[4];
    const record = (id: string) => ({
      id,
      properties:
        kind === "contacts"
          ? {
              firstname: "Asha",
              lastname: "Roy",
              email: "asha@example.test",
              company: "Orbit Labs",
              custom_secret: "not-selected",
            }
          : kind === "companies"
            ? {
                name: "Orbit Labs",
                domain: "orbit.example",
                numberofemployees: "20",
              }
            : {
                dealname: "Orbit renewal",
                amount: "50000",
                deal_currency_code: "INR",
                description: options.large
                  ? "x".repeat(1024 * 1024)
                  : "Annual contract",
              },
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-12T00:00:00Z",
      archived: false,
    });
    if (url.pathname.endsWith("/search"))
      return json({
        results: Array.from({ length: options.count || 1 }, (_, i) =>
          record(String(i + 1)),
        ),
        paging: {
          next: { after: "20", link: "https://evil.example/never-follow" },
        },
      });
    return json(record(url.pathname.split("/").at(-1)!));
  };
  return { fetcher, calls };
}
function setup(options: Parameters<typeof fixture>[0] = {}) {
  const directory = mkdtempSync(join(tmpdir(), "katha-hubspot-")),
    remote = fixture(options);
  let now = 1000000;
  const config = {
    directory: join(directory, "private"),
    redirectUri,
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
    fetcher: remote.fetcher,
    clock: () => now,
  };
  const hubspot = createHubspotConnector(config);
  return {
    directory,
    remote,
    config,
    hubspot,
    advance(ms: number) {
      now += ms;
    },
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
async function authorize(
  hubspot: ReturnType<typeof createHubspotConnector>,
  kinds: HubspotObjectKind[] = ["contacts"],
) {
  const { authorizationUrl } = await hubspot.start(kinds),
    url = new URL(authorizationUrl);
  await hubspot.finish(url.searchParams.get("state")!, "code");
  return url;
}

test("HubSpot uses documented v3 confidential OAuth with exact selected read scopes and private restart/refresh", async () => {
  const f = setup({ kinds: ["contacts", "companies"] });
  try {
    const url = await authorize(f.hubspot, ["contacts", "companies"]);
    assert.equal(url.origin, "https://app.hubspot.com");
    assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
    assert.deepEqual(url.searchParams.get("scope")!.split(" "), [
      "oauth",
      "crm.objects.contacts.read",
      "crm.objects.companies.read",
    ]);
    assert.equal(url.searchParams.has("client_secret"), false);
    assert.equal(url.searchParams.has("code_challenge"), false); // Not documented for ordinary HubSpot app OAuth.
    const request = new URLSearchParams(f.remote.calls[0].body);
    assert.equal(request.get("client_secret"), "fixture-secret");
    assert.equal(request.get("redirect_uri"), redirectUri);
    const path = join(f.config.directory, "hubspot.json");
    if (process.platform !== "win32")
      assert.equal(statSync(path).mode & 0o777, 0o600);
    if (process.platform !== "win32")
      assert.equal(statSync(f.config.directory).mode & 0o777, 0o700);
    assert.equal(
      JSON.stringify(f.hubspot.status()).includes("fixture-token"),
      false,
    );
    const restarted = createHubspotConnector(f.config);
    assert.equal(restarted.status().connected, true);
    await assert.rejects(restarted.list("deals"), {
      code: "HUBSPOT_KIND_NOT_AUTHORIZED",
    });
    await assert.rejects(
      restarted.finish(url.searchParams.get("state")!, "code"),
      { code: "HUBSPOT_STATE_INVALID" },
    );
    f.advance(1800000);
    await restarted.list("contacts");
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

test("selected CRM record imports real evidence with provenance and no unrequested custom properties", async () => {
  const f = setup(),
    app = createKatha({ directory: join(f.directory, "workspace") });
  try {
    await authorize(f.hubspot);
    await assert.rejects(
      f.hubspot.importRecord("contacts", "1", app.evidence),
      { code: "HUBSPOT_RECORD_NOT_LISTED" },
    );
    const list = await f.hubspot.list("contacts", "Orbit", "10");
    assert.equal(list.resources[0].title, "Asha Roy");
    assert.equal(list.nextCursor, "20");
    const search = f.remote.calls.find((c) => c.url.endsWith("/search"))!;
    assert.equal(search.method, "POST");
    assert.equal(JSON.parse(search.body).limit, 20);
    assert.equal(JSON.parse(search.body).after, "10");
    const receipt = await f.hubspot.importRecord("contacts", "1", app.evidence);
    assert.equal(receipt.resourceUri, "hubspot://contacts/1");
    const inspection = JSON.stringify(
      await app.evidence.inspect(receipt.sourceId),
    );
    assert.match(inspection, /Asha/);
    assert.match(inspection, /hubspot-selected-record/);
    assert.doesNotMatch(inspection, /not-selected/);
    assert.match(
      JSON.stringify(await app.evidence.recall({ text: "Orbit Labs" })),
      /Orbit Labs/,
    );
    assert.equal(
      f.remote.calls.some((c) => c.url.includes("evil.example")),
      false,
    );
    assert.equal(
      f.remote.calls.every(
        (c) =>
          c.url.endsWith("/oauth/v3/token") ||
          c.url.endsWith("/search") ||
          c.method === "GET",
      ),
      true,
    );
  } finally {
    app.close();
    f.close();
  }
});

test("CRM object scopes are independent, query/list size bounded and selected IDs expire", async () => {
  const f = setup({ kinds: ["deals"], count: 25 });
  try {
    await authorize(f.hubspot, ["deals"]);
    const list = await f.hubspot.list("deals");
    assert.equal(list.resources.length, 20);
    const inputs: any[] = [];
    await f.hubspot.importRecord("deals", "1", {
      async import(input) {
        inputs.push(input);
        return { sourceId: "source" };
      },
    });
    assert.match(inputs[0].content, /"deal_currency_code": "INR"/);
    await assert.rejects(f.hubspot.list("contacts"), {
      code: "HUBSPOT_KIND_NOT_AUTHORIZED",
    });
    await assert.rejects(f.hubspot.list("deals", "x".repeat(1001)), {
      code: "HUBSPOT_INVALID_QUERY",
    });
    await assert.rejects(f.hubspot.list("deals", "", "https://evil.example"), {
      code: "HUBSPOT_INVALID_QUERY",
    });
    f.advance(300000);
    await assert.rejects(
      f.hubspot.importRecord("deals", "1", {
        async import() {
          throw Error("Do not import");
        },
      }),
      { code: "HUBSPOT_RECORD_NOT_LISTED" },
    );
  } finally {
    f.close();
  }
});

test("unexpected write permissions, expired state and provider failures cannot connect", async () => {
  for (const options of [{ writeScope: true }, { failToken: true }, {}]) {
    const f = setup(options);
    try {
      const { authorizationUrl } = await f.hubspot.start(),
        state = new URL(authorizationUrl).searchParams.get("state")!;
      const saved = JSON.parse(
        readFileSync(join(f.config.directory, "hubspot.json"), "utf8"),
      );
      assert.notEqual(saved.pending.hash, state);
      if (!options.writeScope && !options.failToken) f.advance(600000);
      await assert.rejects(f.hubspot.finish(state, "code"));
      assert.equal(f.hubspot.status().connected, false);
      await assert.rejects(f.hubspot.finish(state, "code"), {
        code: "HUBSPOT_STATE_INVALID",
      });
    } finally {
      f.close();
    }
  }
});

test("disconnect during OAuth exchange prevents restoring a removed connection", async () => {
  const f = setup();
  let entered!: () => void, release!: () => void;
  const entry = new Promise<void>((r) => {
      entered = r;
    }),
    wait = new Promise<void>((r) => {
      release = r;
    });
  const hubspot = createHubspotConnector({
    ...f.config,
    fetcher: async (input, init) => {
      entered();
      await wait;
      return f.remote.fetcher(input, init);
    },
  });
  try {
    const start = await hubspot.start(),
      pending = hubspot.finish(
        new URL(start.authorizationUrl).searchParams.get("state")!,
        "code",
      );
    await entry;
    hubspot.disconnect();
    release();
    await assert.rejects(pending, { code: "HUBSPOT_SESSION_CHANGED" });
    assert.equal(hubspot.status().connected, false);
  } finally {
    release();
    f.close();
  }
});

test("provider picker keeps HubSpot coming soon; no arbitrary callback or object kind", async () => {
  const f = setup();
  try {
    const catalog = providerCatalog({
      gmailConfigured: false,
      gmailConnected: false,
      hubspotConfigured: true,
      hubspotConnected: false,
    });
    assert.equal(
      catalog.find((p) => p.id === "hubspot")!.status,
      "coming_soon",
    );
    assert.equal(catalog.find((p) => p.id === "salesforce")!.available, false);
    const missing = createHubspotConnector({
      directory: join(f.directory, "none"),
      redirectUri,
    });
    await assert.rejects(missing.start(), { code: "HUBSPOT_NOT_CONFIGURED" });
    await assert.rejects(f.hubspot.start(["tickets" as HubspotObjectKind]), {
      code: "HUBSPOT_INVALID_KIND",
    });
    assert.throws(
      () =>
        createHubspotConnector({
          ...f.config,
          redirectUri: "http://attacker.example:3000/callback",
        }),
      { code: "HUBSPOT_CALLBACK_INVALID" },
    );
  } finally {
    f.close();
  }
});

test("HubSpot surfaces bounded Retry-After on plain-text 429/503 without retrying or caching failures", async () => {
  for (const scenario of [
    { status: 429, header: "9999", expected: 120 },
    { status: 429, header: "17", expected: 17 },
    { status: 503, header: new Date(1045000).toUTCString(), expected: 45 },
    { status: 503, header: "invalid", expected: 30 },
  ]) {
    const f = setup();
    let limited = false,
      attempts = 0;
    const hubspot = createHubspotConnector({
      ...f.config,
      fetcher: async (input, init) => {
        if (limited) {
          attempts++;
          return new Response("Provider unavailable: private diagnostics", {
            status: scenario.status,
            headers: { "Retry-After": scenario.header },
          });
        }
        return f.remote.fetcher(input, init);
      },
    });
    try {
      await authorize(hubspot);
      limited = true;
      await assert.rejects(
        hubspot.list("contacts"),
        (error: any) =>
          error.status === scenario.status &&
          error.retryAfter === scenario.expected &&
          !error.message.includes("private"),
      );
      assert.equal(attempts, 1);
      limited = false;
      assert.equal((await hubspot.list("contacts")).resources.length, 1);
      assert.equal(hubspot.status().connected, true);
    } finally {
      f.close();
    }
  }
});

test("HubSpot disconnect during selected-record fetch prevents stale evidence import", async () => {
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
  const hubspot = createHubspotConnector({
    ...f.config,
    fetcher: async (input, init) => {
      if (init?.method === "GET") {
        entered();
        await wait;
      }
      return f.remote.fetcher(input, init);
    },
  });
  try {
    await authorize(hubspot);
    await hubspot.list("contacts");
    const pending = hubspot.importRecord("contacts", "1", {
      async import() {
        imported = true;
        return { sourceId: "stale" };
      },
    });
    await entry;
    hubspot.disconnect();
    release();
    await assert.rejects(pending, { code: "HUBSPOT_SESSION_CHANGED" });
    assert.equal(imported, false);
  } finally {
    release();
    f.close();
  }
});
