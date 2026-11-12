# Connections: named consent, selected imports

Open **Connections** in the sidebar, or type **@** → **Connect a source**. The default view is a provider picker, not a URL form. Notion, Canva, HubSpot and Salesforce have official MCP adapters. Gmail and HubSpot additionally have named API-based OAuth adapters, explicitly labeled as such. HubSpot and Salesforce live account flows remain unverified. A Codex connection is never reused implicitly.

This is a **single-user local workspace**, bound to loopback, with one connection per named provider. It is not a hosted multi-user account system. A hosted version needs sessions, per-user token isolation, encrypted secret storage and registered HTTPS callbacks before sharing access.

## Official MCP integrations

The provider picker uses fixed first-party endpoints; visitors do not paste URLs:

| Provider | Endpoint | Account authorization |
| --- | --- | --- |
| Notion | `https://mcp.notion.com/mcp` | Dynamic client registration and PKCE; click Connect and review Notion consent. |
| Canva | `https://api.canva.com/connect/v1/mcp` | Registered Canva MCP application credentials, PKCE, explicit design read scopes. |

Notion only calls `notion-search` and `notion-fetch`; Canva only calls `search-designs` and `get-design-content`. The actual tool schemas are inspected and incompatible required inputs fail visibly. Neither connector can invoke writes or generation tools. The server's `readOnlyHint` alone is not trusted as permission to call a tool. Imports require a recently listed explicit selection. Existing design text is supported, not an image-only design OCR/export pipeline.

Notion's provider consent may grant broader capabilities than Katha uses; **read-only calls** do not mean a read-only OAuth grant. Review the provider's consent screen. Canva explicitly requests `profile:read design:meta:read design:content:read`; it does not inherit all advertised write scopes. Token responses declaring extra scopes are rejected. A token response omitting scopes cannot independently prove grant breadth.

Notion's initial live discovery/registration produced an official authorization URL on 12 November 2026; no workspace login, page fetch or account authorization was performed. Canva's flow is fixture-verified and still requires configured app credentials. Notion uses `http://localhost:3000/api/connections/oauth/callback`. Canva requires the IP-literal loopback callback `http://127.0.0.1:3000/api/connections/canva/callback`.

Codex's plugin model packages skills/MCP settings; Katha implements its own host connection UI and OAuth client. Codex's existing authenticated sessions and host-specific connectors do not transfer. No official portable Gmail MCP endpoint is invented. HubSpot's official MCP needs a separately registered MCP client and validated tool mapping; the current HubSpot import adapter is the explicitly labeled direct API path.

## Setup once; visitors authorize their own accounts

The application owner registers the OAuth applications. A visitor's Google sign-in alone cannot register Katha as an OAuth client or authorize unrelated providers. Put application credentials in the root `.env`, never in chat:

- `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`: create a Canva developer application, enable Canva MCP and register the Canva callback above. Notion needs no preconfigured app secret.
- `GOOGLE_CLIENT_ID`, optional `GOOGLE_CLIENT_SECRET` depending on Google client type. Enable Gmail API and configure consent/test users. Register `http://localhost:3000/api/connections/gmail/callback` (use the configured PORT). Google restricts `gmail.readonly`; production distribution can require verification. No live account authorization has been claimed.
- `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`. Register `http://localhost:3000/api/connections/hubspot/callback`. Configure OAuth and only the optional contacts/companies/deals read scopes being offered. Ordinary HubSpot app OAuth uses its documented confidential-client flow; it is distinct from HubSpot's PKCE MCP flow.

Restart after configuration. The visitor clicks **Connect**, sees provider consent, returns to Katha, searches, and explicitly imports selected messages/records. Tokens are persisted only in private mode-0600 files in ignored `data/provider-oauth/`. Pending state expires after ten minutes and is single-use. Gmail additionally uses PKCE. Refreshes are serialized; disconnect invalidates in-flight operations.

## What permission means

Gmail requests **mailbox read-only**, not sending or modification. Google does not offer this flow a per-message OAuth grant. Katha displays metadata for up to 20 selected search results, reads full text only for a chosen import, and imports neither file attachments nor the whole mailbox. Selecting a message limits Katha's retained evidence; it does **not** narrow Google's mailbox-wide permission.

HubSpot lets the visitor choose contacts, companies and/or deals before consent. Only selected object read scopes are requested, never writes. It retrieves basic allowlisted fields, not custom properties, associations or full activity history. Existing HubSpot account permissions also apply. Unexpected extra/write token scopes are rejected.

Imported material becomes retained evidence with connector identity, original URI, extraction method and import time. It may be sent to the configured answer provider when relevant. Import time is an observation, not proof of when a fact became true. Katha automatically considers relevant retained sources during chat; the visitor need not type “use my files.” Connections do not silently import future account updates. **Disconnect** stops future access and clears local credentials; imported files remain until separately deleted. Revoke the app in the provider's account settings to revoke its remote grant.

## Advanced MCP

**Advanced: custom MCP server** supports HTTPS Streamable HTTP servers advertising text resources. Configure `{id,label,url,tokenEnv?}` through the local-owner UI; endpoints have no query/credentials/fragment or local/literal IP hostnames. Compatible MCP OAuth uses the official SDK's discovery, dynamic registration, PKCE, exchange and refresh. Servers requiring pre-registered client credentials not supported by dynamic registration need an adapter; do not claim every MCP server works.

The importer calls initialization, `resources/list`, and `resources/read`, never arbitrary tools. Tool-only SaaS servers need a named, allowlisted read adapter. The model still has **one tool: web search**. Account imports are user actions into the Evidence Library, not additional model-controlled tools.

List returns at most 50 resources; import requires a URI listed in the previous five minutes. Network calls time out after 12 seconds, redirects are refused, response bytes are capped at 2 MB and imported text at 1 MB. Text, Markdown, CSV, HTML, XML and JSON are retained as untrusted content, never executed.

## Caching and limits

Listings cache successful results for 30 seconds, coalesce identical concurrent requests and retain at most 100 cached pages. Caches are local to a connection, invalidated on authorization/disconnect, and do not cache failed responses or import receipts. Browse is limited to 30 requests/minute, imports and authorization starts to 6/minute per connection. Provider 429/503 responses expose a bounded `Retry-After` rather than silently retrying. Search has its separate persistent credit budget and freshness-aware cache.

## Verification and references

Fixture tests exercise real SDK discovery/PKCE/refresh, state replay/expiry, read scopes, MIME extraction, selected imports through real SQLite, provider throttling and disconnect races. These are protocol tests, not live Gmail/HubSpot sign-in verification.

- [Google OAuth installed applications](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail messages list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
- [Gmail messages get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [HubSpot OAuth v3 guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth)
- [HubSpot CRM search](https://developers.hubspot.com/docs/guides/api/crm/search)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [Official SDK client documentation](https://ts.sdk.modelcontextprotocol.io/client.html)

The Gmail icon is served locally from Google's official `ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico`. Salesforce uses its login-site favicon; HubSpot uses its site favicon obtained through Google’s favicon service and saved locally. Loading shows only actual selected evidence, not simulated connections.

Additional primary references:

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [Notion MCP client guide](https://developers.notion.com/guides/mcp/build-mcp-client)
- [Notion tools reference](https://developers.notion.com/guides/mcp/tools-search-reference)
- [Canva MCP access](https://www.canva.dev/docs/apps/mcp/access/)

Local provider icons also come from official first-party assets: Notion `https://www.notion.so/images/favicon.ico`, Canva `https://static.canva.com/static/images/favicon-1.ico`. No private query or source title is sent to a remote logo service.

POSIX private-file mode checks apply on macOS/Linux. Windows does not implement these mode bits as per-user ACLs; use a user-private workspace directory with appropriate Windows permissions. The local token store is not an encrypted multi-user credential vault.

## Official HubSpot MCP

The provider picker includes HubSpot’s official MCP endpoint. Register a HubSpot MCP Auth App and set `HUBSPOT_MCP_CLIENT_ID` and `HUBSPOT_MCP_CLIENT_SECRET` in `.env`. HubSpot determines the permissions in its consent flow, which may include writes; Katha invokes only its fixed read tools. The integration has protocol fixture coverage, but its authenticated live schemas and account access remain unverified. See [research](research/official-crm-mcp.md).

## Salesforce official MCP

The Salesforce card targets Salesforce's official production SObject Reads MCP server. An org administrator must enable it and register an External Client App; configure `SALESFORCE_CLIENT_ID`; use `SALESFORCE_CLIENT_SECRET` only for a confidential client. Salesforce states that hosted MCP can require Flex Credits and incur charges. Katha currently lists recently viewed contacts, companies, and deals and imports only the selected record's ID and name. It does not support free-text CRM search or sandbox orgs. OAuth consent and real account response schemas have not been verified; fixture tests do not establish live compatibility.

[Salesforce SObject Reads](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/references/reference/sobject-reads.html) · [Connection setup](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/client-connection-overview.html) · [Hosted MCP usage](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html)
