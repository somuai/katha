# Full current-default review — 14 November 2026

[Forty-case answer/source/claim ledger](default-dea37e2-reviewed.json) · [computed metrics](default-dea37e2-metrics.json).

## Scope and result

Runtime `dea37e2`; unchanged default `qwen/qwen3.8-27b`. Actual model planning/generation/review requests used frozen public documentation observations and labelled synthetic histories/vendor evidence. This measures end-to-end behavior against fixed evidence, not fresh web discovery or production accuracy. The ledger includes the original capture hash, configuration identity, individual wire phases and every failed case. Review is by the coding agent; earlier owner sign-off does not automatically cover these new answers.

All 40 cases were recorded and reviewed. **38/39 delivered factual propositions are supported (97.4%); 27/40 tasks succeed (67.5%). Twelve cases have execution errors, including eleven labelled source-only fallbacks.** The support gate is **EXECUTION_LIMITED**, not passed. Missing generations and source-only excerpts receive no task or new-claim support credit.

## What the run establishes

- All eight exact dated-original cases and eight retained-memory cases complete. The latter preserve original versus corrected records, effective dates and future-correction exclusions.
- Seven web cases complete. Freshness explains zero/live fetching, best-effort capacity and omitted stale results correctly. Reconnection is grounded without an invented default delay. The microphone answer preserves the Firefox 68 versus future stable/Nightly distinction that failed in earlier captures.
- One web answer adds a plausible `SQLITE_BUSY` caveat absent from all retained observations in that case. It is **unverifiable against the supplied evidence**, not credited from outside knowledge. That task fails strict review.
- The conceptual timing question and all eight verification cases encounter the quota boundary. The separate successful targeted conceptual answer is not inserted into this run.
- Four missing/deleted-history cases and the genuine CRM-versus-database clarification remain successful without model inference. Three other safety cases hit quota and receive no generated-answer credit.

## Why the release gate remains open

The provider accepted early requests, then returned 429 responses with retry guidance beyond the application's two-minute quota-wait allowance. Twelve cases therefore did not produce an eligible generated answer. The application keeps historical evidence readable and verification unresolved; it does not silently switch model or label failed search/inference as stability.

A complete quota-unconstrained current-default capture is still required. Repeating individual failures and splicing them into this ledger would not establish that gate. The numerical support percentage is above 90% **only for the delivered reviewed claims**; it cannot erase missing tasks or prove general reliability.

The separate full text-candidate run and targeted failures remain preserved in the [coherent-excerpt report](coherent-excerpts-review.md). Candidate and default results from different runtime snapshots are not a controlled model ranking.

## Other release checks

267 local tests, type checking, lint and production build pass. All six runtime CI jobs pass: [Windows/Linux/macOS and Chromium/Firefox/WebKit](https://github.com/somuai/katha/actions/runs/43572041232). Owner-confirmed VoiceOver/privacy and physical microphone checks retain their earlier scope. Physical-mobile testing and HubSpot/Salesforce/Shopify activation remain user-deferred. No paid quota or public application submission is introduced.
