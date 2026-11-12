import type { FastifyInstance } from "fastify";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createMcpImports, type McpConnectionConfig } from "./mcp-import.js";
type Saved = McpConnectionConfig & { token?: string };
export async function registerConnections(
  app: FastifyInstance,
  evidence: Parameters<typeof createMcpImports>[1],
  directory: string,
) {
  const path = join(directory, "mcp-connections.json");
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
    return createMcpImports(next, {
      async import(input) {
        const expected = next.find((c) => c.id === input.metadata?.connectorId);
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
    });
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
      "Read-only MCP resources. OAuth and tool-only SaaS connectors require a provider adapter.",
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
      if (old?.tokenEnv) delete process.env[old.tokenEnv];
      return { removed: true };
    }),
  );
  app.get("/api/connections/:id/resources", async (req) =>
    importer.list((req.params as any).id, (req.query as any)?.cursor),
  );
  app.post("/api/connections/:id/import", async (req) => {
    const uri = (req.body as any)?.uri;
    if (typeof uri !== "string" || uri.length > 4096)
      throw Error("Choose an advertised resource.");
    return importer.importResource((req.params as any).id, uri);
  });
}
