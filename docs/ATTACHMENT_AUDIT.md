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
- Rate-limited inference formerly left a blank failed answer even when relevant files were retained. It now offers explicitly labelled, source-only partial recovery; cancellation and deletion still prevent recovery of removed evidence.
- Image-processing throttling returned HTTP400 with an incorrect saved-message claim. It now returns HTTP429 and Retry-After; no import is claimed when preparation failed.

## Verification results

- Runtime `416d92e`: **199 tests pass**, plus TypeScript, formatting and production build. The suite covers the attachment regressions, bounded source-only outage recovery, deletion/cancellation, unresolved vendor coverage, and malformed HTTP uploads.
- The default model passed **13 targeted live checks in separate scoped runs**: three real owner-PDF questions, five synthetic CSV questions, and five synthetic image lifecycle checks. These are small functional acceptance checks, not a claim of general accuracy or an independently reviewed benchmark.
- PDF: named contributor, repeated pronoun and findings all returned the correct section and its setup-specific qualification. The real document and raw captures remain private.
- CSV: exact total **132.10**, late-row value **120.20**, Monday **40 present / 20 absent**, Tuesday **60 present / 0 absent**, and source-grounded recommendations separated from facts.
- Image: Falcon / USD700 extraction, follow-up, process restart, refusal after trash, and successful recall after restoration.
- A separate GPT-OSS CSV comparison initially passed mechanical checks 5/5 but only 4/5 under manual review: it claimed an unshown row was incomplete. After complete-row excerpts and explicit zero-blank-cell evidence, the five targeted answers passed manual fact review. This does not establish a general model winner; the default was not changed.
- An earlier mixed default-model run returned three successful image answers and seven quota failures. Groq confirmed its daily-token limit was nearly consumed. That failure is retained in the ledger, not silently rescored as an application pass. Preparation now returns HTTP429/Retry-After honestly; accepted turns can retain readable source-only evidence when inference is unavailable.

Read the [synthetic answer/fixture ledger](evaluations/attachment-acceptance-ledger.json). All observed factual statements in the final CSV answers were checked against the known synthetic file. Recommendations remain suggestions, not predicted business outcomes. The reviewer is the coding agent, not an independent evaluator. The separate 40-case support review remains pinned to its own revision.

### Evidence-only recovery

A `PARTIAL` response labelled **“Evidence only — not a generated answer”** quotes eligible retained records or shows locally computed CSV facts. It preserves source links, respects source/version/mention deletion and never promotes a quote to a verified current fact. Verification stays `UNVERIFIED`; all named vendors remain visibly unresolved when no comparison could be made. The live acceptance runner counts these separately and does not treat them as full generated answers.

### Reproduce

```sh
node --import tsx evaluations/attachment-acceptance.ts --run-live --text-only
node --import tsx evaluations/attachment-acceptance.ts --run-live --image-only
node --import tsx evaluations/attachment-acceptance.ts --run-live
node --import tsx evaluations/pdf-page-followup.ts --run-live --pdf /absolute/report.pdf --person 'A contributor' --person-only
```

Live commands consume configured provider quota and use timestamped captures. Synthetic HTTP runs use isolated temporary workspaces. The PDF command sends relevant excerpts from the supplied file to the configured model. Expected case sets, missing cases, model configuration and source-only responses are recorded. Regex checks are only narrow acceptance assertions; manually inspect the answers as well.

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
