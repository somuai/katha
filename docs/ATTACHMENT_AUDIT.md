# Attachment and follow-up audit — 13 November 2026

This audit separates file retention, preparation, retrieval, answer quality and provider availability. A successful upload does not prove every later answer is correct.

## Reproduced failures and repairs

- A named contributor query could select a PDF's title-page roster rather than the individual contribution. Contributor headers now resolve unique full or partial names; ambiguous names require clarification.
- A pronoun-only question could lose the attachment or the person after the recent-message window. Document reference state retains document ID/version, exact contributor names and the original user-mention ID. Later references validate the original mention and document again. Deleting the mention or document prevents reuse; references do not derive from assistant assertions.
- A long explicit PDF page was sliced before a relevant late fact. Page selection now retains the physical page marker while selecting relevant passages within its budget.
- Dates inside a file-analysis question could be mistaken for dates of prior chats. Uploaded-data analysis and explicit original-chat recall now take separate routes. The historical recall contract remains tested.
- CSV summaries handled integers only. Bounded fixed-point arithmetic now computes exact decimal totals and reports excluded blank cells. Exact-value subset counts are clearly labelled separately from whole-file counts.
- Invalid CSV shape was accepted as plain text. HTTP upload now rejects malformed quoting/inconsistent columns before import; blank/duplicate headers warn and disable named-column aggregates.
- An invalid generated citation could fail the entire answer. One bounded repair may use only retained IDs; persistent invalid IDs, including invented inline UUIDs, fail closed. Repair reuses the existing quota/cancellation limits.
- Image-processing throttling returned HTTP400 with an incorrect saved-message claim. It now returns HTTP429 and Retry-After; no import is claimed when preparation failed.

## Proof so far

The runtime at `ab13f57` passes 191 tests, TypeScript, formatting and production build. CI passes Windows/Linux/macOS and Chromium/Firefox/WebKit: https://github.com/somuai/katha/actions/runs/43407710485 . Twelve additional tests, plus malformed-upload assertions in the HTTP suite, cover the attachment regressions; they do not establish general model accuracy.

A live local run against the owner's 50-page PDF correctly answered the named teammate's contribution, the pronoun follow-up and the findings, including the report's qualification that observations apply to the tested local-model setup. That run also exposed the citation failure subsequently repaired. Private PDF extracts and captures stay ignored; synthetic names are used in committed tests.

The synthetic HTTP acceptance runner tests real image upload, follow-up, process restart, CSV totals, late rows, weekday counts, recommendations, deletion and restoration. It uses an isolated temporary workspace and real configured inference. Initial captures retain a test-client cursor error and provider throttling; they are not passed suites. Fresh complete-run results belong below, separately from contract tests.

Run:

```sh
node --import tsx evaluations/attachment-acceptance.ts --run-live
node --import tsx evaluations/pdf-page-followup.ts --run-live --pdf /absolute/report.pdf --name 'Your stated name' --person 'A contributor'
```

Both consume quota and retain timestamped local captures. The first uses synthetic data; the second sends relevant excerpts from the supplied PDF to the configured model. HTTP assertions are narrow acceptance checks, not claim-support precision; inspect every returned answer too.

## Capability limits

| Input | Supported path | Explicit limits |
| --- | --- | --- |
| Text PDF | Original extraction, physical page markers, relevant passage selection, contributor follow-ups | 5 MB / 50 pages. Printed and physical numbering can differ. A bounded excerpt is not the complete PDF in the model context. |
| Scanned PDF | Rendered-page model interpretation with a warning | OCR/visual interpretation can be wrong; verify critical text against the original. |
| PNG/JPEG/WebP | Normalized image, labelled model-derived description retained across chats/restart | 10 MB / 20 megapixels. Later answers use the retained description; arbitrary pixel details omitted from it are not guaranteed. |
| CSV | Strict comma-separated shape; exact decimal/integer totals, missing-cell counts, low-cardinality categories, explicit-value subsets and matching rows | 5 MB / 100 columns / 100,000 data rows. Numeric parsing accepts up to 18 integer and 6 fractional digits without inferred currency or locale. Independent filters are not arbitrary joins, SQL, pivot tables or combined-condition analysis. |
| TXT/Markdown/JSON | Original text retained and retrieved; JSON syntax checked | 5 MB; retrieval/context budgets still apply. XLSX, video and arbitrary binary formats are not supported. |
| Voice | Editable Whisper transcript | 60 seconds / 10 MB. Owner-confirmed physical microphone operation remains distinct from these file tests. |

Original sources, interpretations and later corrections remain distinguishable. Trash removes recall eligibility and invalidates dependent answers; completed old answers remain visible with their provenance state. A model can still misunderstand a question or omit a relevant detail. The earlier controlled 40-case support score is pinned to its own revision and is not retroactively assigned to these changes. Deferred account integrations and physical-mobile testing remain deferred.
