import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import type { Embedder } from "../core/types.ts";
export type EmbeddedSegment = {
  text: string;
  startToken: number;
  endToken: number;
  vector: number[];
};
export function createLocalEmbedder(cacheDirectory?: string): Embedder & {
  segment(text: string): Promise<EmbeddedSegment[]>;
  close(): Promise<void>;
} {
  let worker: Worker | undefined;
  const pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function get() {
    if (worker) return worker;
    worker = new Worker(new URL("./embedding-worker.mjs", import.meta.url), {
      workerData: { cacheDirectory },
    });
    worker.unref();
    worker.on("message", ({ id, vector, segments, error }) => {
      const request = pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(id);
      error
        ? request.reject(new Error(error))
        : request.resolve(segments || vector);
    });
    worker.on("error", (error) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      pending.clear();
      worker = undefined;
    });
    return worker;
  }
  function request<T>(text: string, mode: "segments" | "vector"): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              "Embedding initialization or processing timed out. Lexical recall remains available.",
            ),
          );
        }, 180000);
      pending.set(id, { resolve, reject, timer });
      get().postMessage({ id, text, mode });
    });
  }
  return {
    modelId: "Xenova/all-MiniLM-L6-v2:q8:384:chunks192-overlap32",
    embed: (text) => request<number[]>(text, "vector"),
    segment: (text) => request<EmbeddedSegment[]>(text, "segments"),
    async close() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Embedding worker closed"));
      }
      pending.clear();
      await worker?.terminate();
      worker = undefined;
    },
  };
}
