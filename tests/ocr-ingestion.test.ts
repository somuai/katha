import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { createProviders } from "../src/providers/index.ts";
import { extractAttachment } from "../src/ingestion/index.ts";

test("a dense text image retains its last line when hosted vision is rate limited", async () => {
  const canvas = createCanvas(1800, 2200),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 1800, 2200);
  ctx.fillStyle = "#222";
  ctx.font = "28px sans-serif";
  for (let i = 0; i < 45; i++)
    ctx.fillText(
      `Account ${i + 1}: recorded synthetic customer data`,
      60,
      60 + i * 44,
    );
  ctx.fillText("Final approval code: COBALT731", 60, 2130);
  const providers = createProviders({
    groqKey: "fixture",
    fetcher: (async () =>
      Response.json(
        { error: { message: "Rate limited" } },
        { status: 429, headers: { "Retry-After": "60" } },
      )) as typeof fetch,
  });
  const result = await extractAttachment(
    canvas.toBuffer("image/png"),
    "dense.png",
    "image/png",
    { providers },
  );
  assert.match(result.content, /COBALT731/);
  assert.match(result.method, /ocr/);
  assert.ok(result.warnings.some((w) => /vision|rate|unavailable/i.test(w)));
});

function scanPdf(image: Buffer) {
  const draw = Buffer.from(
    "q 600 0 0 400 0 0 cm /Im0 Do Q BT /F1 10 Tf 10 390 Td (Scan) Tj ET",
  );
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> >>",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${draw.length} >>\nstream\n`),
      draw,
      Buffer.from("\nendstream"),
    ]),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 1600 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
      ),
      image,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  let raw = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(raw.length);
    raw = Buffer.concat([
      raw,
      Buffer.from(`${i + 1} 0 obj\n`),
      obj,
      Buffer.from("\nendobj\n"),
    ]);
  }
  const xref = raw.length;
  return Buffer.concat([
    raw,
    Buffer.from(
      `xref\n0 7\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => String(n).padStart(10, "0") + " 00000 n ")
        .join(
          "\n",
        )}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
    ),
  ]);
}

test("a low-contrast scanned PDF with a tiny native header retains the scanned invoice without hosted vision", async () => {
  const canvas = createCanvas(1600, 1000),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = "#bdbdbd";
  ctx.font = "56px sans-serif";
  ctx.fillText("Invoice ACME42", 110, 300);
  ctx.fillText("Total USD 4200", 110, 420);
  const providers = createProviders({});
  const result = await extractAttachment(
    scanPdf(canvas.toBuffer("image/jpeg")),
    "faded-invoice.pdf",
    "application/pdf",
    { providers },
  );
  assert.match(result.content, /4200/);
  assert.match(result.content, /ACME42/);
  assert.match(result.content, /Page 1/);
  assert.match(result.method, /ocr/);
  assert.ok(result.warnings.some((w) => /OCR/i.test(w)));
});
