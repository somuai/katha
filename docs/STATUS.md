# Implementation status

Implemented: durable SQLite turns and replay, idempotent acceptance, scoped/date recall, async lexical+semantic indexing, immutable original records, sentence-located assertion candidates, effective-dated corrections and lineage UI, deletion invalidation/purging, numbered transactional migrations, bounded search/cache/quotas, normalized commercial-term comparison, verbatim dated-change evidence validation, attachment/voice/image processing, and responsive React UI.

Correction policy: original quotations remain unchanged. Default current recall excludes superseded whole records and obsolete corrections. Assertion edits target the latest record. A whole-record replacement that would strand a scheduled assertion correction is rejected with a conflict instead of silently discarding it. Sentence assertions are located candidates, not automatically verified facts. Effective time and the turn's acceptance cutoff are separate.

Verified: deterministic public-interface tests; build, formatting and TypeScript; actual MiniLM retrieval on forty fixtures in three configurations; credential/model availability; twelve live provider cases with one initial quota failure and successful later recovery; live image and scanned-PDF processing; owner-confirmed physical microphone/transcript; Chromium/WebKit responsive and accessibility checks; fresh macOS install.

Still open: hand-reviewed live supported-claim precision and the 90% release gate; broader positive/negative full-agent evaluation beyond retrieval fixtures; live model comparison; real Windows/Linux runs (CI configured); Firefox automation (host launch failure); manual screen-reader and physical mobile-device testing. Free-tier forced-live search can return no pages. Price grounding is conservative and can abstain on valid offers with unstated commercial terms. No production accuracy or latency claim is made.

## Full-turn evaluation update

A 40-case, two-model run at application revision `03da772` completed on 12 November 2026. Each candidate used isolated workspaces and the same eight captured web-evidence sets. Qwen completed all 40 turns; GPT-OSS 120B had two provider errors. The expected verification-status checks differed in zero Qwen cases and three GPT-OSS cases. These are scenario checks, not claim-support scores. The per-claim evidence audit is unfinished; the 90% support gate remains unverified. The run manifest and raw results are in the ignored local `data/evaluations/answers-reviewed/` directory.

GitHub Actions run https://github.com/somuai/katha/actions/runs/43186378636 passed clean installs, tests and builds on Windows, Linux and macOS, plus browser checks on Chromium, Firefox and WebKit. The physical-mobile test was deferred at the owner's request. Manual VoiceOver sign-off remains pending the owner's listening check.

## Attachment and challenge smoke checks

On 12 November, live Qwen tests with synthetic records counted a five-row attendance CSV (3 present, 2 absent), answered a short PDF's deadline and budget, and recovered dated conversation history. An initial CRM follow-up lost the attached CSV; it now carries the last eligible attachment forward, with a regression test and successful live follow-up. A 100-row CSV initially exceeded the model's excerpt: local preprocessing now supplies exact whole-integer column sums and question-matching rows. The live model returned the correct sum (5050) and Customer100's value (100).

This is not a general-purpose database engine: decimals, complex group-by questions, large PDFs, arbitrary row-level analysis, and ambiguous spreadsheet schemas are not guaranteed. Retrieved source text remains bounded and the model may omit relevant evidence. Recommendations are suggestions; the first run incorrectly described CRM contacts as a team, so the prompt now cautions against inferring roles that the file doesn't establish.

In a live Monday-shortlist check, five search queries completed, but the generated answer covered only three of five vendors and could not establish like-for-like historical prices. Comprehensive per-vendor coverage and the hand-reviewed 90% supported-claim gate remain open. Live result logs and the synthetic test harness are local; no user's real records were used.

Evaluation note: the older `answers-reviewed` manifest listed a 700-token output limit; the answer adapter actually requested 1000. The historical result is retained, and the runner now records the correct value for future runs. The latest five-vendor live check used five search queries and explicitly labeled two vendors as not individually verified; stronger evidence coverage and an independent claim review remain open.

## Connections and image audit

The owner confirmed VoiceOver, the privacy dialog and physical microphone transcription. The local Connections panel now manages explicitly selected HTTPS MCP servers and imports advertised text resources through the official MCP SDK. Credentials stay in the local private configuration; source provenance is retained. This is resource import, not arbitrary agent tool access. This earlier resource-only snapshot is superseded by the connection update below. Public or bearer-authenticated resource servers are the supported scope; tools-only services give an explicit unsupported error.

Image normalization now applies a white matte to transparent inputs. Short extractable PDFs no longer require a vision key. Multi-vendor verification now gives every named entity an individual structured result; missing or grouped-only assessments remain explicitly unverified. Protocol fixtures cover MCP selection, imports, authorization failures, unsupported resources, size limits and credentials not appearing in responses.

## Named connections and automatic routing — 12 November

The provider picker now exposes official Notion/Canva MCP integrations plus explicitly labeled Gmail/HubSpot API adapters. OAuth credentials are private, scopes are controlled, selected imports preserve provenance, and disconnect rejects late imports. Listings use a bounded 30-second success cache and request coalescing; per-connection browse/import/auth limits and bounded Retry-After handling are explicit. Custom MCP URLs remain only under Advanced. Notion's actual unauthenticated discovery/registration returned its official consent URL; no account login/content access was tested. Other provider sign-ins remain pending app registration and live review. Salesforce and official HubSpot MCP tool mapping remain unavailable.

The planner's mode is no longer discarded. Public current questions can search automatically, sources-only instructions are enforced, and private attendance/account-file correctness questions stay local. A visible routing audit and query safeguards are included; semantic detection of all possible private data in arbitrary mixed queries is not guaranteed. Live account data is imported by explicit user action, not silently refreshed for every question.

The thinking state uses the supplied doodle and actual selected-evidence service badges. The updated evaluation summarizer separates execution completion, task success, reviewed factual precision, evidence-review coverage and latency/quota. Existing unreviewed live outputs remain NOT_REVIEWED; no 90% support claim is made.

## Continuation — 13 November

The official HubSpot MCP adapter now reports 429/503 retry delays without retrying early. A narrow Salesforce official MCP adapter was added for selected recently viewed record IDs and names, subject to Salesforce administrator setup and potential Flex Credit charges. Both use deterministic protocol fixtures; neither has had its authenticated live account and schemas verified. The latest qualitative answer review covers 15 captured answers across both models; it is not the full claim-level evaluation and does not establish 90% support. See `docs/evaluations/manual-review-sample.md`.
