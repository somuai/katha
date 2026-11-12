import test from "node:test";
import assert from "node:assert/strict";
import { createHubspotMcp } from "../src/connectors/hubspot-mcp.ts";

test("official HubSpot MCP imports only selected records using fixed read tools", async () => {
  const methods: string[] = [],
    imported: any[] = [];
  let connected = true;
  const oauth = {
    hasTokens: () => connected,
    providerFor: () => ({
      tokens: async () => ({ access_token: "fixture", token_type: "Bearer" }),
      redirectUrl: "http://localhost:3000/callback",
      clientMetadata: { redirect_uris: ["http://localhost:3000/callback"] },
    }),
    disconnect: () => {
      connected = false;
    },
    start: async () => ({ authorized: true }),
  } as any;
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const msg = JSON.parse(String(init?.body));
    methods.push(msg.method + (msg.params?.name ? ":" + msg.params.name : ""));
    if (!("id" in msg)) return new Response(null, { status: 202 });
    let result: any = {};
    if (msg.method === "initialize")
      result = {
        protocolVersion: "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    if (msg.method === "tools/list")
      result = {
        tools: [
          {
            name: "search_crm_objects",
            inputSchema: {
              type: "object",
              properties: {
                objectType: { type: "string" },
                query: { type: "string" },
                limit: { type: "number" },
              },
              required: ["objectType"],
            },
          },
          {
            name: "get_crm_objects",
            inputSchema: {
              type: "object",
              properties: {
                objectType: { type: "string" },
                objectIds: { type: "array" },
              },
              required: ["objectType", "objectIds"],
            },
          },
          { name: "manage_crm_objects", inputSchema: { type: "object" } },
        ],
      };
    if (msg.method === "tools/call")
      result = {
        structuredContent: {
          results: [{ id: "12", properties: { name: "Acme" } }],
        },
      };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  const c = createHubspotMcp({
    oauth,
    fetcher,
    evidence: {
      async import(x) {
        imported.push(x);
        return { sourceId: "s1" };
      },
    },
  });
  await assert.rejects(c.importRecord("companies", "12"), /select a record/);
  assert.equal((await c.list("companies", "Acme")).resources[0].title, "Acme");
  assert.equal((await c.importRecord("companies", "12")).sourceId, "s1");
  assert.equal(imported[0].metadata.method, "official-mcp-hubspot");
  assert.ok(!methods.some((x) => x.includes("manage_crm_objects")));
  c.disconnect();
  await assert.rejects(c.importRecord("companies", "12"), /select a record/);
});
