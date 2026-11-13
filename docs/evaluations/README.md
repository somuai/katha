# Evaluation evidence

The [attachment audit](../ATTACHMENT_AUDIT.md) adds 13 scoped default-model live checks and a separate CSV comparison, including the mechanically-passing recommendation later rejected by manual review. It is distinct from the controlled 40-case support evaluation below. Source-only recovery is reported separately from full answers.

## Latest review and platform proof

The [13 November full-turn review](final-shared-evidence-review.md) covers 40 cases at `cb1368f`: 34 full tasks met and 60/61 factual propositions supported under a coding-agent review. This passes the numerical 90% threshold for that controlled shared-evidence set only, not independent or production certification. The complete sanitized synthetic/public-source ledger and metrics are committed alongside the report. Follow-up clarity fixes are identified separately; frozen results are not retroactively changed.

Current runtime CI passed Windows/Linux/macOS install/tests/build and Chromium/Firefox/WebKit journeys: https://github.com/somuai/katha/actions/runs/43402177845 . The remaining sections record earlier runs and their limits.

## Offline retrieval ablation

Run `npm run eval`. Forty hand-authored synthetic cases query sixteen relevant records followed by ten unrelated recent records. The same corpus and questions are used for all three strategies. The metric is whether the expected original source appears in the top five.

The recorded run produced recent context **0/40**, calendar plus lexical **32/40**, hybrid **40/40**. See `recall-results.json` for every query, retrieved title, method and latency. Recent context's zero is an intentional distractor stress case, not a claim about normal user traffic. Hybrid uses actual local MiniLM embeddings, not a fixture embedding. These are retrieval results, not model-answer accuracy or production latency measurements.

The deterministic public-interface suite separately exercises missing baselines, corrections, deletion races, date boundaries, supported versus unsupported dated changes, inconsistent commercial terms, cancellation and retries. `npm test` is the reproducible contract check. Do not combine its pass count with the forty retrieval cases into an accuracy percentage.

## Live providers, 12 November 2026

Both configured credentials worked; Groq's model catalog confirmed the configured Qwen model. The twelve-case opt-in primary-model run returned eleven answers on the first pass and one token-cap failure. A separate recovery attempt returned an answer for the failed case; the original failure is preserved. Raw captures are private under `data/evaluations/` and are not published with credentials or local history.

Several forced-live Tavily searches returned zero pages. A normal advanced search returned three results. Tavily documents that `max_age_hours: 0` excludes pages that cannot be fetched live, and free-plan live fetching is best effort: https://docs.tavily.com/documentation/api-reference/endpoint/search . An empty result establishes missing evidence, never stability. Provider observation time is distinct from a source's publication or effective date.

**At the time of this earlier provider smoke run, the 90% supported-claim gate had not passed.** These raw provider runs are not a hand-labelled end-to-end grounding benchmark. One raw answer mixed unrelated commercial evidence; the application's price validation now rejects incomplete or mismatched terms. A positive-and-negative, claim-level end-to-end review is still required before claiming that gate. No comparative model winner is declared.

Live image and scanned-PDF checks both read a generated document fixture containing “Katha”, “Five seats” and “USD 20 per month”. Scanned text was explicitly labelled model interpretation. The owner independently tested a physical microphone and confirmed that the editable transcript worked.

## Browser and platform checks

The paragraph below records the initial local checks. A later GitHub Actions run passed Windows, Linux, macOS, Chromium, Firefox and WebKit: https://github.com/somuai/katha/actions/runs/43186378636 . The owner subsequently confirmed VoiceOver and physical microphone use; physical mobile testing remains deferred. These historical results do not automatically validate later revisions.

Chromium and WebKit passed upload, assertion correction, original preservation, typed conversation, Escape dismissal, reduced-motion and 375/768/1280/1440px overflow checks, with zero automated WCAG A/AA findings in the tested states. This does not replace a screen-reader or real-device audit. Firefox automation could not launch on this host (profile-folder error); it is not marked passed.

A fresh macOS install without `.env` passed `npm ci`, TypeScript, tests and build. Windows/Linux checks are configured in `.github/workflows/check.yml` but have not run here. Do not claim cross-platform validation from a workflow definition alone.

## Reviewed metrics

The captured two-model answer comparison supplies the same stored evidence per case regardless of the candidate's query. This isolates answering against shared snippets; it does not measure end-to-end search planning quality. The recall cases use synthetic imported documents, with original conversation recall exercised separately through public-interface tests.

Review annotations now require claim text and, for supported claims, evidence IDs resolving to nonempty retained sources. An empty claim list counts as a complete review only for an explicitly labelled nonfactual abstention. This prevents sparse reviews from inflating coverage; semantic entailment still requires a reviewer to read the evidence.

Run `npx tsx evaluations/metrics.ts data/evaluations/answers-reviewed/results.json data/evaluations/answers-reviewed/metrics.json evaluations/answer-cases.json` to summarize the captured run without consuming provider quotas. It separates execution completion, reviewed task success, factual support, review coverage, and useful-answer latency; failures and empty outputs never count as useful answers. Inferences and abstentions do not inflate factual precision. Missing case declarations or incomplete claim reviews prevent a passed 90% gate. The original unannotated capture reports NOT_REVIEWED and null precision. Separate retrospective annotations and the latest committed, fully annotated run are linked above; raw captures are not silently overwritten.
