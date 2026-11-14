import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

// Export only the public web observations already present in a reviewed ledger.
// This command does not load credentials, call providers or export chat history.
const ledger = resolve(
  process.argv[2] || "docs/evaluations/default-fd37213-evening-reviewed.json",
);
const output = resolve(
  process.argv[3] || "data/evaluations/published-evidence",
);
const run = JSON.parse(await readFile(ledger, "utf8"));
const web = run.results.filter((row: any) => row.kind === "web");
if (web.length !== 8 || new Set(web.map((row: any) => row.id)).size !== 8)
  throw Error("Expected eight distinct web cases in a full reviewed ledger.");
const captured = Object.fromEntries(
  web.map((row: any) => [
    row.id,
    row.snapshot.sources
      .filter((source: any) => source.kind === "web")
      .map((source: any) => ({
        title: source.title,
        url: source.metadata.url,
        content: source.content,
        observedAt: source.metadata.observedAt,
        ...(source.metadata.publishedAt
          ? { publishedAt: source.metadata.publishedAt }
          : {}),
      })),
  ]),
);
const hash = createHash("sha256")
  .update(JSON.stringify(captured))
  .digest("hex");
if (!run.identity.sharedCaptureHash || hash !== run.identity.sharedCaptureHash)
  throw Error(
    "Reconstructed observations differ from the ledger's capture hash.",
  );
await mkdir(dirname(output), { recursive: true });
// Require a fresh directory: never overwrite another experiment or its results.
await mkdir(output);
await writeFile(
  resolve(output, "captured.json"),
  JSON.stringify(captured, null, 2),
  { flag: "wx" },
);
await writeFile(
  resolve(output, "capture-outcomes.json"),
  JSON.stringify(run.captureOutcomes || {}, null, 2),
  { flag: "wx" },
);
console.log(
  `Exported eight public evidence sets to ${output}\nSHA-256 ${hash}`,
);
