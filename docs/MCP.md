# Read-only MCP resources

Katha can list and import **text resources** from explicitly configured remote MCP servers. This is a local-owner connection feature: imported data enters the Evidence Library with its connector identity, original resource URI, returned URIs and import timestamp. Import time does not establish when the source's facts became effective. The chat agent still has only the `web_search` tool.

The module uses the official v1 TypeScript SDK and Streamable HTTP transport. It never calls `tools/list`, `tools/call`, prompts, or remote write operations. This is deliberate capability scope, not a claim that all MCP services are compatible.

## Integration

Install `@modelcontextprotocol/sdk@^1` and its `zod@^4` peer. Server bootstrap creates:

```ts
const imports = createMcpImports(ownerConfigs, katha.evidence);
```

`ownerConfigs` contains `{ id, label, url, tokenEnv? }` records. The server reads the optional bearer credential from the named environment variable; `connections()` returns only ID, label and whether the credential is configured. Recreate this module when the owner changes connection settings. The loopback-only Connections panel is the local owner's configuration interface. It stores its configuration and optional bearer credentials in the private, Git-ignored `data/mcp-connections.json` file (mode 0600). Endpoints and resource names are shown locally; credentials are never returned. Configuration must remain unavailable to remote visitors. Do not turn this into a public unauthenticated endpoint that accepts arbitrary connection URLs.

- `connections()` lists configured sources without credentials or endpoints.
- `list(connectionId, cursor?)` returns up to 50 advertised resources and a server pagination cursor. `truncated` is true when a server page exceeded this local display limit.
- `importResource(connectionId, uri)` requires a resource advertised within the preceding five minutes. It reads that resource and passes the retained text to `evidence.import`.

The endpoint must use HTTPS with a hostname, without a query string, URL credentials or fragment. Local hostnames and literal IP endpoints are rejected. Redirects are refused, network calls have a 12-second timeout, responses are capped at 2 MB, and imported text at 1 MB. Text, Markdown, CSV, HTML, XML and JSON resource bodies are accepted; binary resources must use an appropriate export/upload flow.

## Authorization and compatibility

A server that returns 401/403 produces `MCP_AUTH_REQUIRED`. The module does **not** implement OAuth registration, browser consent, refresh tokens or per-visitor accounts. A provider-specific OAuth adapter is needed for services requiring those flows. A connection in the Codex app is not automatically a connection available to Katha.

A server that does not advertise MCP resources produces `MCP_RESOURCES_UNSUPPORTED`. Many SaaS servers offer search/export through **tools** instead of resources. Such a server needs a separately designed, allowlisted, read-only provider adapter. Do not label Canva or any CRM as working merely because a server URL can be saved. Verify that provider's capabilities and authorization with a real account first.

## Verification

A local protocol fixture verified initialization, resource listing, rejection of an unlisted URI, explicit selected-resource import into real temporary SQLite, retained URI provenance and absence of `tools/*` calls. This is protocol coverage, not a live Canva/CRM authorization test. Those provider tests remain pending configuration and credentials.

Primary references:

- [Official TypeScript client documentation](https://ts.sdk.modelcontextprotocol.io/client.html)
- [Official v1 SDK installation and capabilities](https://ts.sdk.modelcontextprotocol.io/)

Use **Connections** in the sidebar, or type **@** and choose **Connect a source**. Add a name, HTTPS Streamable HTTP MCP URL and optional bearer token. Browse advertised resources, explicitly import one, then attach it from the @ source picker. Saving settings means configured, not verified provider access. Removing a server stops future imports but does not remove already imported files; remove those separately in Files.
