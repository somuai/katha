import { createRequire } from "node:module";
import sharp from "sharp";
import { createWorker, PSM, type Worker } from "tesseract.js";

// One bounded local job at a time. Packaged English data means no runtime CDN
// download and no document transmission for OCR. Workers always terminate.
let tail = Promise.resolve();
let pending = 0;
export async function readLocalText(bytes: Uint8Array, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const image = sharp(bytes, { limitInputPixels: 20_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" });
  const metadata = await image.metadata();
  if ((metadata.width || 0) * (metadata.height || 0) < 100_000)
    return undefined;
  const stats = await image.stats();
  if (stats.channels.every((c) => c.stdev < 3)) return undefined;
  if (pending >= 4)
    throw Error("Local OCR is busy; use the retained original or retry.");
  pending++;
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let worker: Worker | undefined;
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let abort!: () => void;
  try {
    combined.throwIfAborted();
    const task = (async () => {
      const language = createRequire(import.meta.url)("@tesseract.js-data/eng");
      worker = await createWorker("eng", 1, {
        langPath: language.langPath,
        gzip: true,
        cacheMethod: "none",
      });
      if (combined.aborted) {
        await worker.terminate();
        combined.throwIfAborted();
      }
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "1",
      });
      const prepared = await image
        .resize({
          width: 2400,
          height: 3600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .greyscale()
        .normalize({ lower: 0, upper: 100 })
        .clahe({ width: 128, height: 128, maxSlope: 3 })
        .sharpen()
        .png()
        .toBuffer();
      const fragmentation = (text: string) => {
        const lines = text
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        return lines.length < 8
          ? 0
          : lines.filter((s) => s.length < 12).length / lines.length;
      };
      let { data } = await worker.recognize(prepared, { rotateAuto: true });
      const fragmented = fragmentation(data.text) > 0.35;
      if (!data.text.trim() || data.confidence < 60 || fragmented) {
        await worker.setParameters({
          tessedit_pageseg_mode: fragmented
            ? PSM.SINGLE_BLOCK
            : PSM.SPARSE_TEXT,
        });
        const retry = (await worker.recognize(prepared, { rotateAuto: true }))
          .data;
        if (
          retry.text.trim() &&
          (!data.text.trim() ||
            retry.confidence >= data.confidence ||
            (fragmented &&
              retry.confidence >= 60 &&
              retry.text.replace(/\s/g, "").length >=
                data.text.replace(/\s/g, "").length * 0.7 &&
              fragmentation(retry.text) < fragmentation(data.text)))
        )
          data = retry;
      }
      return data.text.trim()
        ? {
            text: data.text.trim().slice(0, 100_000),
            usable: data.confidence >= 60,
          }
        : undefined;
    })();
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        abort = () => reject(combined.reason);
        combined.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (abort) combined.removeEventListener("abort", abort);
    await worker?.terminate().catch(() => undefined);
    pending--;
    release();
  }
}
