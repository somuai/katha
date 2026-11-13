import type { FastifyInstance } from "fastify";

/** Single-process admission limits for the local workspace, not user authentication. */
export function registerHttpLimits(
  app: FastifyInstance,
  options: { clock?: () => number; maxKeys?: number } = {},
) {
  const clock = options.clock || Date.now;
  const maxKeys = Math.max(1, Math.min(options.maxKeys || 1024, 1024));
  const windows = new Map<string, { started: number; count: number }>();
  app.addHook("onRequest", async (req, reply) => {
    if (req.method !== "POST") return;
    const path = req.url.split("?", 1)[0];
    const bucket =
      path === "/api/sources"
        ? "upload"
        : /^\/api\/conversations\/[^/]+\/turns$/.test(path)
          ? "turn"
          : undefined;
    if (!bucket) return;
    const now = clock();
    for (const [key, entry] of windows)
      if (now - entry.started >= 60000) windows.delete(key);
    // Fastify's default trustProxy=false keeps a supplied forwarding header
    // from creating arbitrary buckets. All conversations share a client quota.
    const key = `${req.ip}:${bucket}`;
    let entry = windows.get(key);
    const maximum = bucket === "upload" ? 12 : 30;
    if (
      (!entry && windows.size >= maxKeys) ||
      (entry && entry.count >= maximum)
    ) {
      const resetAt = entry
        ? entry.started + 60000
        : Math.min(
            ...[...windows.values()].map((value) => value.started + 60000),
          );
      return reply
        .code(429)
        .header("Retry-After", Math.max(1, Math.ceil((resetAt - now) / 1000)))
        .send({
          code: "INGRESS_RATE_LIMIT",
          error:
            "Too many submissions. Wait before sending again; you can still read or stop existing turns.",
        });
    }
    if (!entry) {
      entry = { started: now, count: 0 };
      windows.set(key, entry);
    }
    entry.count++;
  });
}
