import test from "node:test";
import assert from "node:assert/strict";
import { createSalesforceConnector } from "../src/connectors/salesforce.ts";
const recordId = "001000000000001AAA";
function fixture(options: { schemaChanged?: boolean; status?: number } = {}) {
  let connected = true;
  const calls: string[] = [],
    imports: any[] = [];
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
    if (options.status)
      return new Response("busy", {
        status: options.status,
        headers: { "retry-after": "60" },
      });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const msg = JSON.parse(String(init?.body));
    calls.push(msg.method + (msg.params?.name ? ":" + msg.params.name : ""));
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
            name: "listRecentSobjectRecords",
            inputSchema: {
              type: "object",
              properties: { "sobject-name": { type: "string" } },
              required: options.schemaChanged
                ? ["sobject-name", "unsafe"]
                : ["sobject-name"],
            },
          },
          {
            name: "soqlQuery",
            inputSchema: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
            },
          },
          { name: "deleteRecord", inputSchema: { type: "object" } },
        ],
      };
    if (msg.method === "tools/call") {
      if (msg.params.name === "soqlQuery")
        assert.equal(
          msg.params.arguments.query,
          `SELECT Id, Name FROM Account WHERE Id = '${recordId}' LIMIT 1`,
        );
      result = {
        structuredContent: {
          records: [{ Id: recordId, Name: "Acme", Secret: "not imported" }],
        },
      };
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const c = createSalesforceConnector({
    oauth,
    fetcher,
    evidence: {
      async import(x) {
        imports.push(x);
        return { sourceId: "s1" };
      },
    },
  });
  return { c, calls, imports };
}
test("Salesforce imports a selected recent record using only fixed read tools and fields", async () => {
  const { c, calls, imports } = fixture();
  await assert.rejects(
    c.importRecord("companies", recordId),
    /select a record/,
  );
  assert.equal((await c.list("companies")).resources[0].title, "Acme");
  await c.importRecord("companies", recordId);
  assert.equal(imports[0].metadata.connectorId, "salesforce");
  assert.doesNotMatch(imports[0].content, /Secret/);
  assert.ok(!calls.some((x) => x.includes("deleteRecord")));
  c.disconnect();
  await assert.rejects(
    c.importRecord("companies", recordId),
    /select a record/,
  );
});
test("Salesforce rejects unrecognized schema, arbitrary input, and exposes provider retry delay", async () => {
  await assert.rejects(
    fixture({ schemaChanged: true }).c.list("companies"),
    /schema changed/,
  );
  await assert.rejects(
    fixture().c.list("companies", "untrusted"),
    /not yet available/,
  );
  await assert.rejects(
    fixture().c.importRecord("companies", "001000000000001' OR Name"),
    /Invalid record ID/,
  );
  await assert.rejects(fixture({ status: 429 }).c.list("companies"), {
    status: 429,
    retryAfter: 60,
  });
});

test("disconnect while a Salesforce result is in flight rejects the stale selection", async () => {
  let connected = true;
  let release!: () => void;
  let reached!: () => void;
  const entered = new Promise<void>((r) => (reached = r));
  const gate = new Promise<void>((r) => (release = r));
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
  } as any;
  const fetcher: typeof fetch = async (_input, init) => {
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const msg = JSON.parse(String(init?.body));
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
            name: "listRecentSobjectRecords",
            inputSchema: {
              type: "object",
              properties: { "sobject-name": { type: "string" } },
              required: ["sobject-name"],
            },
          },
        ],
      };
    if (msg.method === "tools/call") {
      reached();
      await gate;
      result = {
        structuredContent: { records: [{ Id: recordId, Name: "Acme" }] },
      };
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const connector = createSalesforceConnector({
    oauth,
    fetcher,
    evidence: {
      async import() {
        throw Error("must not import");
      },
    },
  });
  const pending = connector.list("companies");
  await entered;
  connector.disconnect();
  release();
  await assert.rejects(pending, /connection changed/i);
  await assert.rejects(
    connector.importRecord("companies", recordId),
    /select a record/i,
  );
});
