import test from "node:test";
import assert from "node:assert/strict";
import { createConnectionOperations } from "../src/connectors/operations.ts";
test("connection limits report retry delay and recover after the window", () => {
  let now = 0;
  const ops = createConnectionOperations(() => now);
  ops.limit("gmail:browse", 1);
  assert.throws(() => ops.limit("gmail:browse", 1), {
    status: 429,
    retryAfter: 60,
  });
  ops.limit("hubspot:browse", 1);
  now = 60000;
  ops.limit("gmail:browse", 1);
});
test("cached selections coalesce, expire, invalidate and never cache failures", async () => {
  let now = 0,
    calls = 0;
  const ops = createConnectionOperations(() => now);
  const load = async () => ({ value: ++calls });
  assert.deepEqual(
    await Promise.all([
      ops.cached("gmail", "q", load),
      ops.cached("gmail", "q", load),
    ]),
    [{ value: 1 }, { value: 1 }],
  );
  now = 30001;
  assert.deepEqual(await ops.cached("gmail", "q", load), { value: 2 });
  ops.invalidate("gmail");
  assert.deepEqual(await ops.cached("gmail", "q", load), { value: 3 });
  await assert.rejects(
    ops.cached("gmail", "fail", async () => {
      throw Error("down");
    }),
  );
  assert.deepEqual(await ops.cached("gmail", "fail", load), { value: 4 });
});
test("disconnect during an in-flight list prevents cache resurrection", async () => {
  const ops = createConnectionOperations();
  let resolve!: (v: string) => void;
  const first = ops.cached(
    "gmail",
    "q",
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  ops.invalidate("gmail");
  resolve("old selection");
  await first;
  assert.equal(
    await ops.cached("gmail", "q", async () => "new selection"),
    "new selection",
  );
});
