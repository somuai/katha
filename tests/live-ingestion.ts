// Opt-in only: generated document fixture, never user files.
import "dotenv/config";
import { createCanvas } from "@napi-rs/canvas";
import { createProviders } from "../src/providers/index.ts";
import { extractAttachment } from "../src/ingestion/index.ts";
import { mkdir, writeFile } from "node:fs/promises";
if (!process.argv.includes("--run-live")) {
  console.log(
    "Add --run-live to test scanned-PDF interpretation with the configured Groq key.",
  );
  process.exit(0);
}
const canvas = createCanvas(700, 200),
  ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, 700, 200);
ctx.fillStyle = "#000";
ctx.font = "28px sans-serif";
ctx.fillText("Katha scanned document check", 25, 60);
ctx.fillText("Five seats. USD 20 per month.", 25, 110);
const image = canvas.toBuffer("image/jpeg");
const draw = Buffer.from("q 700 0 0 200 0 0 cm /Im0 Do Q");
const objects = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
  Buffer.from(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 200] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>",
  ),
  Buffer.concat([
    Buffer.from(`<< /Length ${draw.length} >>\nstream\n`),
    draw,
    Buffer.from("\nendstream"),
  ]),
  Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width 700 /Height 200 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
    ),
    image,
    Buffer.from("\nendstream"),
  ]),
];
const parts = [Buffer.from("%PDF-1.4\n")],
  offsets = [0];
let length = parts[0].length;
objects.forEach((object, i) => {
  offsets.push(length);
  const part = Buffer.concat([
    Buffer.from(`${i + 1} 0 obj\n`),
    object,
    Buffer.from("\nendobj\n"),
  ]);
  parts.push(part);
  length += part.length;
});
parts.push(
  Buffer.from(
    `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n ")
      .join(
        "\n",
      )}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF`,
  ),
);
const providers = createProviders({
  groqKey: process.env.GROQ_API_KEY,
  model: process.env.GROQ_MODEL,
});
const result = await extractAttachment(
  Buffer.concat(parts),
  "scanned-check.pdf",
  "application/pdf",
  { providers },
);
const passed =
  /Katha/i.test(result.content) &&
  /20/.test(result.content) &&
  result.method === "pdf-text-and-vision";
await mkdir("data/evaluations", { recursive: true });
await writeFile(
  "data/evaluations/scanned-check.json",
  JSON.stringify(
    {
      runAt: new Date().toISOString(),
      syntheticDocument: true,
      passed,
      ...result,
    },
    null,
    2,
  ),
);
console.log({ passed, method: result.method, text: result.content });
if (!passed) process.exitCode = 1;
