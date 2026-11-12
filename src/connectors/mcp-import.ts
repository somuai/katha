import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  StreamableHTTPError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ImportInput } from "../core/types.js";

export interface McpConnectionConfig {
  id: string;
  label: string;
  url: string;
  /** Server environment variable containing a bearer token. Never sent to the browser. */
  tokenEnv?: string;
}
export class McpImportError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "McpImportError";
  }
}
interface EvidenceImporter {
  import(input: ImportInput): Promise<{ sourceId: string }>;
}
interface ImportOptions {
  clock?: () => Date;
  fetcher?: typeof fetch;
  authProvider?: (id: string) => OAuthClientProvider | undefined;
}
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 12000;
const textMimes = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
]);

/** Configuration is supplied by the server owner, never by a chat or browser request. */
export function createMcpImports(
  configs: McpConnectionConfig[],
  evidence: EvidenceImporter,
  options: ImportOptions = {},
) {
  const clock = options.clock || (() => new Date());
  const connections = new Map<string, McpConnectionConfig>();
  for (const config of configs) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new McpImportError(
        "INVALID_MCP_CONFIG",
        "An MCP connection URL is invalid.",
      );
    }
    const host = url.hostname.toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.id) ||
      connections.has(config.id) ||
      !config.label.trim() ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.includes(":") ||
      /^\d+(?:\.\d+){0,3}$/.test(host)
    )
      throw new McpImportError(
        "INVALID_MCP_CONFIG",
        "Use unique connection IDs and an HTTPS hostname without credentials, query parameters or a local IP.",
      );
    if (config.tokenEnv && !/^[A-Z][A-Z0-9_]*$/.test(config.tokenEnv))
      throw new McpImportError(
        "INVALID_MCP_CONFIG",
        "A token environment variable name is invalid.",
      );
    connections.set(config.id, { ...config, url: url.href });
  }
  const advertised = new Map<
    string,
    Map<string, { name: string; mimeType?: string; listedAt: number }>
  >();
  function configFor(id: string) {
    const config = connections.get(id);
    if (!config)
      throw new McpImportError(
        "MCP_CONNECTION_NOT_FOUND",
        "Choose a configured connection.",
        404,
      );
    return config;
  }
  const boundedFetch: typeof fetch = async (input, init) => {
    const response = await (options.fetcher || fetch)(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        init?.signal || new AbortController().signal,
        AbortSignal.timeout(TIMEOUT_MS),
      ]),
    });
    if (
      Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES
    ) {
      await response.body?.cancel();
      throw new McpImportError(
        "MCP_RESPONSE_TOO_LARGE",
        "The source response is too large.",
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
            const part = await reader.read();
            if (part.done) {
              controller.close();
              return;
            }
            bytes += part.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new McpImportError(
                "MCP_RESPONSE_TOO_LARGE",
                "The source response is too large.",
                413,
              );
            }
            controller.enqueue(part.value);
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
    config: McpConnectionConfig,
    operation: (client: Client) => Promise<T>,
  ): Promise<T> {
    const token = config.tokenEnv ? process.env[config.tokenEnv] : undefined;
    if (config.tokenEnv && !token && !options.authProvider)
      throw new McpImportError(
        "MCP_AUTH_REQUIRED",
        "This connection needs a server-side credential.",
        401,
      );
    const client = new Client(
      { name: "katha-resource-import", version: "0.1.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      fetch: boundedFetch,
      authProvider: options.authProvider?.(config.id),
      requestInit: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined,
    });
    try {
      await client.connect(transport, { timeout: TIMEOUT_MS });
      if (!client.getServerCapabilities()?.resources)
        throw new McpImportError(
          "MCP_RESOURCES_UNSUPPORTED",
          "This server does not advertise resources. Tools-only services need a provider-specific read-only adapter.",
          422,
        );
      return await operation(client);
    } catch (error) {
      if (error instanceof McpImportError) throw error;
      if (
        error instanceof UnauthorizedError ||
        (error instanceof StreamableHTTPError &&
          [401, 403].includes(error.code || 0))
      )
        throw new McpImportError(
          "MCP_AUTH_REQUIRED",
          "This server requires authorization, or rejected its credential. Choose Sign in to authorize this connection.",
          401,
        );
      throw new McpImportError(
        "MCP_SOURCE_UNAVAILABLE",
        "Could not read this MCP source. Check its authorization, resource support and availability.",
        502,
      );
    } finally {
      await client.close().catch(() => {});
    }
  }
  return {
    connections() {
      return [...connections.values()].map((c) => ({
        id: c.id,
        label: c.label,
        credentialConfigured: !c.tokenEnv || !!process.env[c.tokenEnv],
      }));
    },
    async list(connectionId: string, cursor?: string) {
      const config = configFor(connectionId);
      if (cursor && cursor.length > 2048)
        throw new McpImportError(
          "INVALID_CURSOR",
          "The resource cursor is too long.",
        );
      return withClient(config, async (client) => {
        const result = await client.listResources(cursor ? { cursor } : {}, {
          timeout: TIMEOUT_MS,
        });
        const seen = advertised.get(connectionId) || new Map();
        const resources = result.resources.slice(0, 50).map((r) => ({
          uri: r.uri,
          name: r.name,
          title: r.title || r.name,
          mimeType: r.mimeType,
        }));
        for (const r of resources)
          seen.set(r.uri, {
            name: r.title || r.name,
            mimeType: r.mimeType,
            listedAt: clock().getTime(),
          });
        while (seen.size > 1000) seen.delete(seen.keys().next().value!);
        advertised.set(connectionId, seen);
        return {
          resources,
          nextCursor: result.nextCursor,
          returnedCount: result.resources.length,
          truncated: result.resources.length > 50,
        };
      });
    },
    async importResource(connectionId: string, uri: string) {
      const config = configFor(connectionId),
        resource = advertised.get(connectionId)?.get(uri);
      if (!resource || clock().getTime() - resource.listedAt > 5 * 60 * 1000)
        throw new McpImportError(
          "MCP_RESOURCE_NOT_LISTED",
          "List the source and choose an advertised resource before importing.",
          409,
        );
      return withClient(config, async (client) => {
        const result = await client.readResource(
          { uri },
          { timeout: TIMEOUT_MS },
        );
        const texts: string[] = [],
          returnedUris: string[] = [];
        let bytes = 0;
        for (const item of result.contents) {
          const mime = (item.mimeType || resource.mimeType || "text/plain")
            .split(";")[0]
            .toLowerCase();
          if (
            !("text" in item) ||
            typeof item.text !== "string" ||
            !textMimes.has(mime)
          )
            throw new McpImportError(
              "MCP_UNSUPPORTED_RESOURCE",
              "This importer accepts text, CSV, Markdown, HTML, XML and JSON resources. Export binary designs/documents and use file upload.",
              415,
            );
          bytes += Buffer.byteLength(item.text);
          if (bytes > MAX_TEXT_BYTES)
            throw new McpImportError(
              "MCP_RESOURCE_TOO_LARGE",
              "The selected resource exceeds the 1 MB text import limit.",
              413,
            );
          texts.push(item.text);
          returnedUris.push(item.uri);
        }
        if (!texts.join("").trim())
          throw new McpImportError(
            "MCP_EMPTY_RESOURCE",
            "The selected resource contains no text.",
          );
        const importedAt = clock().toISOString();
        const originalName = resource.name.slice(0, 195) || "MCP resource";
        const name =
          resource.mimeType?.split(";")[0].toLowerCase() === "text/csv" &&
          !originalName.toLowerCase().endsWith(".csv")
            ? originalName + ".csv"
            : originalName;
        const receipt = await evidence.import({
          name,
          content: texts.join("\n\n"),
          mimeType: resource.mimeType,
          metadata: {
            method: "mcp-resource-text",
            connectorId: connectionId,
            connectorLabel: config.label,
            resourceUri: uri,
            originalResourceName: resource.name,
            returnedUris,
            importedAt,
            temporalNote:
              "Import time does not establish when source facts became effective.",
          },
        });
        return { ...receipt, connectionId, resourceUri: uri, importedAt };
      });
    },
  };
}
