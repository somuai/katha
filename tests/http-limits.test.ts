import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerHttpLimits } from "../src/http-limits.ts";

test("costly submissions are limited before handlers while recovery routes remain usable", async () => {
  let time = 0,
    dispatched = 0;
  const app = Fastify();
  registerHttpLimits(app, { clock: () => time });
  app.post("/api/conversations/:id/turns", async () => {
    dispatched++;
    return { accepted: true };
  });
  app.post("/api/turns/:id/cancel", async () => ({ cancelled: true }));
  app.get("/api/turns/:id/events", async (_, reply) =>
    reply.type("text/event-stream").send("data: ready\n\n"),
  );
  app.get("/api/workspace", async () => ({ available: true }));
  try {
    for (let i = 0; i < 30; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/conversations/chat${i}/turns`,
          })
        ).statusCode,
        200,
      );
    const blocked = await app.inject({
      method: "POST",
      url: "/api/conversations/another/turns",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.headers["retry-after"], "60");
    assert.equal(blocked.json().code, "INGRESS_RATE_LIMIT");
    assert.equal(dispatched, 30);
    for (const url of ["/api/workspace", "/api/turns/one/events"])
      assert.equal((await app.inject({ url })).statusCode, 200);
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/turns/one/cancel" }))
        .statusCode,
      200,
    );
    time = 60000;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/conversations/chat/turns",
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});

test("upload quota is per client, separate from turns, and bounds tracked clients", async () => {
  let time = 0,
    uploads = 0;
  const app = Fastify();
  registerHttpLimits(app, { clock: () => time, maxKeys: 2 });
  app.post("/api/sources", async () => {
    uploads++;
    return { accepted: true };
  });
  app.post("/api/conversations/:id/turns", async () => ({ accepted: true }));
  try {
    for (let i = 0; i < 12; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/sources",
            remoteAddress: "127.0.0.1",
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources?ignored=yes",
          remoteAddress: "127.0.0.1",
        })
      ).statusCode,
      429,
    );
    assert.equal(uploads, 12);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/conversations/one/turns",
          remoteAddress: "127.0.0.1",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          remoteAddress: "127.0.0.2",
        })
      ).statusCode,
      429,
    );
    time = 60000;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/sources",
          remoteAddress: "127.0.0.2",
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});
