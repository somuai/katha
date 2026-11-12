import { registerConnections } from "./connectors/routes.js";
import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createServer as createViteServer } from "vite";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseBuffer } from "music-metadata";
import { createKatha } from "./core/index.ts";
import { createKathaAdapters } from "./providers/index.ts";
import { extractAttachment } from "./ingestion/index.ts";
import { createLocalEmbedder } from "./ingestion/embeddings.ts";
const directory = path.resolve(process.env.KATHA_DATA_DIR || "data");
await mkdir(directory, { recursive: true });
const { model, search, providers } = createKathaAdapters({
  groqKey: process.env.GROQ_API_KEY,
  tavilyKey: process.env.TAVILY_API_KEY,
  model: process.env.GROQ_MODEL,
});
const embedder =
  process.env.KATHA_EMBEDDINGS === "off"
    ? undefined
    : createLocalEmbedder(path.join(directory, "models"));
const katha = createKatha({
  directory,
  model: process.env.GROQ_API_KEY ? model : undefined,
  search: process.env.TAVILY_API_KEY ? search : undefined,
  embedder,
});
const app = Fastify({ logger: false, bodyLimit: 11 * 1024 * 1024 });
await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});
app.addHook("onRequest", async (req, reply) => {
  if (
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  )
    return reply.code(403).send({ error: "Origin not allowed" });
});
app.setErrorHandler((e: any, req, reply) => {
  if (e.retryAfter) reply.header("Retry-After", String(e.retryAfter));
  reply
    .code(e.status || e.statusCode || 400)
    .send({ error: e.message, code: e.code || "REQUEST_FAILED" });
});
app.get("/api/workspace", async () => ({
  conversations: await katha.workspace.listConversations(),
  sources: [
    ...(await katha.evidence.list()),
    ...(await katha.evidence.list({ deleted: true })),
  ],
  configured: {
    model: !!process.env.GROQ_API_KEY,
    search: !!process.env.TAVILY_API_KEY,
  },
}));
app.post("/api/conversations", async (req) =>
  katha.workspace.createConversation((req.body as any)?.title),
);
app.post("/api/conversations/:id/trash", async (req) =>
  katha.workspace.trashConversation((req.params as any).id),
);
app.get("/api/conversations/:id", async (req) => {
  const chat = await katha.workspace.getConversation((req.params as any).id);
  return { conversation: chat, messages: chat.messages };
});
app.post("/api/conversations/:id/turns", async (req, reply) =>
  reply.code(202).send(
    await katha.turns.start({
      ...(req.body as any),
      conversationId: (req.params as any).id,
    }),
  ),
);
app.get("/api/turns/:id", async (req) =>
  katha.turns.get((req.params as any).id),
);
app.post("/api/turns/:id/cancel", async (req) =>
  katha.turns.cancel((req.params as any).id),
);
app.get("/api/turns/:id/events", async (req, reply) => {
  const id = (req.params as any).id;
  await katha.turns.get(id);
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let closed = false;
  reply.raw.on("close", () => (closed = true));
  const after = Number(req.headers["last-event-id"] || 0);
  for await (const event of katha.turns.events(id, after)) {
    if (closed) break;
    reply.raw.write(
      `id: ${event.id}\ndata: ${JSON.stringify({ type: event.type, ...(event.data as any) })}\n\n`,
    );
  }
  reply.raw.end();
});
app.get("/api/sources/:id", async (req) =>
  katha.evidence.inspect((req.params as any).id),
);
app.post("/api/sources/:id/trash", async (req) =>
  katha.evidence.trash((req.params as any).id),
);
app.post("/api/sources/:id/restore", async (req) =>
  katha.evidence.restore((req.params as any).id),
);
app.delete("/api/sources/:id", async (req) => {
  const id = (req.params as any).id;
  const source = await katha.evidence.inspect(id);
  const result = await katha.evidence.permanentlyDelete(id);
  if (source.metadata?.originalPath)
    await unlink(String(source.metadata.originalPath)).catch(() => {});
  return result;
});
app.post("/api/sources/:id/correct", async (req) =>
  katha.evidence.correct({
    ...(req.body as any),
    sourceId: (req.params as any).id,
  }),
);
app.post("/api/sources", async (req) => {
  const part = await req.file();
  if (!part) throw Error("Choose a file");
  const bytes = await part.toBuffer();
  if (part.file.truncated) throw Error("File exceeds 10 MB");
  if (part.mimetype.startsWith("audio/")) {
    const info = await parseBuffer(bytes, { mimeType: part.mimetype });
    if (!info.format.duration || info.format.duration > 60)
      throw Error(
        "Audio must have a detectable duration of at most 60 seconds",
      );
  }
  const extracted = await extractAttachment(
    bytes,
    part.filename,
    part.mimetype,
    { providers },
  );
  const fields = part.fields as any;
  const date = fields.occurredAt?.value;
  const originalPath = path.join(directory, "uploads", randomUUID());
  await mkdir(path.dirname(originalPath), { recursive: true });
  await writeFile(originalPath, bytes, { mode: 0o600 });
  try {
    const receipt = await katha.evidence.import({
      name: part.filename,
      content: extracted.content,
      occurredAt: date || undefined,
      mimeType: extracted.mimeType,
      metadata: {
        method: extracted.method,
        warnings: extracted.warnings,
        originalPath,
      },
    });
    return {
      source: {
        ...(await katha.evidence.inspect(receipt.sourceId)),
        text: extracted.content,
      },
      transcript:
        extracted.method === "whisper-transcript"
          ? extracted.content
          : undefined,
    };
  } catch (error) {
    await unlink(originalPath).catch(() => {});
    throw error;
  }
});
await registerConnections(app, katha.evidence, directory);
const vite = await createViteServer({
  configFile: path.resolve("vite.config.ts"),
  appType: "spa",
});
app.setNotFoundHandler((req, reply) => {
  reply.hijack();
  vite.middlewares(req.raw, reply.raw, () => {
    reply.raw.statusCode = 404;
    reply.raw.end("Not found");
  });
});
await app.listen({ port: Number(process.env.PORT || 3000), host: "127.0.0.1" });
console.log("Katha → http://localhost:" + (process.env.PORT || 3000));
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    await vite.close();
    katha.close();
    await embedder?.close();
    process.exit(0);
  });
