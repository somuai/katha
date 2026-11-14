# Resumed full-default evaluation — 14 November 2026

[Forty-case reviewed ledger](default-fd37213-reviewed.json) · [computed metrics](default-fd37213-metrics.json).

Runtime `fd37213`, unchanged default Qwen; a fresh run after approximately forty minutes of recovery time. Actual model calls use retained public documentation and labelled synthetic private/vendor records. This is not fresh search discovery, independent certification or production accuracy. Every original failed case remains in this run, with a raw-capture hash and configuration identity; no successful cases from another run replace it.

## Outcome

All forty cases are recorded and reviewed. **21/40 tasks complete; 19 cases have quota execution errors, including eleven source-only recoveries.** The 24 delivered factual propositions are supported, but **all are retained-memory/original-record claims**. There is no delivered web-answer support evidence from this run. The gate is **EXECUTION_LIMITED**, not passed; its 24/24 support fraction is not a broad accuracy result.

The first eight dated-original and eight retained-memory cases complete correctly. Four missing/deleted-history cases and the genuine CRM-versus-database clarification also succeed. The first web case generates a provisional draft but its qualification-review request receives a daily-token 429 with a `9m1.728s` wait (Retry-After 542 seconds). The draft remains unpublished and receives no answer credit. All 21 captured 429 responses classify the limit as `daily_tokens`. No remaining web/verification/safety generation counts as task success. Failed generations and labelled source-only fallbacks are preserved.

## Capacity interpretation and next action

A small request succeeded before this run, but it did not establish sufficient daily headroom. Groq's [official rate-limit documentation](https://console.groq.com/docs/rate-limits) distinguishes minute and daily limits: the remaining-token/reset-token headers report minute capacity, not remaining daily tokens. Organization-level limits may also reflect other usage. We therefore cannot infer a full evaluation's capacity from those headers or predict an exact recovery time from one accepted request.

Do not repeatedly start fresh full runs after small successful probes: those requests consume the same quota needed by the release evaluation. The next full run requires substantial daily-quota recovery or verified headroom in the account limits page. Existing complete-run failures must remain separate; targeted recoveries cannot be spliced into a clean pass. No billing upgrade, silent default substitution or additional credential is introduced.

The earlier [full default capture](default-dea37e2-review.md) remains separately versioned (38/39 supported delivered claims, 27/40 tasks, twelve quota errors). Neither attempt establishes the remaining clean current-default gate.

## Implementation and other checks

268 local tests, type checking, lint and production build pass. All six runtime platform/browser jobs pass: [CI](https://github.com/somuai/katha/actions/runs/43573386335). The [latest published checkout](https://github.com/somuai/katha/actions/runs/43573552620) also passed all six. The worktree remains clean after the evidence commit. Previously verified attachment, correction/deletion, OAuth and accessibility evidence retains its recorded scope. Physical-mobile testing and HubSpot/Salesforce/Shopify activation remain user-deferred.
