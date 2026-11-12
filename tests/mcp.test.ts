import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKatha } from "../src/core/index.ts";
import { createMcpImports } from "../src/connectors/mcp-import.ts";
const config = {
  id: "crm",
  label: "Fixture CRM",
  url: "https://crm.example/mcp",
};
function fixture(
  options: {
    capabilities?: Record<string, unknown>;
    text?: string;
    status?: number;
  } = {},
) {
  const methods: string[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    if (options.status)
      return new Response("Authorization required", { status: options.status });
    if (init?.method === "GET") return new Response(null, { status: 405 });
    const message = JSON.parse(String(init?.body));
    methods.push(message.method);
    if (!("id" in message)) return new Response(null, { status: 202 });
    const result =
      message.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: options.capabilities || { resources: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : message.method === "resources/list"
          ? {
              resources: [
                {
                  uri: "crm://accounts",
                  name: "Accounts",
                  mimeType: "text/csv",
                },
              ],
            }
          : {
              contents: [
                {
                  uri: "crm://accounts",
                  mimeType: "text/csv",
                  text: options.text || "name,stage\nAsha,new",
                },
              ],
            };
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: message.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  };
  return { fetcher, methods };
}
async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), "katha-mcp-"));
  const app = createKatha({ directory });
  return {
    app,
    async close() {
      app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("MCP selected text imports retain source provenance and use only resource protocol methods", async () => {
  const { app, close } = await workspace(),
    server = fixture(),
    imports = createMcpImports([config], app.evidence, {
      fetcher: server.fetcher,
    });
  try {
    await assert.rejects(imports.importResource("crm", "crm://accounts"), {
      code: "MCP_RESOURCE_NOT_LISTED",
    });
    const listed = await imports.list("crm");
    assert.equal(listed.resources[0].uri, "crm://accounts");
    const receipt = await imports.importResource("crm", "crm://accounts");
    const source = await app.evidence.inspect(receipt.sourceId);
    assert.equal(source.content, "name,stage\nAsha,new");
    assert.equal(source.title, "Accounts.csv");
    assert.equal(source.metadata.resourceUri, "crm://accounts");
    assert.equal(source.metadata.connectorId, "crm");
    assert.equal(source.metadata.method, "mcp-resource-text");
    assert.ok(!server.methods.some((method) => method.startsWith("tools/")));
  } finally {
    await close();
  }
});

test("MCP authorization failures are explicit and connection discovery never returns credentials", async () => {
  const { app, close } = await workspace();
  const previous = process.env.KATHA_MCP_FIXTURE_TOKEN;
  process.env.KATHA_MCP_FIXTURE_TOKEN = "fixture-secret-not-for-browser";
  try {
    const imports = createMcpImports(
      [{ ...config, tokenEnv: "KATHA_MCP_FIXTURE_TOKEN" }],
      app.evidence,
      { fetcher: fixture({ status: 401 }).fetcher },
    );
    assert.deepEqual(imports.connections(), [
      { id: "crm", label: "Fixture CRM", credentialConfigured: true },
    ]);
    await assert.rejects(imports.list("crm"), { code: "MCP_AUTH_REQUIRED" });
  } finally {
    if (previous === undefined) delete process.env.KATHA_MCP_FIXTURE_TOKEN;
    else process.env.KATHA_MCP_FIXTURE_TOKEN = previous;
    await close();
  }
});

test("a tools-only MCP server is not presented as a supported resource import connection", async () => {
  const { app, close } = await workspace();
  try {
    const imports = createMcpImports([config], app.evidence, {
      fetcher: fixture({ capabilities: { tools: {} } }).fetcher,
    });
    await assert.rejects(imports.list("crm"), {
      code: "MCP_RESOURCES_UNSUPPORTED",
    });
  } finally {
    await close();
  }
});

test("MCP imports reject oversized text and expired selections without retaining a partial source", async () => {
  const { app, close } = await workspace();
  let time = new Date("2026-11-12T12:00:00Z");
  try {
    const imports = createMcpImports([config], app.evidence, {
      clock: () => time,
      fetcher: fixture({ text: "x".repeat(1024 * 1024 + 1) }).fetcher,
    });
    await imports.list("crm");
    await assert.rejects(imports.importResource("crm", "crm://accounts"), {
      code: "MCP_RESOURCE_TOO_LARGE",
    });
    assert.deepEqual(await app.evidence.list(), []);
    time = new Date("2026-11-12T12:06:00Z");
    await assert.rejects(imports.importResource("crm", "crm://accounts"), {
      code: "MCP_RESOURCE_NOT_LISTED",
    });
  } finally {
    await close();
  }
});

test("MCP endpoints are restricted to owner-configured HTTPS hostnames", async () => {
  const { app, close } = await workspace();
  try {
    for (const url of [
      "http://crm.example/mcp",
      "https://127.0.0.1/mcp",
      "https://localhost/mcp",
      "https://crm.example/mcp?token=secret",
    ])
      assert.throws(
        () => createMcpImports([{ ...config, url }], app.evidence),
        { code: "INVALID_MCP_CONFIG" },
      );
    const imports = createMcpImports([config], app.evidence);
    await assert.rejects(imports.list("unknown"), {
      code: "MCP_CONNECTION_NOT_FOUND",
    });
  } finally {
    await close();
  }
});
