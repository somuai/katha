/** Named providers shown without requiring a visitor to supply a server URL.
 * Unimplemented integrations remain explicit; catalog entries are not authorization.
 */
export function providerCatalog(options: {
  gmailConfigured: boolean;
  gmailConnected: boolean;
  hubspotConfigured?: boolean;
  hubspotConnected?: boolean;
  notionConnected?: boolean;
  canvaConfigured?: boolean;
  canvaConnected?: boolean;
}) {
  return [
    {
      id: "notion",
      name: "Notion",
      integration: "Official MCP",
      documentation:
        "https://developers.notion.com/guides/mcp/build-mcp-client",
      description:
        "Search your workspace and import selected pages. Katha only searches and reads; Notion’s consent may grant broader permissions, so review the access before connecting.",
      available: true,
      connected: !!options.notionConnected,
      status: options.notionConnected ? "connected" : "ready",
      setup:
        "Sign in to Notion and review the workspace access in its consent screen.",
    },
    {
      id: "gmail",
      integration: "Google API · read-only",
      documentation:
        "https://developers.google.com/workspace/gmail/api/auth/scopes",
      name: "Gmail",
      description:
        "Search your mail and import only selected message text. Read-only; no sending or mailbox changes.",
      available: options.gmailConfigured,
      connected: options.gmailConfigured && options.gmailConnected,
      status: options.gmailConfigured
        ? options.gmailConnected
          ? "connected"
          : "ready"
        : "owner_setup_required",
      setup:
        "Owner configures GOOGLE_CLIENT_ID, optional GOOGLE_CLIENT_SECRET, Google consent screen and Gmail API. Google verification or test-user access may be required.",
    },
    {
      id: "hubspot",
      integration: "HubSpot API · read-only",
      documentation:
        "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth",
      name: "HubSpot",
      description:
        "Choose read-only contacts, companies or deals; import only selected records.",
      available: !!options.hubspotConfigured,
      connected: !!options.hubspotConfigured && !!options.hubspotConnected,
      status: options.hubspotConfigured
        ? options.hubspotConnected
          ? "connected"
          : "ready"
        : "owner_setup_required",
      setup:
        "Owner configures HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET, registered callback, and only OAuth plus optional CRM contacts/companies/deals read scopes.",
    },
    {
      id: "salesforce",
      name: "Salesforce",
      description: "CRM record import",
      available: false,
      connected: false,
      status: "not_implemented",
      setup:
        "A verified read-only provider integration and OAuth app are not configured.",
    },
    {
      id: "canva",
      name: "Canva",
      integration: "Official MCP",
      documentation: "https://www.canva.dev/docs/apps/mcp/access/",
      description:
        "Search existing designs and import selected text through Canva’s official MCP server. No image generation or design changes.",
      available: !!options.canvaConfigured,
      connected: !!options.canvaConfigured && !!options.canvaConnected,
      status: options.canvaConfigured
        ? options.canvaConnected
          ? "connected"
          : "ready"
        : "owner_setup_required",
      setup:
        "Owner registers a Canva MCP application and sets CANVA_CLIENT_ID and CANVA_CLIENT_SECRET. Requests profile and existing-design read scopes only.",
    },
  ];
}
