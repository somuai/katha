import test from "node:test";
import assert from "node:assert/strict";
import { createProviders } from "../src/providers/index.ts";

test("missing credentials fail explicitly, never fabricate an answer", async () => {
  const p = createProviders({});
  await assert.rejects(() => p.answer({ question: "Today?" }), /GROQ_API_KEY/);
});
test("web search isolates partial failure and caps parallelism", async () => {
  let active = 0,
    max = 0;
  const p = createProviders({
    tavilyKey: "test",
    fetcher: (async (_url, init) => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      const q = JSON.parse(String(init?.body)).query;
      return new Response(
        JSON.stringify(
          q === "fail"
            ? { error: "failed" }
            : {
                results: [
                  {
                    url: "https://vendor.example/pricing",
                    title: "pricing",
                    raw_content: "$20 monthly",
                  },
                ],
              },
        ),
        { status: q === "fail" ? 500 : 200 },
      );
    }) as typeof fetch,
  });
  const r = await p.search([
    { query: "one" },
    { query: "two" },
    { query: "fail" },
    { query: "three" },
  ]);
  assert.ok(max <= 3);
  assert.equal(r.length, 4);
  assert.equal(r[2].evidence.length, 0);
  assert.ok(r[2].error);
  assert.equal(r[0].evidence[0].url, "https://vendor.example/pricing");
});
test("answer rejects invented citation identifiers", async () => {
  const p = createProviders({
    groqKey: "test",
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "Claim",
                  citations: ["invented"],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      )) as typeof fetch,
  });
  await assert.rejects(
    () => p.answer({ question: "What changed?", evidence: [] }),
    /citation/,
  );
});
test("cached results retain observation time and explicit refresh bypasses cache", async () => {
  let calls = 0,
    time = 1000;
  const p = createProviders({
    tavilyKey: "test",
    clock: () => time,
    fetcher: (async () => {
      calls++;
      return new Response(
        JSON.stringify({
          results: [{ url: "https://example.com", content: "current" }],
        }),
      );
    }) as typeof fetch,
  });
  const q = [{ query: "pricing" }];
  const first = await p.search(q);
  time = 2000;
  const cached = await p.search(q);
  assert.equal(calls, 1);
  assert.equal(
    cached[0].evidence[0].observedAt,
    first[0].evidence[0].observedAt,
  );
  await p.search(q, undefined, true);
  assert.equal(calls, 2);
});

test("text ingestion preserves exact original content and rejects binary or invalid JSON", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const providers = createProviders({});
  const text = "Meeting on 3 November\nShortlist: Attio, Close";
  const bytes = new TextEncoder().encode(text);
  const parsed = await extractAttachment(bytes, "notes.md", "text/markdown", {
    providers,
  });
  assert.equal(parsed.content, text);
  assert.equal(parsed.method, "utf8-text");
  await assert.rejects(
    () =>
      extractAttachment(new Uint8Array([0, 1, 2]), "bad.txt", "text/plain", {
        providers,
      }),
    /Binary/,
  );
  await assert.rejects(
    () =>
      extractAttachment(
        new TextEncoder().encode("{no"),
        "bad.json",
        "application/json",
        { providers },
      ),
    /JSON/,
  );
});
test("unsupported uploads and oversized documents fail before remote processing", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const providers = createProviders({});
  await assert.rejects(
    () =>
      extractAttachment(
        new Uint8Array([1]),
        "program.exe",
        "application/octet-stream",
        { providers },
      ),
    /Supported files/,
  );
  await assert.rejects(
    () =>
      extractAttachment(
        new Uint8Array(5 * 1024 * 1024 + 1),
        "long.txt",
        "text/plain",
        { providers },
      ),
    /size/,
  );
});

test("image ingestion normalizes a real image and labels its model-derived text", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const { default: sharp } = await import("sharp");
  const image = await sharp({
    create: { width: 32, height: 24, channels: 3, background: "#345678" },
  })
    .png()
    .toBuffer();
  const providers = createProviders({
    groqKey: "test",
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ text: "A plain blue rectangle." }),
              },
            },
          ],
        }),
      )) as typeof fetch,
  });
  const result = await extractAttachment(image, "test.png", "image/png", {
    providers,
  });
  assert.equal(result.method, "model-image-description");
  assert.equal(result.content, "A plain blue rectangle.");
  assert.ok(result.warnings.length > 0);
});

test("a scanned PDF page uses explicit visual interpretation rather than silently losing the page", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << >> >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const providers = createProviders({
    groqKey: "test",
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "No visible text on this blank page.",
                }),
              },
            },
          ],
        }),
      )) as typeof fetch,
  });
  const result = await extractAttachment(
    Buffer.from(pdf),
    "scanned.pdf",
    "application/pdf",
    { providers },
  );
  assert.equal(result.method, "pdf-text-and-vision");
  assert.match(result.content, /Page 1/);
  assert.match(result.content, /Model interpretation/);
  assert.equal(result.pages, 1);
});

test("core adapter uses the explicitly selected historical baseline rather than recent chat history", async () => {
  const { createKathaAdapters } = await import("../src/providers/index.ts");
  let body: any;
  const { model } = createKathaAdapters({
    groqKey: "test",
    fetcher: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: "No changes verified.",
                  citations: [],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const base = {
    kind: "message" as const,
    role: "user" as const,
    conversationId: null,
    turnId: null,
    recordedAt: "2026-11-03T00:00:00Z",
    occurredAt: null,
    occurredEnd: null,
    dateProvenance: "recorded",
    version: 1,
    deletedAt: null,
    invalidated: false,
    metadata: {},
  };
  await model.generate({
    question: "What changed?",
    verification: true,
    signal: new AbortController().signal,
    history: [
      {
        ...base,
        id: "recent",
        title: "Recent",
        content: "Unrelated recent text",
      },
    ],
    baseline: [
      {
        ...base,
        id: "old",
        title: "Old baseline",
        content: "The November shortlist",
      },
    ],
    evidence: [],
  });
  const input = JSON.parse(body.messages[1].content);
  assert.equal(input.baseline[0].id, "old");
  assert.equal(input.history, undefined);
});

test("a valid photo is not rejected because base64 bytes are counted as text tokens", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const { default: sharp } = await import("sharp");
  const { randomBytes } = await import("node:crypto");
  const image = await sharp(randomBytes(300 * 300 * 3), {
    raw: { width: 300, height: 300, channels: 3 },
  })
    .png()
    .toBuffer();
  const providers = createProviders({
    groqKey: "fixture",
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ text: "A patterned test image." }),
              },
            },
          ],
        }),
      )) as typeof fetch,
  });
  const result = await extractAttachment(image, "photo.png", "image/png", {
    providers,
  });
  assert.equal(result.content, "A patterned test image.");
});

test("search exposes query-relevant passages instead of navigation-heavy raw page prefixes", async () => {
  const provider = createProviders({
    tavilyKey: "fixture",
    fetcher: (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "SQLite WAL",
              url: "https://sqlite.org/wal.html",
              content:
                "WAL permits readers and a writer to proceed concurrently.",
              raw_content:
                "Navigation menu. ".repeat(2000) +
                "WAL permits readers and a writer to proceed concurrently.",
            },
          ],
        }),
      )) as typeof fetch,
  });
  const result = await provider.search([{ query: "WAL readers writers" }]);
  assert.equal(
    result[0].evidence[0].text,
    "WAL permits readers and a writer to proceed concurrently.",
  );
});

test("current answer projection retains the effective correction even when the original is long", async () => {
  const { createKathaAdapters } = await import("../src/providers/index.ts");
  const { model } = createKathaAdapters({
    groqKey: "fixture",
    fetcher: (async (_url, init) => {
      const request = JSON.parse(String(init?.body)),
        context = JSON.parse(request.messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: context.baseline[0].text,
                  citations: ["s"],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const s = {
    id: "s",
    kind: "attachment" as const,
    role: "document" as const,
    conversationId: null,
    turnId: null,
    title: "Quota",
    content: "The quota is five. ".repeat(60),
    interpretation: "The quota is eight.",
    interpretationSourceIds: ["correction"],
    recordedAt: "2026-11-03T00:00:00Z",
    occurredAt: null,
    occurredEnd: null,
    dateProvenance: "recorded",
    version: 1,
    deletedAt: null,
    invalidated: false,
    metadata: {},
  };
  const result = await model.generate({
    question: "What is the quota?",
    history: [],
    baseline: [s],
    evidence: [s],
    verification: false,
    signal: new AbortController().signal,
  });
  assert.match(result.answer, /quota is eight/);
  assert.doesNotMatch(result.answer, /quota is five/);
});
