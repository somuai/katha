import test from "node:test";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createMcpOAuthManager } from "../src/connectors/oauth.ts";

const callbackUrl = "http://127.0.0.1:3000/api/connections/oauth/callback";
function fixture(
  options: {
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    failToken?: boolean;
    tokenScope?: string;
  } = {},
) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input),
      body = String(init?.body || "");
    requests.push({ url, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("oauth-protected-resource"))
      return json({
        resource: new URL("/mcp", url).href,
        authorization_servers: ["https://auth.example"],
        scopes_supported: ["files:read", "files:write"],
      });
    if (url.includes(".well-known"))
      return json({
        issuer: "https://auth.example",
        authorization_endpoint:
          options.authorizationEndpoint || "https://auth.example/authorize",
        token_endpoint: options.tokenEndpoint || "https://auth.example/token",
        registration_endpoint: "https://auth.example/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      });
    if (url.endsWith("/register"))
      return json({
        ...JSON.parse(body),
        client_id: "fixture-client",
        token_endpoint_auth_method: "none",
      });
    if (url.endsWith("/token"))
      return options.failToken
        ? json(
            {
              error: "invalid_grant",
              error_description: "secret upstream diagnostics",
            },
            400,
          )
        : json({
            access_token: "fixture-access",
            refresh_token: "fixture-refresh",
            token_type: "Bearer",
            expires_in: 3600,
            ...(options.tokenScope ? { scope: options.tokenScope } : {}),
          });
    throw Error("Unexpected fixture request: " + url);
  };
  return { fetcher, requests };
}
function setup(
  options: Parameters<typeof fixture>[0] = {},
  config: Partial<Parameters<typeof createMcpOAuthManager>[0]> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "katha-oauth-")),
    remote = fixture(options);
  let time = 1000;
  const manager = createMcpOAuthManager({
    directory,
    callbackUrl,
    fetcher: remote.fetcher,
    clock: () => time,
    ...config,
  });
  return {
    manager,
    remote,
    directory,
    advance(ms: number) {
      time += ms;
    },
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("real SDK discovers, registers and exchanges a single-use PKCE grant; credentials survive restart privately", async () => {
  const f = setup();
  try {
    const started = await f.manager.start("crm", "https://mcp.example/mcp");
    assert.equal(started.authorized, false);
    const url = new URL(started.authorizationUrl!);
    assert.equal(url.origin, "https://auth.example");
    assert.equal(url.searchParams.get("redirect_uri"), callbackUrl);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state")!;
    const saved = JSON.parse(
      readFileSync(join(f.directory, "crm.json"), "utf8"),
    );
    assert.notEqual(saved.pending.hash, state);
    assert.equal(
      url.searchParams.get("code_challenge"),
      createHash("sha256").update(saved.pending.verifier).digest("base64url"),
    );
    if (process.platform !== "win32")
      assert.equal(statSync(f.directory).mode & 0o777, 0o700);
    if (process.platform !== "win32")
      assert.equal(statSync(join(f.directory, "crm.json")).mode & 0o777, 0o600);
    const registration = JSON.parse(
      f.remote.requests.find((r) => r.url.endsWith("/register"))!.body,
    );
    assert.deepEqual(registration.redirect_uris, [callbackUrl]);
    assert.equal(registration.token_endpoint_auth_method, "none");
    assert.deepEqual(await f.manager.finish(state, "fixture-code"), {
      connectionId: "crm",
    });
    const exchange = new URLSearchParams(
      f.remote.requests.find((r) => r.url.endsWith("/token"))!.body,
    );
    assert.equal(exchange.get("code_verifier"), saved.pending.verifier);
    assert.equal(exchange.get("redirect_uri"), callbackUrl);
    const restarted = createMcpOAuthManager({
      directory: f.directory,
      callbackUrl,
      fetcher: f.remote.fetcher,
    });
    assert.equal(restarted.hasTokens("crm"), true);
    assert.equal(
      (await restarted.providerFor("crm")!.tokens())!.access_token,
      "fixture-access",
    );
    await assert.rejects(f.manager.finish(state, "fixture-code"), {
      code: "OAUTH_STATE_INVALID",
    });
    const refresh = await restarted.start("crm", "https://mcp.example/mcp");
    assert.equal(refresh.authorized, true);
    assert.equal(
      new URLSearchParams(f.remote.requests.at(-1)!.body).get("grant_type"),
      "refresh_token",
    );
  } finally {
    f.close();
  }
});

test("expired and unknown state cannot exchange; expiration boundary is exclusive", async () => {
  const f = setup();
  try {
    const result = await f.manager.start("crm", "https://mcp.example/mcp");
    f.advance(10 * 60 * 1000);
    await assert.rejects(
      f.manager.finish(
        new URL(result.authorizationUrl!).searchParams.get("state")!,
        "code",
      ),
      { code: "OAUTH_STATE_INVALID" },
    );
    await assert.rejects(f.manager.finish("x".repeat(43), "code"), {
      code: "OAUTH_STATE_INVALID",
    });
    assert.equal(
      f.remote.requests.some((r) => r.url.endsWith("/token")),
      false,
    );
  } finally {
    f.close();
  }
});

test("failed exchanges consume state and upstream diagnostics remain private", async () => {
  const f = setup({ failToken: true });
  try {
    const result = await f.manager.start("crm", "https://mcp.example/mcp"),
      state = new URL(result.authorizationUrl!).searchParams.get("state")!;
    await assert.rejects(
      f.manager.finish(state, "code"),
      (error: any) =>
        error.code === "OAUTH_FAILED" && !error.message.includes("secret"),
    );
    await assert.rejects(f.manager.finish(state, "code"), {
      code: "OAUTH_STATE_INVALID",
    });
    assert.equal(f.manager.hasTokens("crm"), false);
  } finally {
    f.close();
  }
});

test("disconnect invalidates outstanding providers and allows replacing a server", async () => {
  const f = setup();
  try {
    await f.manager.start("crm", "https://mcp.example/mcp");
    const old = f.manager.providerFor("crm")!;
    await assert.rejects(f.manager.start("crm", "https://other.example/mcp"), {
      code: "OAUTH_SERVER_CHANGED",
    });
    f.manager.disconnect("crm");
    assert.throws(
      () => old.saveTokens!({ access_token: "stale", token_type: "Bearer" }),
      { code: "OAUTH_SESSION_CHANGED" },
    );
    assert.equal(f.manager.hasTokens("crm"), false);
    await f.manager.start("crm", "https://other.example/mcp");
  } finally {
    f.close();
  }
});

test("unsafe discovery, authorization and callback locations are rejected", async () => {
  for (const options of [
    { authorizationEndpoint: "http://auth.example/authorize" },
    { tokenEndpoint: "https://127.0.0.1/token" },
  ]) {
    const f = setup(options);
    try {
      if (options.authorizationEndpoint)
        await assert.rejects(
          f.manager.start("crm", "https://mcp.example/mcp"),
          { code: "OAUTH_UNSAFE_URL" },
        );
      else {
        const result = await f.manager.start("crm", "https://mcp.example/mcp");
        await assert.rejects(
          f.manager.finish(
            new URL(result.authorizationUrl!).searchParams.get("state")!,
            "code",
          ),
          { code: "OAUTH_UNSAFE_URL" },
        );
      }
      assert.equal(
        f.remote.requests.some((r) => r.url.includes("127.0.0.1")),
        false,
      );
      await assert.rejects(
        f.manager.start("other", "http://localhost:4000/mcp"),
        { code: "OAUTH_UNSAFE_URL" },
      );
    } finally {
      f.close();
    }
  }
  assert.throws(
    () =>
      createMcpOAuthManager({
        directory: "/unused",
        callbackUrl: "http://untrusted.example:3000/callback",
      }),
    { code: "OAUTH_CALLBACK_INVALID" },
  );
});

test("disconnect while token exchange is in flight cannot restore credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "katha-oauth-race-"));
  const remote = fixture();
  let entered!: () => void, release!: () => void;
  const tokenEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const tokenReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/token")) {
      entered();
      await tokenReleased;
    }
    return remote.fetcher(input, init);
  };
  const manager = createMcpOAuthManager({ directory, callbackUrl, fetcher });
  try {
    const result = await manager.start("crm", "https://mcp.example/mcp");
    const finishing = manager.finish(
      new URL(result.authorizationUrl!).searchParams.get("state")!,
      "code",
    );
    await tokenEntered;
    manager.disconnect("crm");
    release();
    await assert.rejects(finishing, { code: "OAUTH_SESSION_CHANGED" });
    assert.equal(manager.hasTokens("crm"), false);
  } finally {
    release();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("configured client skips registration and requests only explicitly selected read scope", async () => {
  const f = setup(
    { tokenScope: "files:read" },
    {
      clientFor: () => ({
        client_id: "registered-client",
        client_secret: "fixture-only-secret",
      }),
      scopeFor: () => "files:read",
    },
  );
  try {
    const start = await f.manager.start("canva", "https://mcp.example/mcp");
    const url = new URL(start.authorizationUrl!);
    assert.equal(url.searchParams.get("client_id"), "registered-client");
    assert.equal(url.searchParams.get("scope"), "files:read");
    assert.equal(
      f.remote.requests.some((r) => r.url.endsWith("/register")),
      false,
    );
    assert.equal(
      f.manager.providerFor("canva")!.clientMetadata.scope,
      "files:read",
    );
    assert.equal(
      f.manager.providerFor("canva")!.clientMetadata.token_endpoint_auth_method,
      "client_secret_post",
    );
    await f.manager.finish(url.searchParams.get("state")!, "code");
    const token = new URLSearchParams(
      f.remote.requests.find((r) => r.url.endsWith("/token"))!.body,
    );
    assert.equal(token.get("client_id"), "registered-client");
    assert.equal(token.get("client_secret"), "fixture-only-secret");
    const provider = f.manager.providerFor("canva")!;
    await provider.invalidateCredentials!("client");
    assert.equal(
      (await provider.clientInformation())!.client_id,
      "registered-client",
    );
    assert.equal(f.manager.hasTokens("canva"), true);
    // Transport-driven refresh does not pass our explicit auth() scope. It
    // must use the configured client and refresh token without a new redirect.
    assert.equal(
      await auth(provider, {
        serverUrl: "https://mcp.example/mcp",
        fetchFn: f.remote.fetcher,
      }),
      "AUTHORIZED",
    );
    const refresh = new URLSearchParams(f.remote.requests.at(-1)!.body);
    assert.equal(refresh.get("grant_type"), "refresh_token");
    assert.equal(refresh.get("client_id"), "registered-client");
    assert.equal(refresh.get("client_secret"), "fixture-only-secret");
    assert.throws(
      () =>
        provider.saveTokens({
          access_token: "overbroad",
          token_type: "Bearer",
          scope: "files:write",
        }),
      { code: "OAUTH_SCOPE_EXCEEDED" },
    );
    assert.equal((await provider.tokens())!.access_token, "fixture-access");
  } finally {
    f.close();
  }
});

test("unexpected granted scope is rejected rather than saved", async () => {
  const f = setup(
    { tokenScope: "files:read files:write" },
    { scopeFor: () => "files:read" },
  );
  try {
    const start = await f.manager.start("canva", "https://mcp.example/mcp");
    await assert.rejects(
      f.manager.finish(
        new URL(start.authorizationUrl!).searchParams.get("state")!,
        "code",
      ),
      { code: "OAUTH_SCOPE_EXCEEDED" },
    );
    assert.equal(f.manager.hasTokens("canva"), false);
  } finally {
    f.close();
  }
});

test("changing configured client requires disconnect and invalidates outstanding providers", async () => {
  let clientId = "first-client";
  const f = setup(
    {},
    {
      clientFor: () => ({ client_id: clientId }),
      scopeFor: () => "files:read",
    },
  );
  try {
    await f.manager.start("canva", "https://mcp.example/mcp");
    const old = f.manager.providerFor("canva")!;
    clientId = "second-client";
    assert.throws(() => old.tokens(), { code: "OAUTH_CONFIGURATION_CHANGED" });
    await assert.rejects(f.manager.start("canva", "https://mcp.example/mcp"), {
      code: "OAUTH_CONFIGURATION_CHANGED",
    });
    f.manager.disconnect("canva");
    const start = await f.manager.start("canva", "https://mcp.example/mcp");
    assert.equal(
      new URL(start.authorizationUrl!).searchParams.get("client_id"),
      "second-client",
    );
    assert.equal(
      f.manager.providerFor("canva")!.clientMetadata.token_endpoint_auth_method,
      "none",
    );
  } finally {
    f.close();
  }
});
