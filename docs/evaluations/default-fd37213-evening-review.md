# Complete default-model release evaluation — 14 November 2026

[Reviewed answers, original sources and claim verdicts](default-fd37213-evening-reviewed.json) · [computed metrics](default-fd37213-evening-metrics.json).

## Result and scope

**59/63 factual propositions supported (93.7%); 37/40 tasks successful (92.5%); zero execution errors and zero evidence-only fallbacks.** All forty cases are present and reviewed. The agreed 90% supported-claim gate **passes for this fixed-evidence evaluation**.

Tested checkout: `3960ef9`; runtime implementation: `fd37213`; default model: `qwen/qwen3.8-27b`. This is a new complete run after substantial quota recovery, not successful cases combined across attempts. The manifest pins implementation/fixture hashes, model and source capture identity. Actual model calls use retained public documentation observations and labelled synthetic personal/vendor records. This tests answer grounding and temporal behavior, not fresh search discovery, production accuracy, independent human certification or superiority to other agents. Review is by the coding agent; earlier owner review does not automatically cover these new answers.

## What worked

- Eight exact dated-original cases and eight retained-memory cases preserve originals, corrections, effective dates and future-edit exclusions.
- All eight verification cases meet their expected outcomes: dated changes, different current values with unknown change dates, currently matching observations, deliberately missing evidence, complete like-for-like prices, region/cadence mismatches and conflicting evidence. The deliberate search failure produces an expected source-preserving abstention, not a stability claim or provider execution error.
- Missing/deleted history remains unavailable; genuine shortlist ambiguity asks a clarification. Prompt injection does not override the retained budget. Retrieval time does not establish change time.
- Freshness, reconnection and credit explanations use retained sources. Every cited source and every claim-review evidence ID resolves to a source in that turn. Effective-date comparisons retain exact supporting quotations.

## Failures retained in the score

Three ordinary web tasks fail strict review despite the underlying question often receiving a useful answer:

1. **SQLite WAL:** adds a plausible `SQLITE_BUSY` caveat absent from the retained sources. It is unverifiable against this evidence and receives no support credit from outside knowledge.
2. **Microphone contexts:** merges unavailable `mediaDevices`/TypeError and version-specific NotAllowedError into a universal rule, and drops the Firefox stable-versus-Nightly qualification. Two assertions are unsupported.
3. **Price-date explanation:** correctly distinguishes freshness from change timing, but says `include_published_date` filters results. That field annotates dates; filtering is a separate behavior. The extra blanket claim is unsupported.

There are three unsupported and one unverifiable factual propositions; two explicit deductions are classified separately as inference. The same-model reviewer approved imperfect prose. It is a bounded filter, not a proof of truth. The numerical gate is 90%, not an assertion that every task or answer is correct. These failures are visible in the ledger and remain future quality work.

## Quota, speed and resource evidence

No turn fails on quota. Two recorded HTTP429 responses are **minute-token** limits and recover within the existing wait policy; no daily-token 429 occurs. All quota waits total approximately 549 seconds. This run therefore completes under normal pacing; it is not a claim that the service has unlimited capacity.

Reported completed-response usage is 45,616 input and 6,262 output tokens, not a billing total. The mixed forty-case median includes deterministic local answers and must not be sold as model latency. Among 22 turns with an actual successful generation request, median completion is approximately 4.36 seconds including quota delay and 2.01 seconds excluding recorded quota wait. This is one fixed-case observation, not a production latency guarantee. Synthetic search-adapter dispatches are not real Tavily invoice credits.

## Other release evidence and retained boundaries

268 deterministic tests, TypeScript, lint and production build pass. All six platform/browser jobs pass for the runtime and tested checkout: [runtime CI](https://github.com/somuai/katha/actions/runs/43573386335), [checkout CI](https://github.com/somuai/katha/actions/runs/43577678452). [Attachment audit](../ATTACHMENT_AUDIT.md), [retrieval ablation](README.md), [requirements matrix](../RELEASE_READINESS.md) and [operating limits](../OPERATING_LIMITS.md) retain their own scope and limitations. Earlier quota-limited captures remain separate and are not rescored.

Physical-mobile testing and HubSpot/Salesforce/Shopify activation remain user-deferred. Owner-confirmed VoiceOver/privacy and physical microphone checks retain their prior scope. No paid tier, silent model replacement, public multi-user deployment or hiring-form submission was performed.

## Reproduction

The [README commands](../../README.md#reproduce-the-complete-answer-evaluation) export the exact public evidence packet from this committed ledger, verify its original SHA-256, and replay it in a fresh experiment. Export was executed and the reconstructed capture hash exactly matched `a7c9af21b310ce414fd9c69c02787d07cd2e3e8d25ce6bdca9beecbd404cf95c`. No private history is required. Model calls remain opt-in, quota-consuming and nondeterministic.
