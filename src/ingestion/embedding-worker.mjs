import { parentPort, workerData } from "node:worker_threads";
let pipelinePromise;
const getPipeline = () =>
  (pipelinePromise ||= import("@huggingface/transformers").then(
    async ({ pipeline, env }) => {
      if (workerData.cacheDirectory) env.cacheDir = workerData.cacheDirectory;
      return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "q8",
      });
    },
  ));
let tail = Promise.resolve();
parentPort.on("message", (message) => {
  tail = tail.then(async () => {
    try {
      const pipe = await getPipeline(),
        tokens = pipe.tokenizer.encode(message.text, {
          add_special_tokens: false,
        }),
        segments = [];
      for (let at = 0; at < Math.max(tokens.length, 1); at += 160) {
        const endToken = Math.min(tokens.length, at + 192),
          text = pipe.tokenizer.decode(tokens.slice(at, endToken), {
            skip_special_tokens: true,
          });
        const out = await pipe(text, { pooling: "mean", normalize: true });
        segments.push({
          text,
          startToken: at,
          endToken,
          vector: Array.from(out.data),
        });
        if (endToken === tokens.length) break;
      }
      if (message.mode === "segments") {
        parentPort.postMessage({ id: message.id, segments });
        return;
      }
      const mean = segments[0].vector.map(
          (_, i) =>
            segments.reduce((sum, s) => sum + s.vector[i], 0) / segments.length,
        ),
        norm = Math.hypot(...mean) || 1;
      parentPort.postMessage({
        id: message.id,
        vector: mean.map((n) => n / norm),
      });
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: error.message });
    }
  });
});
