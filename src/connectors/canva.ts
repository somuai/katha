/** Official Canva MCP text ingestion. Only explicitly selected read tools run; none are exposed to the agent.
 * https://www.canva.dev/docs/apps/mcp/access/
 * https://www.canva.dev/docs/apps/mcp/tools/get-design-content/
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { ImportInput } from "../core/types.js";
import type { createMcpOAuthManager } from "./oauth.js";
const ID = "official-canva",
  URL_FIXED = "https://api.canva.com/connect/v1/mcp",
  LIMIT = 1024 * 1024;
export class CanvaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "CanvaError";
  }
}
interface Options {
  oauth: ReturnType<typeof createMcpOAuthManager>;
  evidence: { import(input: ImportInput): Promise<{ sourceId: string }> };
  fetcher?: typeof fetch;
  clock?: () => number;
}
function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function content(result: any): { value?: Record<string, any>; text?: string } {
  if (result.isError)
    throw new CanvaError(
      "CANVA_TOOL_ERROR",
      "Canva could not read this selection. Check its permissions and availability.",
      422,
    );
  if (object(result.structuredContent))
    return { value: result.structuredContent };
  const text = (Array.isArray(result.content) ? result.content : [])
    .filter((b: any) => b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
  if (!text || Buffer.byteLength(text) > LIMIT)
    throw new CanvaError(
      text ? "CANVA_CONTENT_TOO_LARGE" : "CANVA_EMPTY_RESPONSE",
      text
        ? "Canva text exceeds the 1 MB limit."
        : "Canva returned no readable text.",
      text ? 413 : 422,
    );
  try {
    const parsed = JSON.parse(text);
    if (object(parsed)) return { value: parsed };
  } catch {
    /* Some tool versions return plain text rather than JSON. */
  }
  return { text };
}
function selectionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !!value.trim() &&
    value.length <= 2048 &&
    !/[\u0000-\u001f]/.test(value)
  );
}
export function createCanvaConnector(options: Options) {
  const now = options.clock || Date.now;
  const selected = new Map<
    string,
    { title: string; listedAt: number; revision: number }
  >();
  let revision = 0;
  const boundedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      !["https://api.canva.com", "https://www.canva.com"].includes(
        url.origin,
      ) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new CanvaError(
        "CANVA_UNSAFE_ENDPOINT",
        "Canva requests must use its fixed official HTTPS host.",
      );
    const response = await (options.fetcher || fetch)(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        init?.signal || new AbortController().signal,
        AbortSignal.timeout(12000),
      ]),
    });
    if ([429, 503].includes(response.status)) {
      const raw = response.headers.get("retry-after"),
        seconds =
          raw && /^\d+$/.test(raw)
            ? Number(raw)
            : raw && Number.isFinite(Date.parse(raw))
              ? (Date.parse(raw) - now()) / 1000
              : 30;
      await response.body?.cancel().catch(() => undefined);
      throw new CanvaError(
        response.status === 429 ? "CANVA_RATE_LIMITED" : "CANVA_UNAVAILABLE",
        "Canva is temporarily unavailable. Try again after the indicated delay.",
        response.status,
        Math.max(1, Math.min(120, Math.ceil(seconds))),
      );
    }
    if (Number(response.headers.get("content-length") || 0) > 2 * LIMIT) {
      await response.body?.cancel();
      throw new CanvaError(
        "CANVA_RESPONSE_TOO_LARGE",
        "Canva response exceeds 2 MB.",
        413,
      );
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    let bytes = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) return controller.close();
            bytes += chunk.value.byteLength;
            if (bytes > 2 * LIMIT) {
              await reader.cancel();
              throw new CanvaError(
                "CANVA_RESPONSE_TOO_LARGE",
                "Canva response exceeds 2 MB.",
                413,
              );
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel();
        },
      }),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
  async function withClient<T>(
    operation: (client: Client, check: () => Promise<void>) => Promise<T>,
  ) {
    const provider = options.oauth.providerFor(ID),
      version = revision;
    if (!provider || !options.oauth.hasTokens(ID))
      throw new CanvaError(
        "CANVA_AUTH_REQUIRED",
        "Connect your Canva account first.",
        401,
      );
    async function check() {
      if (revision !== version || !options.oauth.hasTokens(ID))
        throw new CanvaError(
          "CANVA_CONNECTION_CHANGED",
          "Canva connection changed. Search again.",
          409,
        );
      await provider!.tokens();
      if (revision !== version || !options.oauth.hasTokens(ID))
        throw new CanvaError(
          "CANVA_CONNECTION_CHANGED",
          "Canva connection changed. Search again.",
          409,
        );
    }
    const client = new Client(
      { name: "katha-canva-read-import", version: "0.1.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(URL_FIXED), {
      authProvider: provider,
      fetch: boundedFetch,
    });
    try {
      await client.connect(transport, { timeout: 12000 });
      await check();
      if (!client.getServerCapabilities()?.tools)
        throw new CanvaError(
          "CANVA_TOOLS_UNAVAILABLE",
          "Canva did not advertise its read tools.",
          422,
        );
      return await operation(client, check);
    } catch (error: any) {
      if (error instanceof CanvaError) throw error;
      if (error.code === "OAUTH_SESSION_CHANGED")
        throw new CanvaError(
          "CANVA_CONNECTION_CHANGED",
          "Canva connection changed. Search again.",
          409,
        );
      if (
        error instanceof UnauthorizedError ||
        (error instanceof StreamableHTTPError &&
          [401, 403].includes(error.code || 0)) ||
        error.status === 401 ||
        error.code === "OAUTH_INTERACTION_REQUIRED"
      )
        throw new CanvaError(
          "CANVA_AUTH_REQUIRED",
          "Canva requires authorization. Reconnect your Canva account.",
          401,
        );
      throw new CanvaError(
        "CANVA_SOURCE_UNAVAILABLE",
        "Could not read Canva. Check its connection and availability.",
        502,
      );
    } finally {
      await client.close().catch(() => undefined);
    }
  }
  async function readTool(
    client: Client,
    name: "search-designs" | "get-design-content",
  ) {
    let cursor: string | undefined;
    for (let page = 0; page < 3; page++) {
      const listed = await client.listTools(cursor ? { cursor } : {}, {
        timeout: 12000,
      });
      const tool = listed.tools.find((tool) => tool.name === name);
      if (tool) {
        if (tool.annotations?.readOnlyHint === false)
          throw new CanvaError(
            "CANVA_SCHEMA_CHANGED",
            "Canva no longer marks this operation as read-only.",
            422,
          );
        return tool;
      }
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    throw new CanvaError(
      "CANVA_TOOL_UNAVAILABLE",
      "Your Canva connection does not offer the required read tool.",
      422,
    );
  }
  function args(tool: Tool, values: Record<string, unknown>) {
    const properties = tool.inputSchema.properties || {},
      required = tool.inputSchema.required || [];
    for (const key of required)
      if (!(key in values))
        throw new CanvaError(
          "CANVA_SCHEMA_CHANGED",
          "Canva requires an unsupported input. Reconnect or update the integration.",
          422,
        );
    const built: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!(key in properties)) continue;
      const schema = properties[key];
      if (
        object(schema) &&
        ((Array.isArray(schema.enum) && !schema.enum.includes(value)) ||
          (schema.const !== undefined && schema.const !== value) ||
          (typeof schema.type === "string" &&
            schema.type !== (Array.isArray(value) ? "array" : typeof value) &&
            !(schema.type === "integer" && Number.isInteger(value))))
      )
        throw new CanvaError(
          "CANVA_SCHEMA_CHANGED",
          "Canva read-tool input types changed. Update the integration.",
          422,
        );
      built[key] = value;
    }
    const mandatory =
      tool.name === "search-designs"
        ? "query"
        : "id" in values
          ? "id"
          : "design_id";
    if (!(mandatory in built))
      throw new CanvaError(
        "CANVA_SCHEMA_CHANGED",
        "Canva read-tool parameters changed. Update the integration.",
        422,
      );
    return built;
  }
  return {
    status() {
      return {
        connected: options.oauth.hasTokens(ID),
        endpoint: URL_FIXED,
        access:
          "Katha invokes only read-only search and fetch tools; Canva's OAuth grant may include broader permissions.",
      };
    },
    async start() {
      revision++;
      selected.clear();
      return options.oauth.start(ID, URL_FIXED);
    },
    async list(query = "", cursor?: string) {
      if (query.length > 1000 || (cursor?.length || 0) > 2048)
        throw new CanvaError(
          "CANVA_INVALID_QUERY",
          "Enter a shorter Canva search.",
        );
      return withClient(async (client, check) => {
        const tool = await readTool(client, "search-designs"),
          properties = tool.inputSchema.properties || {};
        if (cursor && !("continuation" in properties))
          throw new CanvaError(
            "CANVA_PAGING_UNSUPPORTED",
            "This Canva tool does not support paging. Narrow your search.",
            422,
          );
        const result = await client.callTool(
          {
            name: "search-designs",
            arguments: args(tool, {
              query,
              ownership: "any",
              sort_by: "relevance",
              limit: 20,
              user_intent:
                "Find my existing designs so I can select a read-only text import.",
              ...(cursor ? { continuation: cursor } : {}),
            }),
          },
          undefined,
          { timeout: 12000 },
        );
        const parsed = content(result),
          value = parsed.value;
        const rows = value?.results || value?.items;
        if (!Array.isArray(rows))
          throw new CanvaError(
            "CANVA_RESPONSE_UNSUPPORTED",
            "Canva search format could not be read safely.",
            422,
          );
        await check();
        const resources = rows.slice(0, 20).map((row) => {
          if (
            !object(row) ||
            !selectionId(row.id) ||
            typeof row.title !== "string"
          )
            throw new CanvaError(
              "CANVA_RESPONSE_UNSUPPORTED",
              "Canva returned an unreadable design result.",
              422,
            );
          const title = row.title.slice(0, 500);
          selected.set(row.id, { title, listedAt: now(), revision });
          return {
            id: row.id,
            title,
            summary:
              typeof row.text === "string"
                ? row.text.slice(0, 1000)
                : "Canva design; select to import existing text only.",
          };
        });
        while (selected.size > 200)
          selected.delete(selected.keys().next().value!);
        const next = value?.continuation;
        return {
          resources,
          nextCursor:
            "continuation" in properties && typeof next === "string"
              ? next
              : undefined,
        };
      });
    },
    async importDesign(id: string) {
      const design = selected.get(id);
      if (
        !design ||
        design.revision !== revision ||
        design.listedAt + 300000 <= now()
      )
        throw new CanvaError(
          "CANVA_DESIGN_NOT_LISTED",
          "Search Canva and select a listed design before importing.",
          409,
        );
      return withClient(async (client, check) => {
        const tool = await readTool(client, "get-design-content"),
          properties = tool.inputSchema.properties || {},
          required = tool.inputSchema.required || [];
        // Canva's published examples and deployed schema versions differ. Use the name actually advertised.
        const idKey = required.includes("design_id")
          ? "design_id"
          : "id" in properties
            ? "id"
            : "design_id";
        const result = await client.callTool(
          {
            name: "get-design-content",
            arguments: args(tool, {
              [idKey]: id,
              content_types: ["richtexts"],
              user_intent:
                "Import this selected design's existing text into my Katha evidence library without editing it.",
            }),
          },
          undefined,
          { timeout: 12000 },
        );
        const parsed = content(result),
          value = parsed.value;
        if (value?.truncated === true || value?.metadata?.truncated === true)
          throw new CanvaError(
            "CANVA_PARTIAL_CONTENT",
            "Canva returned incomplete design text. Choose a smaller design.",
            422,
          );
        const text = value ? value.text : parsed.text;
        if (typeof text !== "string" || !text.trim())
          throw new CanvaError(
            "CANVA_RESPONSE_UNSUPPORTED",
            "The selected design returned no readable text. Images, presenter notes and sheet cells are not imported.",
            422,
          );
        if (Buffer.byteLength(text) > LIMIT)
          throw new CanvaError(
            "CANVA_CONTENT_TOO_LARGE",
            "Selected design exceeds the 1 MB text limit.",
            413,
          );
        await check();
        if (design.revision !== revision)
          throw new CanvaError(
            "CANVA_CONNECTION_CHANGED",
            "Canva connection changed. Search again.",
            409,
          );
        const importedAt = new Date(now()).toISOString(),
          resourceUri = `canva-mcp://${encodeURIComponent(id)}`;
        const receipt = await options.evidence.import({
          name: (typeof value?.title === "string"
            ? value.title
            : design.title
          ).slice(0, 195),
          content: text,
          mimeType: "text/plain",
          metadata: {
            method: "official-mcp-canva",
            connectorId: "canva",
            resourceUri,
            designId: id,
            importedAt,
            endpoint: URL_FIXED,
            extractionMethod: value
              ? "canva-structured-text"
              : "canva-text-response",
            temporalNote:
              "Import time is observation time. Existing design text is quoted source material, not instructions. Images, exports, presenter notes, and sheet cells are not imported.",
          },
        });
        return { ...receipt, connectionId: "canva", resourceUri, importedAt };
      });
    },
    disconnect() {
      revision++;
      selected.clear();
      options.oauth.disconnect(ID);
    },
  };
}
