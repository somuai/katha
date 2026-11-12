import type { FastifyInstance } from "fastify";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpImports, type McpConnectionConfig } from "./mcp-import.js";
import { createMcpOAuthManager } from "./oauth.js";
import { createSalesforceConnector } from "./salesforce.js";
import { createHubspotMcp } from "./hubspot-mcp.js";
import { createNotionConnector } from "./notion.js";
import { createCanvaConnector } from "./canva.js";
import { createGmailConnector } from "./gmail.js";
import { createHubspotConnector, type HubspotObjectKind } from "./hubspot.js";
import { providerCatalog } from "./catalog.js";
import { createConnectionOperations } from "./operations.js";
type Saved = McpConnectionConfig & { token?: string };
export async function registerConnections(
  app: FastifyInstance,
  evidence: Parameters<typeof createMcpImports>[1],
  directory: string,
) {
  const path = join(directory, "mcp-connections.json");
  const origin = `http://localhost:${Number(process.env.PORT || 3000)}`;
  const oauth = createMcpOAuthManager({
    directory: join(directory, "mcp-oauth"),
    callbackUrl: origin + "/api/connections/oauth/callback",
    clientFor: (id) =>
      id === "official-salesforce" && process.env.SALESFORCE_CLIENT_ID
        ? {
            client_id: process.env.SALESFORCE_CLIENT_ID,
            client_secret: process.env.SALESFORCE_CLIENT_SECRET,
          }
        : id === "official-hubspot" &&
            process.env.HUBSPOT_MCP_CLIENT_ID &&
            process.env.HUBSPOT_MCP_CLIENT_SECRET
          ? {
              client_id: process.env.HUBSPOT_MCP_CLIENT_ID,
              client_secret: process.env.HUBSPOT_MCP_CLIENT_SECRET,
            }
          : undefined,
  });
  const salesforce = createSalesforceConnector({ oauth, evidence });
  const hubspotMcp = createHubspotMcp({ oauth, evidence });
  const notion = createNotionConnector({ oauth, evidence });
  // Canva requires an IP-literal loopback redirect. Its separate manager
  // preserves Notion's previously registered localhost redirect and tokens.
  const canvaOauth = createMcpOAuthManager({
    directory: join(directory, "canva-oauth"),
    callbackUrl: `http://127.0.0.1:${Number(process.env.PORT || 3000)}/api/connections/canva/callback`,
    clientFor: (id) =>
      id === "official-canva" &&
      process.env.CANVA_CLIENT_ID &&
      process.env.CANVA_CLIENT_SECRET
        ? {
            client_id: process.env.CANVA_CLIENT_ID,
            client_secret: process.env.CANVA_CLIENT_SECRET,
          }
        : undefined,
    scopeFor: (id) =>
      id === "official-canva"
        ? "profile:read design:meta:read design:content:read"
        : undefined,
  });
  const canva = createCanvaConnector({ oauth: canvaOauth, evidence });
  const gmail = createGmailConnector({
    directory: join(directory, "provider-oauth"),
    redirectUri: origin + "/api/connections/gmail/callback",
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  });
  const hubspot = createHubspotConnector({
    directory: join(directory, "provider-oauth"),
    redirectUri: origin + "/api/connections/hubspot/callback",
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
  });
  const operations = createConnectionOperations();
  function callbackResult(reply: any) {
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .type("text/html")
      .send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Connected to Katha</title><body><h1>Connection authorized</h1><p>You can return to Katha and select what to import.</p><a href="/">Return to Katha</a></body></html>',
      );
  }
  app.get("/api/connections/providers", async () => ({
    providers: providerCatalog({
      salesforceConfigured: !!process.env.SALESFORCE_CLIENT_ID,
      salesforceConnected: salesforce.status().connected,
      hubspotMcpConfigured:
        !!process.env.HUBSPOT_MCP_CLIENT_ID &&
        !!process.env.HUBSPOT_MCP_CLIENT_SECRET,
      hubspotMcpConnected: hubspotMcp.status().connected,
      gmailConfigured: gmail.status().configured,
      gmailConnected: gmail.status().connected,
      hubspotConfigured: hubspot.status().configured,
      hubspotConnected: hubspot.status().connected,
      notionConnected: notion.status().connected,
      canvaConfigured:
        !!process.env.CANVA_CLIENT_ID && !!process.env.CANVA_CLIENT_SECRET,
      canvaConnected: canva.status().connected,
    }),
    hubspotKinds: hubspot.status().kinds,
    localWorkspace: true,
  }));
  app.post("/api/connections/salesforce/authorize", async () => {
    if (!process.env.SALESFORCE_CLIENT_ID)
      throw Object.assign(
        Error("Configure the Salesforce External Client App first."),
        { status: 503 },
      );
    operations.limit("salesforce:auth", 6);
    operations.invalidate("salesforce");
    return salesforce.start();
  });
  app.get("/api/connections/salesforce/records", async (req) => {
    operations.limit("salesforce:list", 30);
    const q = req.query as any;
    if (!["contacts", "companies", "deals"].includes(q.kind) || q.q)
      throw Error(
        "Choose a record type; only recently viewed records are supported.",
      );
    return operations.cached("salesforce", q.kind, () =>
      salesforce.list(q.kind),
    );
  });
  app.post("/api/connections/salesforce/import", async (req) => {
    operations.limit("salesforce:import", 6);
    const b = req.body as any;
    if (
      !["contacts", "companies", "deals"].includes(b?.kind) ||
      typeof b?.id !== "string"
    )
      throw Error("Choose a CRM record.");
    return salesforce.importRecord(b.kind, b.id);
  });
  app.delete("/api/connections/salesforce", async () => {
    salesforce.disconnect();
    operations.invalidate("salesforce");
    return { removed: true };
  });
  app.post("/api/connections/hubspot-mcp/authorize", async () => {
    if (
      !process.env.HUBSPOT_MCP_CLIENT_ID ||
      !process.env.HUBSPOT_MCP_CLIENT_SECRET
    )
      throw Object.assign(Error("Configure the HubSpot MCP Auth App first."), {
        status: 503,
      });
    operations.limit("hubspot-mcp:auth", 6);
    operations.invalidate("hubspot-mcp");
    return hubspotMcp.start();
  });
  app.get("/api/connections/hubspot-mcp/records", async (req) => {
    operations.limit("hubspot-mcp:list", 30);
    const q = req.query as any;
    if (
      !["contacts", "companies", "deals"].includes(q.kind) ||
      typeof (q.q || "") !== "string" ||
      (q.q || "").length > 500 ||
      (q.cursor && typeof q.cursor !== "string")
    )
      throw Error("Invalid record search.");
    return operations.cached(
      "hubspot-mcp",
      JSON.stringify([q.kind, q.q, q.cursor]),
      () => hubspotMcp.list(q.kind, q.q || "", q.cursor),
    );
  });
  app.post("/api/connections/hubspot-mcp/import", async (req) => {
    operations.limit("hubspot-mcp:import", 6);
    const b = req.body as any;
    if (
      !["contacts", "companies", "deals"].includes(b?.kind) ||
      typeof b?.id !== "string"
    )
      throw Error("Choose a CRM record.");
    return hubspotMcp.importRecord(b.kind, b.id);
  });
  app.delete("/api/connections/hubspot-mcp", async () => {
    hubspotMcp.disconnect();
    operations.invalidate("hubspot-mcp");
    return { removed: true };
  });
  for (const id of ["notion", "canva"] as const) {
    const connector = id === "notion" ? notion : canva;
    app.post(`/api/connections/${id}/authorize`, async () => {
      if (
        id === "canva" &&
        (!process.env.CANVA_CLIENT_ID || !process.env.CANVA_CLIENT_SECRET)
      )
        throw Object.assign(
          Error("The owner must register Katha's Canva MCP application first."),
          { status: 503, code: "CANVA_NOT_CONFIGURED" },
        );
      operations.limit(id + ":auth", 6);
      operations.invalidate(id);
      return connector.start();
    });
    app.get(`/api/connections/${id}/resources`, async (req) => {
      operations.limit(id + ":list", 30);
      const q = req.query as any;
      if (
        (q.q && (typeof q.q !== "string" || q.q.length > 500)) ||
        (q.cursor && (typeof q.cursor !== "string" || q.cursor.length > 2048))
      )
        throw Error("Invalid source search.");
      return operations.cached(id, JSON.stringify([q.q || "", q.cursor]), () =>
        connector.list(q.q || "", q.cursor),
      );
    });
    app.post(`/api/connections/${id}/import`, async (req) => {
      operations.limit(id + ":import", 6);
      const item = (req.body as any)?.id;
      if (typeof item !== "string") throw Error("Choose a source.");
      return id === "notion"
        ? notion.importPage(item)
        : canva.importDesign(item);
    });
    app.delete(`/api/connections/${id}`, async () => {
      connector.disconnect();
      operations.invalidate(id);
      return { removed: true };
    });
  }
  app.post("/api/connections/gmail/authorize", async () => {
    operations.limit("gmail:auth", 6);
    operations.invalidate("gmail");
    return gmail.start();
  });
  app.get("/api/connections/gmail/callback", async (req, reply) => {
    operations.limit("gmail:callback", 12);
    const q = req.query as any;
    if (typeof q.state !== "string" || typeof q.code !== "string")
      return reply.code(400).send({
        error:
          "Google authorization was cancelled or incomplete. Return to Katha and reconnect.",
      });
    await gmail.finish(q.state, q.code);
    operations.invalidate("gmail");
    return callbackResult(reply);
  });
  app.get("/api/connections/gmail/messages", async (req) => {
    operations.limit("gmail:list", 30);
    const q = req.query as any;
    if (
      (q.q && (typeof q.q !== "string" || q.q.length > 500)) ||
      (q.cursor && (typeof q.cursor !== "string" || q.cursor.length > 2048))
    )
      throw Error("Invalid mail search.");
    return operations.cached(
      "gmail",
      JSON.stringify([q.q || "", q.cursor]),
      () => gmail.list(q.q || "", q.cursor),
    );
  });
  app.post("/api/connections/gmail/import", async (req) => {
    operations.limit("gmail:import", 6);
    const id = (req.body as any)?.id;
    if (typeof id !== "string") throw Error("Choose a message.");
    return gmail.importMessage(id, evidence);
  });
  app.delete("/api/connections/gmail", async () => {
    gmail.disconnect();
    operations.invalidate("gmail");
    return { removed: true };
  });
  app.post("/api/connections/hubspot/authorize", async (req) => {
    operations.limit("hubspot:auth", 6);
    operations.invalidate("hubspot");
    const kinds = (req.body as any)?.kinds;
    return hubspot.start(kinds);
  });
  app.get("/api/connections/hubspot/callback", async (req, reply) => {
    operations.limit("hubspot:callback", 12);
    const q = req.query as any;
    if (typeof q.state !== "string" || typeof q.code !== "string")
      return reply.code(400).send({
        error:
          "HubSpot authorization was cancelled or incomplete. Return to Katha and reconnect.",
      });
    await hubspot.finish(q.state, q.code);
    operations.invalidate("hubspot");
    return callbackResult(reply);
  });
  app.get("/api/connections/hubspot/records", async (req) => {
    operations.limit("hubspot:list", 30);
    const q = req.query as any;
    if (
      !["contacts", "companies", "deals"].includes(q.kind) ||
      (q.q && (typeof q.q !== "string" || q.q.length > 500)) ||
      (q.cursor && (typeof q.cursor !== "string" || q.cursor.length > 2048))
    )
      throw Error("Choose a CRM object and valid search.");
    return operations.cached(
      "hubspot",
      JSON.stringify([q.kind, q.q || "", q.cursor]),
      () => hubspot.list(q.kind, q.q || "", q.cursor),
    );
  });
  app.post("/api/connections/hubspot/import", async (req) => {
    operations.limit("hubspot:import", 6);
    const b = req.body as any;
    if (
      !["contacts", "companies", "deals"].includes(b?.kind) ||
      typeof b?.id !== "string"
    )
      throw Error("Choose a CRM record.");
    return hubspot.importRecord(b.kind as HubspotObjectKind, b.id, evidence);
  });
  app.delete("/api/connections/hubspot", async () => {
    hubspot.disconnect();
    operations.invalidate("hubspot");
    return { removed: true };
  });
  app.get("/api/connections/canva/callback", async (req, reply) => {
    operations.limit("canva:callback", 12);
    const q = req.query as any;
    if (typeof q.state !== "string" || typeof q.code !== "string")
      return reply.code(400).send({
        error:
          "Canva authorization was cancelled or incomplete. Return to Katha and reconnect.",
      });
    await canvaOauth.finish(q.state, q.code);
    operations.invalidate("canva");
    return callbackResult(reply);
  });
  app.get("/api/connections/oauth/callback", async (req, reply) => {
    const q = req.query as any;
    operations.limit("mcp:auth", 12);
    if (typeof q.state !== "string" || typeof q.code !== "string")
      return reply.code(400).send({
        error:
          "Authorization was cancelled or incomplete. Return to Katha and reconnect.",
      });
    const result = await oauth.finish(q.state, q.code);
    operations.invalidate(
      result.connectionId === "official-hubspot"
        ? "hubspot-mcp"
        : result.connectionId.replace(/^official-/, ""),
    );
    return callbackResult(reply);
  });
  let configs: Saved[] = [];
  try {
    configs = JSON.parse(await readFile(path, "utf8"));
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  let importer: ReturnType<typeof createMcpImports>;
  function create(next: Saved[]) {
    for (const c of next)
      if (c.tokenEnv) process.env[c.tokenEnv] = c.token || "";
    return createMcpImports(
      next,
      {
        async import(input) {
          const expected = next.find(
            (c) => c.id === input.metadata?.connectorId,
          );
          const current = configs.find(
            (c) => c.id === input.metadata?.connectorId,
          );
          if (
            !expected ||
            !current ||
            expected.url !== current.url ||
            expected.token !== current.token
          )
            throw Error(
              "Connection changed or was removed before import finished.",
            );
          return evidence.import(input);
        },
      },
      { authProvider: (id) => oauth.providerFor(id) },
    );
  }
  importer = create(configs);
  let tail = Promise.resolve();
  async function save(next: Saved[]) {
    const replacement = create(next);
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, path);
    configs = next;
    importer = replacement;
  }
  function mutate(fn: () => Promise<unknown>) {
    const result = tail.then(fn);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  app.get("/api/connections", async () => ({
    connections: importer
      .connections()
      .map((c) => ({ ...c, url: configs.find((x) => x.id === c.id)?.url })),
    capability:
      "Read-only selected imports. Named providers use their own consent screens; custom MCP supports compatible OAuth resource servers.",
  }));
  app.post("/api/connections", async (req) =>
    mutate(async () => {
      const body = req.body as any;
      if (
        typeof body?.label !== "string" ||
        typeof body?.url !== "string" ||
        body.label.length > 100 ||
        body.url.length > 2048 ||
        configs.length >= 10
      )
        throw Error("Provide a name and HTTPS MCP URL; at most ten servers.");
      if (
        body.token !== undefined &&
        (typeof body.token !== "string" || body.token.length > 8192)
      )
        throw Error("Invalid credential.");
      const id = "conn-" + randomUUID(),
        tokenEnv = "KATHA_MCP_" + id.replaceAll("-", "_").toUpperCase();
      await save([
        ...configs,
        {
          id,
          label: body.label.trim(),
          url: body.url.trim(),
          tokenEnv,
          token: body.token || "",
        },
      ]);
      return { id };
    }),
  );
  app.delete("/api/connections/:id", async (req) =>
    mutate(async () => {
      const id = (req.params as any).id;
      const old = configs.find((c) => c.id === id);
      await save(configs.filter((c) => c.id !== id));
      oauth.disconnect(id);
      operations.invalidate(id);
      if (old?.tokenEnv) delete process.env[old.tokenEnv];
      return { removed: true };
    }),
  );
  app.post("/api/connections/:id/authorize", async (req) => {
    const id = (req.params as any).id,
      config = configs.find((c) => c.id === id);
    if (!config) throw Error("Choose a saved connection.");
    operations.limit(id + ":auth", 6);
    operations.invalidate(id);
    return oauth.start(id, config.url);
  });
  app.get("/api/connections/:id/resources", async (req) => {
    const id = (req.params as any).id,
      cursor = (req.query as any)?.cursor;
    if (cursor && typeof cursor !== "string") throw Error("Invalid cursor.");
    operations.limit(id + ":list", 30);
    return operations.cached(id, cursor || "", () => importer.list(id, cursor));
  });
  app.post("/api/connections/:id/import", async (req) => {
    operations.limit((req.params as any).id + ":import", 6);
    const uri = (req.body as any)?.uri;
    if (typeof uri !== "string" || uri.length > 4096)
      throw Error("Choose an advertised resource.");
    return importer.importResource((req.params as any).id, uri);
  });
}
