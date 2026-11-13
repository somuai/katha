import { parse } from "csv-parse/sync";
import { ProviderError, type Providers } from "../providers/index.ts";
export type ExtractedAttachment = {
  content: string;
  mimeType: string;
  method: string;
  pages?: number;
  warnings: string[];
};
const DOC_LIMIT = 5 * 1024 * 1024,
  MEDIA_LIMIT = 10 * 1024 * 1024;
export async function extractAttachment(
  bytes: Uint8Array,
  name: string,
  mime: string,
  options: { providers: Providers; signal?: AbortSignal },
): Promise<ExtractedAttachment> {
  const ext = name.toLowerCase().split(".").at(-1) || "",
    base = mime.split(";")[0].toLowerCase();
  if (
    bytes.length >
    (base.startsWith("image/") || base.startsWith("audio/")
      ? MEDIA_LIMIT
      : DOC_LIMIT)
  )
    throw new ProviderError(
      "UPLOAD_LIMIT",
      "Attachment exceeds its permitted size.",
    );
  if (base.startsWith("image/")) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(base))
      throw new ProviderError("UNSUPPORTED_FILE", "Use PNG, JPEG or WebP.");
    const { default: sharp } = await import("sharp");
    const image = sharp(bytes, { limitInputPixels: 20_000_000 });
    const normalized = await image
      .rotate()
      .resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    const content = await options.providers.describeImage(
      normalized,
      "image/jpeg",
      options.signal,
    );
    return {
      content,
      mimeType: base,
      method: "model-image-description",
      warnings: [
        "Description is derived from the image. Review uncertain text against the original.",
      ],
    };
  }
  if (base.startsWith("audio/")) {
    if (
      ![
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/aac",
      ].includes(base)
    )
      throw new ProviderError("UNSUPPORTED_FILE", "Unsupported audio format.");
    const content = await options.providers.transcribe(
      bytes,
      base,
      options.signal,
    );
    if (!content)
      throw new ProviderError("EMPTY_FILE", "No speech was transcribed.");
    return {
      content,
      mimeType: base,
      method: "whisper-transcript",
      warnings: [
        "Transcription is derived text; review before using it as evidence.",
      ],
    };
  }
  const buffer = Buffer.from(bytes);
  if (ext === "pdf" || base === "application/pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      throw new ProviderError(
        "UNSUPPORTED_FILE",
        "The file is not a valid PDF.",
      );
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    const document = await task.promise;
    try {
      if (document.numPages > 50)
        throw new ProviderError(
          "UPLOAD_LIMIT",
          "PDFs are limited to 50 pages.",
        );
      const pages: string[] = [];
      let interpreted = 0;
      for (let n = 1; n <= document.numPages; n++) {
        options.signal?.throwIfAborted();
        const page = await document.getPage(n),
          text = await page.getTextContent();
        let content = text.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        if (!content.trim()) {
          const { createCanvas } = await import("@napi-rs/canvas");
          const natural = page.getViewport({ scale: 1 }),
            scale = Math.min(2, 1536 / Math.max(natural.width, natural.height));
          const viewport = page.getViewport({ scale }),
            canvas = createCanvas(
              Math.ceil(viewport.width),
              Math.ceil(viewport.height),
            );
          await page.render({
            canvas: canvas as never,
            canvasContext: canvas.getContext("2d") as never,
            viewport,
          }).promise;
          content =
            "[Model interpretation of scanned page] " +
            (await options.providers.describeImage(
              canvas.toBuffer("image/png"),
              "image/png",
              options.signal,
            ));
          interpreted++;
        }
        pages.push(`[Page ${n}]\n${content}`);
        page.cleanup();
      }
      return {
        content: pages.join("\n\n"),
        mimeType: "application/pdf",
        method: interpreted ? "pdf-text-and-vision" : "pdf-text-extraction",
        pages: document.numPages,
        warnings: interpreted
          ? [
              `${interpreted} page(s) were visually interpreted by the model. Check uncertain text against the original.`,
            ]
          : [],
      };
    } finally {
      await task.destroy();
    }
  }
  if (!["txt", "md", "markdown", "csv", "json"].includes(ext))
    throw new ProviderError(
      "UNSUPPORTED_FILE",
      "Supported files: TXT, Markdown, CSV, JSON, PDF, images and audio.",
    );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (text.includes("\0"))
    throw new ProviderError(
      "UNSUPPORTED_FILE",
      "Binary content is not a text document.",
    );
  const warnings: string[] = [];
  if (ext === "csv") {
    let rows: string[][];
    try {
      rows = parse(text, {
        skip_empty_lines: true,
        relax_column_count: false,
        bom: true,
      });
    } catch {
      throw new ProviderError(
        "INVALID_FILE",
        "The CSV has malformed quoting or inconsistent column counts. Correct the file and upload it again.",
      );
    }
    if (rows.length > 100001 || (rows[0]?.length || 0) > 100)
      throw new ProviderError(
        "UPLOAD_LIMIT",
        "CSV files are limited to 100 columns and 100,000 data rows.",
      );
    const headers = (rows[0] || []).map((h) => h.trim().toLowerCase());
    if (headers.some((h) => !h) || new Set(headers).size !== headers.length)
      warnings.push(
        "CSV column names are blank or duplicated; named-column calculations are ambiguous.",
      );
  }
  if (ext === "json") {
    try {
      JSON.parse(text);
    } catch {
      throw new ProviderError(
        "INVALID_FILE",
        "The JSON file could not be parsed.",
      );
    }
  }
  if (!text.trim())
    throw new ProviderError("EMPTY_FILE", "This file contains no text.");
  return {
    content: text,
    mimeType: base || "text/plain",
    method: "utf8-text",
    warnings,
  };
}
