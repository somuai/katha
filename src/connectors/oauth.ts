import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export class McpOAuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}
interface RecordData {
  generation: number;
  serverUrl: string;
  configuredClientId?: string;
  requestedScope?: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discovery?: OAuthDiscoveryState;
  pending?: { hash: string; expiresAt: number; verifier?: string };
}
interface Options {
  directory: string;
  callbackUrl: string;
  fetcher?: typeof fetch;
  clock?: () => number;
  clientFor?: (
    id: string,
  ) => { client_id: string; client_secret?: string } | undefined;
  scopeFor?: (id: string) => string | undefined;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function publicUrl(value: string | URL) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new McpOAuthError(
      "OAUTH_UNSAFE_URL",
      "OAuth requires a valid HTTPS hostname.",
    );
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    isIP(h) ||
    h.startsWith("[")
  )
    throw new McpOAuthError(
      "OAUTH_UNSAFE_URL",
      "OAuth discovery and authorization require public HTTPS hostnames.",
    );
  return u;
}
function publicAddress(ip: string) {
  if (isIP(ip) === 6) return /^[23]/.test(ip);
  const p = ip.split(".").map(Number);
  return (
    p.length === 4 &&
    !(
      [0, 10, 127].includes(p[0]) ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      (p[0] === 198 && [18, 19].includes(p[1])) ||
      p[0] >= 224
    )
  );
}
export function createMcpOAuthManager(options: Options) {
  const callback = new URL(options.callbackUrl);
  if (
    callback.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(callback.hostname) ||
    !callback.port ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  )
    throw new McpOAuthError(
      "OAUTH_CALLBACK_INVALID",
      "Configure a fixed loopback HTTP callback with a port.",
    );
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  chmodSync(options.directory, 0o700);
  const now = options.clock || Date.now;
  function idCheck(id: string) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id))
      throw new McpOAuthError(
        "OAUTH_CONNECTION_INVALID",
        "Invalid connection ID.",
      );
  }
  function read(id: string): RecordData | undefined {
    idCheck(id);
    try {
      const value = readFileSync(join(options.directory, id + ".json"), "utf8");
      if (Buffer.byteLength(value) > 1024 * 1024) throw Error("oversized");
      return JSON.parse(value);
    } catch (e: any) {
      if (e.code === "ENOENT") return undefined;
      throw new McpOAuthError(
        "OAUTH_STORAGE_INVALID",
        "Could not read saved authorization state.",
        500,
      );
    }
  }
  function save(id: string, value: RecordData) {
    idCheck(id);
    const path = join(options.directory, id + ".json"),
      tmp = path + "." + randomUUID() + ".tmp";
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  }
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = publicUrl(input instanceof Request ? input.url : String(input));
    if (!options.fetcher) {
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
        throw new McpOAuthError(
          "OAUTH_UNSAFE_URL",
          "OAuth endpoints must resolve to public addresses.",
        );
    }
    const response = await (options.fetcher || fetch)(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        init?.signal || new AbortController().signal,
        AbortSignal.timeout(12000),
      ]),
    });
    if (Number(response.headers.get("content-length") || 0) > 1024 * 1024) {
      await response.body?.cancel();
      throw new McpOAuthError(
        "OAUTH_RESPONSE_TOO_LARGE",
        "OAuth response exceeded its size limit.",
        413,
      );
    }
    if (!response.body) return response;
    const reader = response.body.getReader(),
      parts: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new McpOAuthError(
          "OAUTH_RESPONSE_TOO_LARGE",
          "OAuth response exceeded its size limit.",
          413,
        );
      }
      parts.push(chunk.value);
    }
    return new Response(Buffer.concat(parts), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
  function provider(
    id: string,
    version: number,
    interactiveState?: string,
    verifierOverride?: string,
  ): OAuthClientProvider {
    function current() {
      const record = read(id);
      if (!record || record.generation !== version)
        throw new McpOAuthError(
          "OAUTH_SESSION_CHANGED",
          "Authorization changed; connect again.",
          409,
        );
      const configured = options.clientFor?.(id);
      if (
        record.configuredClientId !== configured?.client_id ||
        record.requestedScope !== options.scopeFor?.(id)
      )
        throw new McpOAuthError(
          "OAUTH_CONFIGURATION_CHANGED",
          "Connection configuration changed; disconnect and reconnect.",
          409,
        );
      return record;
    }
    function validateScope(tokens: OAuthTokens) {
      const requested = options.scopeFor?.(id);
      if (requested !== undefined && tokens.scope?.trim()) {
        const allowed = new Set(requested.split(/\s+/).filter(Boolean));
        if (
          tokens.scope
            .trim()
            .split(/\s+/)
            .some((scope) => !allowed.has(scope))
        )
          throw new McpOAuthError(
            "OAUTH_SCOPE_EXCEEDED",
            "The provider granted permissions beyond those requested. Disconnect and reconnect.",
            403,
          );
      }
    }
    function update(mutate: (r: RecordData) => void) {
      const r = current();
      mutate(r);
      save(id, r);
    }
    return {
      redirectUrl: callback.href,
      clientMetadata: {
        client_name: "Katha",
        redirect_uris: [callback.href],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: options.clientFor?.(id)?.client_secret
          ? "client_secret_post"
          : "none",
        scope: options.scopeFor?.(id),
      } as OAuthClientMetadata,
      state() {
        if (!interactiveState)
          throw new McpOAuthError(
            "OAUTH_INTERACTION_REQUIRED",
            "Reconnect this source to authorize it.",
            401,
          );
        current();
        return interactiveState;
      },
      clientInformation() {
        const record = current(),
          configured = options.clientFor?.(id);
        return configured ? { ...record.client, ...configured } : record.client;
      },
      saveClientInformation(value) {
        update((r) => {
          r.client = value;
        });
      },
      tokens() {
        const value = current().tokens;
        if (value) validateScope(value);
        return value;
      },
      saveTokens(value) {
        validateScope(value);
        update((r) => {
          r.tokens = value;
        });
      },
      redirectToAuthorization(value) {
        publicUrl(value);
        if (!interactiveState)
          throw new McpOAuthError(
            "OAUTH_INTERACTION_REQUIRED",
            "Reconnect this source to authorize it.",
            401,
          );
        redirects.set(id, value.href);
      },
      saveCodeVerifier(value) {
        update((r) => {
          if (!r.pending)
            throw new McpOAuthError(
              "OAUTH_STATE_INVALID",
              "No authorization is pending.",
            );
          r.pending.verifier = value;
        });
      },
      codeVerifier() {
        const value = verifierOverride || current().pending?.verifier;
        if (!value)
          throw new McpOAuthError(
            "OAUTH_STATE_INVALID",
            "No PKCE verifier is available.",
          );
        return value;
      },
      discoveryState() {
        return current().discovery;
      },
      saveDiscoveryState(value) {
        update((r) => {
          r.discovery = value;
        });
      },
      invalidateCredentials(scope) {
        update((r) => {
          if (scope === "all" || scope === "tokens") delete r.tokens;
          if (scope === "all" || scope === "client") delete r.client;
          if (scope === "all" || scope === "verifier") delete r.pending;
          if (scope === "all" || scope === "discovery") delete r.discovery;
        });
      },
    };
  }
  const redirects = new Map<string, string>();
  async function run(
    provider: OAuthClientProvider,
    serverUrl: string,
    code?: string,
    scope?: string,
  ) {
    try {
      return await auth(provider, {
        serverUrl,
        authorizationCode: code,
        scope,
        fetchFn: guardedFetch,
      });
    } catch (e) {
      if (e instanceof McpOAuthError) throw e;
      throw new McpOAuthError(
        "OAUTH_FAILED",
        "Authorization failed. The server may require a pre-registered client or different permissions.",
        502,
      );
    }
  }
  return {
    async start(id: string, serverUrl: string) {
      idCheck(id);
      const endpoint = publicUrl(serverUrl).href,
        old = read(id);
      if (
        old &&
        (old.client || old.tokens || old.pending || old.discovery) &&
        old.serverUrl !== endpoint
      )
        throw new McpOAuthError(
          "OAUTH_SERVER_CHANGED",
          "Disconnect the previous authorization before changing the server.",
          409,
        );
      if (
        old &&
        (old.tokens || old.pending || old.client) &&
        (old.configuredClientId !== options.clientFor?.(id)?.client_id ||
          old.requestedScope !== options.scopeFor?.(id))
      )
        throw new McpOAuthError(
          "OAUTH_CONFIGURATION_CHANGED",
          "Connection configuration changed; disconnect and reconnect.",
          409,
        );
      const state = randomBytes(32).toString("base64url"),
        generation = (old?.generation || 0) + 1;
      save(id, {
        ...old,
        generation,
        serverUrl: endpoint,
        configuredClientId: options.clientFor?.(id)?.client_id,
        requestedScope: options.scopeFor?.(id),
        pending: { hash: digest(state), expiresAt: now() + 10 * 60 * 1000 },
      });
      redirects.delete(id);
      const result = await run(
        provider(id, generation, state),
        endpoint,
        undefined,
        options.scopeFor?.(id),
      );
      if (result === "AUTHORIZED") {
        const r = read(id)!;
        if (r.generation === generation) {
          delete r.pending;
          save(id, r);
        }
        return { connectionId: id, authorized: true };
      }
      const authorizationUrl = redirects.get(id);
      redirects.delete(id);
      if (!authorizationUrl)
        throw new McpOAuthError(
          "OAUTH_FAILED",
          "No authorization URL was produced.",
          502,
        );
      return { connectionId: id, authorizationUrl, authorized: false };
    },
    async finish(state: string, code: string) {
      if (!/^[A-Za-z0-9_-]{40,100}$/.test(state) || !code || code.length > 4096)
        throw new McpOAuthError(
          "OAUTH_STATE_INVALID",
          "Invalid or expired authorization response.",
        );
      const files = readdirSync(options.directory).filter((name) =>
        /^[a-z0-9][a-z0-9-]{0,63}\.json$/.test(name),
      );
      for (const file of files) {
        const id = file.slice(0, -5),
          record = read(id)!;
        if (record.pending?.hash !== digest(state)) continue;
        const pending = record.pending;
        delete record.pending;
        save(id, record); // consume before network work, including failed exchanges
        if (pending.expiresAt <= now() || !pending.verifier)
          throw new McpOAuthError(
            "OAUTH_STATE_INVALID",
            "Authorization expired; connect again.",
          );
        const result = await run(
          provider(id, record.generation, undefined, pending.verifier),
          record.serverUrl,
          code,
          options.scopeFor?.(id),
        );
        if (result !== "AUTHORIZED")
          throw new McpOAuthError(
            "OAUTH_FAILED",
            "Authorization did not complete.",
            502,
          );
        return { connectionId: id };
      }
      throw new McpOAuthError(
        "OAUTH_STATE_INVALID",
        "Invalid, expired or already used authorization response.",
      );
    },
    providerFor(id: string) {
      const record = read(id);
      return record ? provider(id, record.generation) : undefined;
    },
    hasTokens(id: string) {
      return !!read(id)?.tokens;
    },
    disconnect(id: string) {
      const old = read(id);
      if (old)
        save(id, { generation: old.generation + 1, serverUrl: old.serverUrl });
      redirects.delete(id);
    },
  };
}
