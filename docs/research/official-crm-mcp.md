# Official CRM MCP connections

Research checked 12 November 2026. A first-party MCP endpoint is not the same thing as a Codex-installed plugin: Katha must register its own OAuth client and the visitor must authorize it. Katha's optional evidence imports should remain separate from the challenge agent's one model-callable web-search tool.

## HubSpot

HubSpot's first-party remote server is `https://mcp.hubspot.com`. Its [integration guide](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server) requires an MCP Auth App, client ID and secret, registered redirect URI, and OAuth PKCE. The visitor selects their HubSpot account and reviews the permissions. HubSpot says the available scopes depend on the server tools at installation and user grants; the remote server offers both read and write operations. Do not advertise its OAuth grant as universally read-only.

The [official OpenAI HubSpot plugin](https://github.com/openai/plugins/blob/main/plugins/hubspot/skills/hubspot/SKILL.md) identifies `get_user_details`, `search_crm_objects`, and `get_crm_objects` as current read tools. A safe importer must explicitly allowlist the two record-read tools and validate the live authenticated `tools/list` schemas, limit output, retain provenance, and never call `manage_crm_objects`. Tool annotations alone do not prove a tool is read-only. A real account and registered MCP app are required to verify the actual server schemas and consent flow end to end.

Katha now includes an official MCP importer alongside the separately labeled API connector. Its read-tool behavior has protocol fixture coverage; live account authorization, consent scopes, and the authenticated provider schemas still require verification.

## Scope of provider coverage

A universal "Sign in with Google" cannot authorize arbitrary CRM accounts. Each integration needs a provider-specific registered application or a server that supports dynamic client registration, plus appropriate scopes. Do not advertise Salesforce, Zoho, or other CRM MCP imports until their first-party endpoint, OAuth client requirements, exact read tools and permissions have been verified and implemented.
