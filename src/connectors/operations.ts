/** Local workspace limits. Success-only short cache; no imported-source receipt cache. */
export class ConnectionLimitError extends Error {
  code = "CONNECTION_RATE_LIMIT";
  status = 429;
  constructor(public retryAfter: number) {
    super(`Too many connection requests. Try again in ${retryAfter} seconds.`);
  }
}
export function createConnectionOperations(clock = Date.now) {
  const windows = new Map<string, { started: number; count: number }>();
  const cache = new Map<string, { expires: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  const versions = new Map<string, number>();
  return {
    limit(key: string, maximum: number, windowMs = 60000) {
      const now = clock();
      let entry = windows.get(key);
      if (!entry || now - entry.started >= windowMs) {
        entry = { started: now, count: 0 };
        windows.set(key, entry);
      }
      if (entry.count >= maximum)
        throw new ConnectionLimitError(
          Math.max(1, Math.ceil((entry.started + windowMs - now) / 1000)),
        );
      entry.count++;
    },
    async cached<T>(
      scope: string,
      key: string,
      load: () => Promise<T>,
    ): Promise<T> {
      const version = versions.get(scope) || 0;
      const id = JSON.stringify([scope, version, key]);
      const entry = cache.get(id);
      if (entry && entry.expires > clock())
        return structuredClone(entry.value) as T;
      const active = pending.get(id);
      if (active) return structuredClone(await active) as T;
      const job = load();
      pending.set(id, job);
      try {
        const value = await job;
        if ((versions.get(scope) || 0) === version) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(id, {
            value: structuredClone(value),
            expires: clock() + 30000,
          });
        }
        return value;
      } finally {
        pending.delete(id);
      }
    },
    invalidate(scope: string) {
      versions.set(scope, (versions.get(scope) || 0) + 1);
      for (const key of cache.keys())
        if (JSON.parse(key)[0] === scope) cache.delete(key);
    },
  };
}
