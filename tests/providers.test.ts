import test from "node:test";
import assert from "node:assert/strict";
import { createProviders } from "../src/providers/index.ts";
test("structured extraction selects model-supported reasoning controls and never returns reasoning text", async () => {
  for (const model of ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]) {
    let request: any;
    const p = createProviders({
      groqKey: "test",
      model,
      fetcher: (async (_url, init) => {
        request = JSON.parse(String(init?.body));
        return Response.json({
          choices: [
            {
              message: {
                reasoning: "private reasoning",
                content: JSON.stringify({
                  text: "Answer",
                  citations: [],
                  comparisons: [],
                }),
              },
            },
          ],
        });
      }) as typeof fetch,
    });
    const answer = await p.answer({ question: "A question" });
    assert.equal(
      request.reasoning_effort,
      model.startsWith("qwen") ? "none" : "low",
    );
    assert.equal(
      request.reasoning_format,
      model.startsWith("qwen") ? "hidden" : undefined,
    );
    assert.equal(JSON.stringify(answer).includes("private reasoning"), false);
  }
});
test("incomplete price extraction gets one bounded repair rather than invented terms", async () => {
  let calls = 0,
    time = 1000;
  const terms = (amount: number) => ({
    plan: "Core",
    amount,
    currency: "USD",
    region: "US",
    cadence: "month",
    seats: 20,
    basis: "per_seat",
    limits: "unlimited contacts",
    tax: "excluded",
    sourceQuote: `USD ${amount} per seat per month, US, 20 seats, unlimited contacts, tax excluded.`,
  });
  const p = createProviders({
    groqKey: "test",
    clock: () => time,
    fetcher: (async () => {
      calls++;
      time += 2000;
      if (calls === 2)
        return Response.json(
          { error: { message: "Temporary quota" } },
          { status: 429, headers: { "Retry-After": "1" } },
        );
      const comparison = {
        claim: "Vendor price",
        status: "DIFFERS_CHANGE_TIME_UNKNOWN",
        explanation: "Amounts differ.",
        baselineSourceIds: ["b"],
        evidenceIds: ["c"],
        baselinePrice: terms(20),
        ...(calls > 1 ? { currentPrice: terms(25) } : {}),
      };
      return Response.json({
        usage: { total_tokens: 100 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Compared",
                citations: ["b", "c"],
                comparisons: [comparison],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  const input = {
    question: "Has Vendor price changed?",
    baseline: [
      {
        id: "b",
        title: "Old",
        text: terms(20).sourceQuote,
        observedAt: "2026-11-09",
      },
    ],
    evidence: [
      {
        id: "c",
        title: "New",
        text: terms(25).sourceQuote,
        observedAt: "2026-11-13",
      },
    ],
  };
  await assert.rejects(p.answer(input), { code: "RATE_LIMIT" });
  time += 60000;
  const answer = await p.answer(input);
  assert.equal(calls, 3);
  assert.equal(answer.comparisons[0].currentPrice?.amount, 25);
});
test("per-vendor comparison retains completed work across a quota retry", async () => {
  let time = 1000;
  const questions: string[] = [];
  const p = createProviders({
    groqKey: "test",
    clock: () => time,
    fetcher: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const question = JSON.parse(body.messages[1].content).question;
      questions.push(question);
      time += 2000;
      if (questions.length === 2)
        return Response.json(
          { error: { message: "Temporary capacity" } },
          { status: 429, headers: { "Retry-After": "1" } },
        );
      return Response.json({
        usage: { total_tokens: 100 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: question.includes("ONLY Alder")
                  ? "Alder checked"
                  : "Birch checked",
                citations: [],
                comparisons: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  const input = {
    question: "We shortlisted Alder and Birch. Has anything changed?",
    evidence: ["Alder", "Birch"].map((title) => ({
      id: title,
      title,
      text: `${title} current evidence`,
      observedAt: "2026-11-13",
    })),
  };
  await assert.rejects(p.answer(input), { code: "RATE_LIMIT" });
  time += 60000;
  const answer = await p.answer(input);
  assert.equal(questions.length, 3);
  assert.ok(questions[0].includes("ONLY Alder"));
  assert.ok(
    questions[1].includes("ONLY Birch") && questions[2].includes("ONLY Birch"),
  );
  assert.match(answer.text, /Alder checked/);
  assert.match(answer.text, /Birch checked/);
});
test("a request that exceeds the provider's fixed allowance fails without a futile quota wait", async () => {
  const p = createProviders({
    groqKey: "test",
    fetcher: (async () =>
      Response.json(
        {
          error: {
            message:
              "Request too large on output tokens per minute. The request's expected output tokens exceed the enforced limit.",
          },
        },
        { status: 429 },
      )) as typeof fetch,
  });
  await assert.rejects(p.answer({ question: "Compare offers" }), {
    code: "CONTEXT_LIMIT",
  });
});
test("answer context distributes evidence across vendor queries instead of first-page order", async () => {
  let selected: any[] = [];
  const p = createProviders({
    groqKey: "test",
    fetcher: (async (_url, init) => {
      selected = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      ).evidence;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Unverified",
                citations: [],
                comparisons: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  await p.answer({
    question: "Compare five vendors",
    evidence: Array.from({ length: 5 }, (_, vendor) =>
      Array.from({ length: 3 }, (_, page) => ({
        id: `${vendor}-${page}`,
        query: `vendor${vendor}`,
        title: "Page",
        text: "Evidence",
        observedAt: "2026-11-13",
      })),
    ).flat(),
  });
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((e) => e.query)).size, 5);
});
test("shortlist answers reserve enough output for per-vendor comparisons", async () => {
  let budget = 0;
  const p = createProviders({
    groqKey: "test",
    fetcher: (async (_url, init) => {
      budget = JSON.parse(String(init?.body)).max_tokens;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Unverified",
                citations: [],
                comparisons: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  await p.answer({
    question: "We shortlisted five CRM tools. Has pricing changed?",
  });
  assert.equal(budget, 1000);
});

test("model context grounds Monday on the current turn rather than older history", async () => {
  let resolved: any;
  const p = createProviders({
    groqKey: "test",
    fetcher: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      resolved = JSON.parse(body.messages[1].content).resolvedQuestionDate;
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Recorded.",
                citations: [],
                comparisons: [],
              }),
            },
          },
        ],
      });
    }) as typeof fetch,
  });
  await p.answer({
    question: "On Monday we shortlisted five CRM tools.",
    now: "2026-11-09T10:00:00Z",
    timezone: "UTC",
    history: "Earlier discussion from 2026-11-02",
  });
  assert.equal(resolved.date, "2026-11-09");
});

test("malformed comparison cannot crash or publish unvalidated price prose", async () => {
  const p = createProviders({
    groqKey: "test",
    fetcher: (async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: "Price definitely doubled",
                citations: [],
                comparisons: [
                  {
                    claim: "CRM pricing",
                    status: "CHANGED",
                    explanation: null,
                  },
                ],
              }),
            },
          },
        ],
      })) as typeof fetch,
  });
  const answer = await p.answer({ question: "Has CRM pricing changed?" });
  assert.equal(answer.comparisons[0].status, "UNVERIFIED");
  assert.doesNotMatch(answer.text, /definitely doubled/);
  assert.match(answer.text, /could not validate/i);
});

test("transcription bounds requests per minute and recovers without dispatching rejected audio", async () => {
  let time = 1000,
    calls = 0;
  const p = createProviders({
    groqKey: "test",
    clock: () => time,
    fetcher: (async () => {
      calls++;
      return Response.json({ text: "Editable transcript" });
    }) as typeof fetch,
  });
  for (let i = 0; i < 6; i++)
    assert.equal(
      await p.transcribe(new Uint8Array([1]), "audio/webm"),
      "Editable transcript",
    );
  await assert.rejects(
    p.transcribe(new Uint8Array([1]), "audio/webm"),
    (e: any) =>
      e.code === "RATE_LIMIT" && e.status === 429 && e.retryAfter === 60,
  );
  assert.equal(calls, 6);
  time += 60000;
  assert.equal(
    await p.transcribe(new Uint8Array([1]), "audio/webm"),
    "Editable transcript",
  );
  assert.equal(calls, 7);
});

test("transcription respects provider cooldown and does not retry early", async () => {
  let time = 1000,
    calls = 0;
  const p = createProviders({
    groqKey: "test",
    clock: () => time,
    fetcher: (async () => {
      calls++;
      return calls === 1
        ? new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "30" },
          })
        : Response.json({ text: "Recovered" });
    }) as typeof fetch,
  });
  await assert.rejects(
    p.transcribe(new Uint8Array([1]), "audio/webm"),
    (e: any) => e.code === "RATE_LIMIT" && e.retryAfter === 30,
  );
  await assert.rejects(
    p.transcribe(new Uint8Array([1]), "audio/webm"),
    (e: any) => e.code === "RATE_LIMIT",
  );
  assert.equal(calls, 1);
  time += 30000;
  assert.equal(
    await p.transcribe(new Uint8Array([1]), "audio/webm"),
    "Recovered",
  );
});

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

test("a large CSV answer receives a complete integer aggregate and the requested late row", async () => {
  const { createKathaAdapters } = await import("../src/providers/index.ts");
  const { model } = createKathaAdapters({
    groqKey: "fixture",
    fetcher: (async (_url, init) => {
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: context.baseline[0].csvSummary,
                  citations: ["csv"],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const content =
    "name,amount\n" +
    Array.from({ length: 100 }, (_, i) => `Customer${i + 1},${i + 1}`).join(
      "\n",
    );
  const source = {
    id: "csv",
    kind: "attachment" as const,
    role: "document" as const,
    conversationId: null,
    turnId: null,
    title: "large.csv",
    content,
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
    question: "What is the amount for Customer100 and sum of all amounts?",
    history: [],
    baseline: [source],
    evidence: [source],
    verification: false,
    signal: new AbortController().signal,
  });
  assert.match(result.answer, /sum 5050/);
  assert.match(result.answer, /Customer100.*amount=100/);
});

test("a large CSV follow-up receives complete counts for low-cardinality attendance values", async () => {
  const { createKathaAdapters } = await import("../src/providers/index.ts");
  const { model } = createKathaAdapters({
    groqKey: "fixture",
    fetcher: (async (_url, init) => {
      const context = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: context.baseline[0].csvSummary,
                  citations: ["csv"],
                  comparisons: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const content =
    "name,attendance_monday\n" +
    Array.from(
      { length: 100 },
      (_, i) => `Person${i + 1},${i < 63 ? "present" : "absent"}`,
    ).join("\n");
  const source = {
    id: "csv",
    kind: "attachment" as const,
    role: "document" as const,
    conversationId: null,
    turnId: null,
    title: "attendance.csv",
    content,
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
    question: "How many were present and absent on Monday?",
    history: [],
    baseline: [source],
    evidence: [source],
    verification: false,
    signal: new AbortController().signal,
  });
  assert.match(result.answer, /present.*63/);
  assert.match(result.answer, /absent.*37/);
});

test("transparent diagrams retain a light readable background during image normalization", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const { default: sharp } = await import("sharp");
  const image = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
  const providers = createProviders({
    groqKey: "fixture",
    fetcher: (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      const url = request.messages[1].content[0].image_url.url;
      const stats = await sharp(
        Buffer.from(url.split(",")[1], "base64"),
      ).stats();
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  text: stats.channels.every((c) => c.mean > 245)
                    ? "Light background"
                    : "Dark background",
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch,
  });
  const extracted = await extractAttachment(image, "diagram.png", "image/png", {
    providers,
  });
  assert.equal(extracted.content, "Light background");
});

test("a short text PDF is extracted without requiring a vision provider", async () => {
  const { extractAttachment } = await import("../src/ingestion/index.ts");
  const stream = "BT /F1 12 Tf 20 100 Td (USD 20) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n ")
    .join(
      "\n",
    )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const result = await extractAttachment(
    Buffer.from(pdf),
    "short.pdf",
    "application/pdf",
    { providers: createProviders({}) },
  );
  assert.equal(result.method, "pdf-text-extraction");
  assert.match(result.content, /USD 20/);
});

test("fresh searches bypass cache without excluding older source pages", async () => {
  const bodies: any[] = [];
  const p = createProviders({
    tavilyKey: "test",
    fetcher: (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          results: [
            { url: "https://example.com", content: "Older official pricing" },
          ],
        }),
      );
    }) as typeof fetch,
  });
  await p.search([{ query: "pricing" }]);
  const current = await p.search([{ query: "pricing" }], undefined, true);
  assert.equal(bodies.length, 2);
  assert.equal("max_age_hours" in bodies[1], false);
  assert.equal(current[0].evidence[0].text, "Older official pricing");
});
test("provider rate limiting reports retry-after without an early retry", async () => {
  let calls = 0;
  const p = createProviders({
    tavilyKey: "test",
    fetcher: (async () => {
      calls++;
      return new Response("slow down", {
        status: 429,
        headers: { "Retry-After": "30" },
      });
    }) as typeof fetch,
  });
  const result = await p.search([{ query: "pricing" }]);
  assert.equal(calls, 1);
  assert.match(result[0].error!, /retry after 30/i);
});
