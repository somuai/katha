/** Named, read-only HubSpot ingestion; never an agent tool.
 * Official v3 OAuth: https://developers.hubspot.com/docs/api-reference/legacy/authentication/manage-oauth-tokens
 * CRM search: https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/search/search-contacts
 * Regular app OAuth documents a confidential-client exchange, not PKCE (MCP OAuth differs).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type { ImportInput } from "../core/types.js";
export type HubspotObjectKind = "contacts" | "companies" | "deals";
export class HubspotError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "HubspotError";
  }
}
interface Options {
  directory: string;
  redirectUri: string;
  clientId?: string;
  clientSecret?: string;
  fetcher?: typeof fetch;
  clock?: () => number;
}
interface Credentials {
  generation: number;
  clientId?: string;
  kinds?: HubspotObjectKind[];
  pending?: { hash: string; expiresAt: number };
  token?: { access: string; refresh?: string; expiresAt: number };
}
interface RecordData {
  id: string;
  properties: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
  archived?: boolean;
}
interface Evidence {
  import(input: ImportInput): Promise<{ sourceId: string }>;
}
const KINDS: HubspotObjectKind[] = ["contacts", "companies", "deals"];
const PROPERTIES: Record<HubspotObjectKind, string[]> = {
  contacts: [
    "firstname",
    "lastname",
    "email",
    "company",
    "jobtitle",
    "hs_lead_status",
    "lifecyclestage",
    "createdate",
    "lastmodifieddate",
  ],
  companies: [
    "name",
    "domain",
    "industry",
    "city",
    "country",
    "numberofemployees",
    "annualrevenue",
    "lifecyclestage",
    "createdate",
    "hs_lastmodifieddate",
  ],
  deals: [
    "dealname",
    "description",
    "amount",
    "deal_currency_code",
    "pipeline",
    "dealstage",
    "closedate",
    "createdate",
    "hs_lastmodifieddate",
  ],
};
const TOKEN = "https://api.hubspot.com/oauth/v3/token",
  CRM = "https://api.hubapi.com/crm/v3/objects/",
  MAX_BYTES = 1024 * 1024;
const scopes = (kinds: HubspotObjectKind[]) => [
  "oauth",
  ...kinds.map((kind) => `crm.objects.${kind}.read`),
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function kindCheck(kind: string): asserts kind is HubspotObjectKind {
  if (!KINDS.includes(kind as HubspotObjectKind))
    throw new HubspotError(
      "HUBSPOT_INVALID_KIND",
      "Choose contacts, companies or deals.",
    );
}
function idCheck(id: string) {
  if (!/^\d{1,30}$/.test(id))
    throw new HubspotError(
      "HUBSPOT_INVALID_RECORD",
      "Choose a listed CRM record.",
    );
}
export function createHubspotConnector(options: Options) {
  let callback: URL;
  try {
    callback = new URL(options.redirectUri);
  } catch {
    throw new HubspotError(
      "HUBSPOT_CALLBACK_INVALID",
      "Configure a fixed loopback callback.",
    );
  }
  if (
    callback.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(callback.hostname) ||
    !callback.port ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  )
    throw new HubspotError(
      "HUBSPOT_CALLBACK_INVALID",
      "Configure a fixed loopback HTTP callback with a port.",
    );
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  chmodSync(options.directory, 0o700);
  const path = join(options.directory, "hubspot.json"),
    clock = options.clock || Date.now;
  const listed = new Map<string, { generation: number; expiresAt: number }>();
  let refreshing: Promise<void> | undefined;
  function read(): Credentials {
    try {
      const text = readFileSync(path, "utf8");
      if (Buffer.byteLength(text) > 65536) throw Error("oversized");
      const value = JSON.parse(text);
      if (!Number.isSafeInteger(value.generation)) throw Error("invalid");
      return value;
    } catch (error: any) {
      if (error.code === "ENOENT") return { generation: 0 };
      throw new HubspotError(
        "HUBSPOT_STORAGE_INVALID",
        "Saved HubSpot authorization could not be read.",
        500,
      );
    }
  }
  function save(value: Credentials) {
    const temporary = path + "." + randomUUID() + ".tmp";
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  }
  function current(generation: number) {
    const value = read();
    if (value.generation !== generation)
      throw new HubspotError(
        "HUBSPOT_SESSION_CHANGED",
        "HubSpot connection changed. Connect again.",
        409,
      );
    return value;
  }
  function configured() {
    if (!options.clientId?.trim() || !options.clientSecret?.trim())
      throw new HubspotError(
        "HUBSPOT_NOT_CONFIGURED",
        "The owner must configure a HubSpot OAuth app and credentials first.",
        503,
      );
  }
  function connected(kind?: HubspotObjectKind) {
    configured();
    const value = read();
    if (value.clientId !== options.clientId || !value.token)
      throw new HubspotError(
        "HUBSPOT_AUTH_REQUIRED",
        "Connect HubSpot first.",
        401,
      );
    if (kind && !value.kinds?.includes(kind))
      throw new HubspotError(
        "HUBSPOT_KIND_NOT_AUTHORIZED",
        "Reconnect and select this object type to allow its read-only import.",
        403,
      );
    return value;
  }
  async function request(url: string, init: RequestInit) {
    let response: Response;
    try {
      response = await (options.fetcher || fetch)(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new HubspotError(
        "HUBSPOT_NETWORK_ERROR",
        "HubSpot could not be reached. Try again.",
        502,
      );
    }
    if (response.status === 429 || response.status === 503) {
      const raw = response.headers.get("retry-after")?.trim();
      const delay =
        raw && /^\d+(?:\.\d+)?$/.test(raw)
          ? Number(raw)
          : raw && Number.isFinite(Date.parse(raw))
            ? (Date.parse(raw) - clock()) / 1000
            : 30;
      const retryAfter = Math.min(120, Math.max(1, Math.ceil(delay)));
      await response.body?.cancel().catch(() => undefined);
      throw new HubspotError(
        response.status === 429
          ? "HUBSPOT_RATE_LIMITED"
          : "HUBSPOT_UNAVAILABLE",
        response.status === 429
          ? "HubSpot is limiting requests. Try again after the indicated delay."
          : "HubSpot is temporarily unavailable. Try again after the indicated delay.",
        response.status,
        retryAfter,
      );
    }
    const reader = response.body?.getReader(),
      pieces: Uint8Array[] = [];
    let bytes = 0;
    if (reader)
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new HubspotError(
            "HUBSPOT_RESPONSE_TOO_LARGE",
            "HubSpot response exceeds the 1 MB import limit.",
            413,
          );
        }
        pieces.push(chunk.value);
      }
    let data: any;
    try {
      data = JSON.parse(Buffer.concat(pieces).toString("utf8"));
    } catch {
      throw new HubspotError(
        "HUBSPOT_INVALID_RESPONSE",
        "HubSpot returned an invalid response.",
        502,
      );
    }
    return { response, data };
  }
  async function token(
    params: URLSearchParams,
    generation: number,
    oldRefresh?: string,
  ) {
    configured();
    params.set("client_id", options.clientId!);
    params.set("client_secret", options.clientSecret!);
    const { response, data } = await request(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const value = current(generation);
    if (!response.ok) {
      if (
        ["invalid_grant", "BAD_REFRESH_TOKEN", "INVALID_GRANT"].includes(
          data.error || data.status,
        )
      ) {
        delete value.token;
        save(value);
      }
      throw new HubspotError(
        "HUBSPOT_AUTH_REQUIRED",
        "HubSpot authorization failed or expired. Connect again.",
        401,
      );
    }
    const requested = scopes(value.kinds || []);
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      data.access_token.length > 16000 ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      !Array.isArray(data.scopes) ||
      data.scopes.some(
        (s: unknown) => typeof s !== "string" || !requested.includes(s),
      ) ||
      requested.some((s) => !data.scopes.includes(s)) ||
      (data.refresh_token !== undefined &&
        (typeof data.refresh_token !== "string" ||
          data.refresh_token.length > 16000))
    )
      throw new HubspotError(
        "HUBSPOT_UNEXPECTED_PERMISSIONS",
        "HubSpot granted unexpected permissions. Configure only the selected CRM read scopes and OAuth.",
        502,
      );
    value.token = {
      access: data.access_token,
      refresh: data.refresh_token || oldRefresh,
      expiresAt: clock() + data.expires_in * 1000,
    };
    save(value);
  }
  async function refresh() {
    if (refreshing) return refreshing;
    const value = connected();
    if (!value.token?.refresh)
      throw new HubspotError(
        "HUBSPOT_AUTH_REQUIRED",
        "Reconnect HubSpot to renew access.",
        401,
      );
    refreshing = token(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: value.token.refresh,
      }),
      value.generation,
      value.token.refresh,
    );
    try {
      await refreshing;
    } finally {
      refreshing = undefined;
    }
  }
  async function api(kind: HubspotObjectKind, url: string, init: RequestInit) {
    let value = connected(kind);
    if (value.token!.expiresAt <= clock() + 30000) {
      await refresh();
      value = connected(kind);
    }
    const send = () =>
      request(url, {
        ...init,
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer " + value.token!.access,
        },
      });
    let result = await send();
    current(value.generation);
    if (result.response.status === 401) {
      await refresh();
      value = connected(kind);
      result = await send();
      current(value.generation);
    }
    if (!result.response.ok)
      throw new HubspotError(
        result.response.status === 403
          ? "HUBSPOT_PERMISSION_DENIED"
          : "HUBSPOT_REQUEST_FAILED",
        result.response.status === 403
          ? "HubSpot does not permit reading this object. Check the granted scopes."
          : "HubSpot could not load this selection.",
        result.response.status === 403 ? 403 : 502,
      );
    return result.data;
  }
  function normalize(kind: HubspotObjectKind, raw: any): RecordData {
    idCheck(raw?.id);
    if (
      !raw.properties ||
      typeof raw.properties !== "object" ||
      Array.isArray(raw.properties)
    )
      throw new HubspotError(
        "HUBSPOT_INVALID_RESPONSE",
        "HubSpot returned an invalid record.",
        502,
      );
    const properties: Record<string, string | null> = {};
    for (const key of PROPERTIES[kind]) {
      const value = raw.properties[key];
      if (typeof value === "string" || value === null) properties[key] = value;
    }
    return {
      id: raw.id,
      properties,
      ...(typeof raw.createdAt === "string"
        ? { createdAt: raw.createdAt }
        : {}),
      ...(typeof raw.updatedAt === "string"
        ? { updatedAt: raw.updatedAt }
        : {}),
      archived: raw.archived === true,
    };
  }
  function title(kind: HubspotObjectKind, record: RecordData) {
    const p = record.properties;
    return (
      (kind === "contacts"
        ? [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email
        : kind === "companies"
          ? p.name
          : p.dealname) || `${kind} record ${record.id}`
    );
  }
  return {
    status() {
      const value = read(),
        configured =
          !!options.clientId?.trim() && !!options.clientSecret?.trim(),
        connected =
          configured && value.clientId === options.clientId && !!value.token;
      return {
        configured,
        connected,
        authStatus: !configured
          ? "setup_required"
          : connected
            ? "connected"
            : "not_connected",
        kinds: value.kinds || [],
        scopes: scopes(value.kinds || []),
        oauthMode: "confidential-client",
      };
    },
    async start(kinds: HubspotObjectKind[] = ["contacts"]) {
      configured();
      if (!Array.isArray(kinds) || !kinds.length || kinds.length > 3)
        throw new HubspotError(
          "HUBSPOT_INVALID_KIND",
          "Select one to three CRM object types.",
        );
      kinds.forEach(kindCheck);
      kinds = [...new Set(kinds)];
      const state = randomBytes(32).toString("base64url"),
        old = read();
      save({
        generation: old.generation + 1,
        clientId: options.clientId,
        kinds,
        pending: { hash: hash(state), expiresAt: clock() + 600000 },
      });
      listed.clear();
      const url = new URL("https://app.hubspot.com/oauth/authorize");
      url.search = new URLSearchParams({
        client_id: options.clientId!,
        redirect_uri: callback.href,
        scope: scopes(kinds).join(" "),
        state,
      }).toString();
      return { authorizationUrl: url.href };
    },
    async finish(state: string, code: string) {
      configured();
      const value = read(),
        pending = value.pending;
      if (
        !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
        !pending ||
        pending.hash !== hash(state) ||
        !code ||
        code.length > 4096
      )
        throw new HubspotError(
          "HUBSPOT_STATE_INVALID",
          "Invalid or already used HubSpot authorization response.",
        );
      delete value.pending;
      save(value);
      if (pending.expiresAt <= clock())
        throw new HubspotError(
          "HUBSPOT_STATE_INVALID",
          "Authorization expired. Connect again.",
        );
      await token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callback.href,
        }),
        value.generation,
      );
      return { connected: true as const };
    },
    async list(kind: HubspotObjectKind, query = "", cursor?: string) {
      kindCheck(kind);
      const value = connected(kind);
      if (
        query.length > 1000 ||
        (cursor !== undefined && !/^\d{1,20}$/.test(cursor))
      )
        throw new HubspotError(
          "HUBSPOT_INVALID_QUERY",
          "Use a shorter search or refresh the CRM list.",
        );
      const data = await api(kind, CRM + kind + "/search", {
        method: "POST",
        body: JSON.stringify({
          limit: 20,
          properties: PROPERTIES[kind],
          ...(query ? { query } : {}),
          ...(cursor ? { after: cursor } : {}),
        }),
      });
      if (!Array.isArray(data.results))
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          "HubSpot returned an invalid record list.",
          502,
        );
      current(value.generation);
      const resources = data.results.slice(0, 20).map((raw: unknown) => {
        const record = normalize(kind, raw);
        listed.set(`${kind}:${record.id}`, {
          generation: value.generation,
          expiresAt: clock() + 300000,
        });
        return {
          id: record.id,
          title: title(kind, record).slice(0, 500),
          summary: Object.entries(record.properties)
            .filter(([, v]) => v)
            .slice(0, 4)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")
            .slice(0, 1000),
        };
      });
      while (listed.size > 200) listed.delete(listed.keys().next().value!);
      const next = data.paging?.next?.after;
      return {
        resources,
        nextCursor:
          typeof next === "string" || typeof next === "number"
            ? String(next)
            : undefined,
      };
    },
    async importRecord(
      kind: HubspotObjectKind,
      id: string,
      evidence: Evidence,
    ) {
      kindCheck(kind);
      idCheck(id);
      const value = connected(kind),
        selection = listed.get(`${kind}:${id}`);
      if (
        !selection ||
        selection.generation !== value.generation ||
        selection.expiresAt <= clock()
      )
        throw new HubspotError(
          "HUBSPOT_RECORD_NOT_LISTED",
          "Search CRM and select a listed record before importing.",
          409,
        );
      const url = new URL(CRM + kind + "/" + id);
      url.searchParams.set("properties", PROPERTIES[kind].join(","));
      url.searchParams.set("archived", "false");
      const record = normalize(
        kind,
        await api(kind, url.href, { method: "GET" }),
      );
      if (record.id !== id || record.archived)
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          "HubSpot returned an unexpected or archived record.",
          502,
        );
      current(value.generation);
      const importedAt = new Date(clock()).toISOString(),
        resourceUri = `hubspot://${kind}/${id}`,
        content = JSON.stringify({ objectType: kind, ...record }, null, 2);
      if (Buffer.byteLength(content) > MAX_BYTES)
        throw new HubspotError(
          "HUBSPOT_RECORD_TOO_LARGE",
          "Selected CRM record exceeds the text limit.",
          413,
        );
      const receipt = await evidence.import({
        name: title(kind, record).slice(0, 195),
        content,
        mimeType: "application/json",
        metadata: {
          method: "hubspot-selected-record",
          connectorId: "hubspot",
          resourceUri,
          objectType: kind,
          recordId: id,
          importedAt,
          providerCreatedAt: record.createdAt,
          providerUpdatedAt: record.updatedAt,
          importedProperties: PROPERTIES[kind],
          temporalNote:
            "This is a CRM snapshot observed at import time. Record modification time does not establish when individual claims became true. Associations, custom properties and all-account exports are not imported.",
        },
      });
      return { ...receipt, connectionId: "hubspot", resourceUri, importedAt };
    },
    disconnect() {
      const old = read();
      save({ generation: old.generation + 1 });
      listed.clear();
    },
  };
}
