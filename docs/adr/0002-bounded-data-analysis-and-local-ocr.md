# Bounded data analysis and local OCR

Date: 16 November 2026. Extends the existing Turns / Evidence Library interfaces.

## Decision

CSV arithmetic is performed by application code over the complete retained file. For compound requests the model proposes a small, strict JSON plan: one aggregate or row listing, up to four AND filters, up to two grouping columns, sorting and up to twenty displayed rows. The application validates column names, values, types and bounds before execution. It stores the plan, matched-row count, source ID and source version in the turn audit. The model never receives SQL, filesystem or code-execution tools.

Use fixed-point decimal arithmetic, disclose excluded blanks and rounded averages, reject guessed numeric locales, and refuse cross-currency totals without an explicit currency filter/group. More than 1,000 groups or a 20,000-character result requires a narrower request. Full-file sums retain the cheaper deterministic path. Joins, nested/OR conditions, forecasts and arbitrary expressions are outside this plan language; ask for clarification rather than implying database-level coverage.

Images receive local English OCR in addition to the existing visual description. Scanned PDF pages, including sparse native text over a raster scan, try local OCR before hosted vision. Preprocessing uses full-range normalization, local contrast enhancement, sharpening and a bounded fallback segmentation pass. English language data ships as an npm dependency, so OCR itself requires no runtime CDN download or provider key. This adds install size and CPU work; it does not make poor scans reliable by definition. Quality gates select a path, not a truth probability.

A single local OCR worker runs at a time, with four admitted jobs and a fifteen-second per-job deadline. Workers terminate after use. Dense input remains bounded by existing pixel/file limits. OCR and vision are explicitly derived interpretations; original uploads and physical page markers are retained. Readable OCR can survive hosted-vision failure, with a warning that non-text details were not interpreted.

Successful identical image interpretations have a bounded process-local cache (32 entries, fifteen minutes, keyed by model, MIME and image bytes). Failed/cancelled results are not cached. Hosted model `Retry-After` applies across questions, not only to the turn that received the 429. None of this changes provider entitlements, enables paid overages, or silently changes providers.

## Alternatives rejected

- Letting the model calculate from a small CSV excerpt: insufficient coverage and unreliable arithmetic.
- Model-generated SQL or Python: a larger execution/security surface that conflicts with the challenge's one-agent-tool design.
- Sending every scanned page to hosted vision first: unnecessary quota use when local OCR can extract the text.
- Claiming preprocessing fixes every image: information absent from the original cannot be recovered reliably.

## Evidence and remaining scope

See `tests/csv-analysis.test.ts`, `tests/ocr-ingestion.test.ts`, quota/cache provider tests and `evaluations/data-hardening.ts`. The live runner uses synthetic data and must be opted into. Existing 40-case accuracy figures remain pinned to their original runtime. Local OCR is English-only; handwriting, severe blur, complex chart geometry and multilingual OCR still require broader evaluation.

References: [Tesseract quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), [Tesseract.js local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), and the bundled `@tesseract.js-data/eng` package documentation.
