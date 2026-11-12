/** Locally served official service favicons; no third-party request per chat source. */
export function providerLogo(id: string): string | undefined {
  switch (id.toLowerCase()) {
    case "gmail":
      return "/assets/providers/gmail.ico";
    case "notion":
      return "/assets/providers/notion.ico";
    case "canva":
      return "/assets/providers/canva.ico";
    case "salesforce":
      return "/assets/providers/salesforce.ico";
    case "hubspot":
    case "hubspot-mcp":
      return "/assets/providers/hubspot.png";
    default:
      return undefined;
  }
}
