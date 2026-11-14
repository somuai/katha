# Release answer evidence — 14 November 2026

These are versioned controlled evaluations, not production accuracy or a competitor benchmark. The coding agent reviewed every captured answer and the retained evidence in the ledgers. The owner's earlier independent review applies to earlier captures, not automatically to these newer runs. Original captures and failures remain preserved; annotations do not rewrite them.

Latest: answer engine `936da48` delivered 50/52 supported claims and 30/40 complete tasks, with eight quota failures. Its gate is EXECUTION_LIMITED. The final section links the current ledger and preserves intervening failed runs.

## Full-turn results

| Runtime / model | Complete tasks | Supported factual claims | Execution limitation | Computed gate |
| --- | --- | --- | --- | --- |
| `3e70f75`, Qwen default | 22/40 | 29/29 delivered facts | 18 cases with execution errors, including 11 source-only recoveries | EXECUTION_LIMITED |
| `3e70f75`, GPT-OSS 120B text candidate | 30/40 | 55/60 (91.7%) | None in this capture | PASSED for this controlled set |
| `fd8a35a`, Qwen default, refreshed documentation | 33/40 | 59/62 (95.2%) | Four quota-limited source-only recoveries | EXECUTION_LIMITED |

The two `3e70f75` candidates received the same older captured evidence, but separate model quotas. That confounds a superiority or latency comparison. GPT-OSS remains a text-only evaluation candidate; the default and image processing have not silently switched models. The refreshed Qwen run used actual newly fetched documentation, then held that evidence fixed per case independent of planner query. This isolates answer grounding; it does not establish unconstrained search-planning quality.

Read [the two-model answer/source/claim ledger](release-3e70f75-reviewed.json), [its computed metrics](release-3e70f75-metrics.json), [the refreshed-default ledger](qualified-default-reviewed.json), and [its metrics](qualified-default-metrics.json). Source-only fallbacks cannot count as completed generated tasks or inflate factual precision. Reported usage on these older captures omits planning tokens and some failed/preprocessing calls; it is not invoice usage. Mixed deterministic/model medians are not model-only latency.

### Remaining answer failures

The refreshed-default run preserves three substantive failures: an unqualified nonzero search-cost range despite a free allowance; an unsupported three-second EventSource default; and browser-version-specific microphone error behavior stated too generally. Four additional tasks failed the inference quota, not the evidence test. These remain failures in the ledger. Runtime citation and date validation cannot prove all prose is entailed.

The earlier `cb1368f` [98.4% fixed-set result](final-shared-evidence-review.md) remains historical. Neither it nor the newer 95.2% delivered-claim precision establishes a clean current-default release gate.

## Mixed pricing and releases: current focused proof

Runtime `4627325`: one real GPT-OSS planning/generation run with five **invented** CRM vendors, retained Monday offers and fixture current pages. All five price outcomes and five dated releases match the controlled truth. [Full synthetic packet, visible model responses and review](mixed-price-release-reviewed.json).

The price outcomes are two established dated changes, one current match, one difference with unknown timing, and one conflicting current offer. Every release comparison has baseline/current links and a verbatim November 12 effective-date passage. A release date cannot date a price change.

Two planning calls were required: the first returned unsupported mode `clarify`; the one permitted shape repair returned `verify`. Six generation calls handled five release assessments and one evidence-link repair. Explicit offer parsing supplied prices without model inference. Five fixture search dispatches supplied both topics; this does not prove real-world discovery or search coverage. Completed response usage: 9,312 input and 2,442 output tokens; failed/preprocessing/unrelated usage is excluded.

Earlier mixed runs remain listed with capture hashes: 5/5 prices and 0/5 dated releases; then 5/5 and 3/5; then a failed invalid plan; finally 5/5 and 5/5 after the documented fixes. This is evidence of targeted repair, not a repeated-run reliability estimate.

## Reproduction

```sh
npx tsx evaluations/metrics.ts docs/evaluations/qualified-default-reviewed.json /tmp/default-metrics.json evaluations/answer-cases.json
npx tsx evaluations/metrics.ts docs/evaluations/release-3e70f75-reviewed.json /tmp/comparison-metrics.json evaluations/answer-cases.json
# Explicitly consumes configured model quota; search is fixture-only:
GROQ_MODEL=openai/gpt-oss-120b npx tsx evaluations/synthetic-known-price.ts --run-live --with-releases
```

A fresh, fully executed current-default forty-case run and review remains pending provider capacity. No paid overage or silent model replacement is enabled to manufacture that gate.

## Current default and transport follow-up

Answer engine `936da48` (implementation hash `7455e347a315e36f3915c8b54155de715270fa0461bc8eae88e199efeb7e7bf5`) delivered **50/52 supported factual claims (96.2%)**, **30/40 complete tasks**, and **eight quota-limited source-only recoveries**. All forty answers and sources were inspected. The two unsupported claims concern a basic-search parameter exclusion contradicted by a newer passage, and an unqualified browser microphone exception. The earlier unsupported EventSource number does not recur in this run. These are observed outcomes, not a guarantee of consistent future behavior.

Read [the current-default claim ledger](current-default-reviewed.json) and [computed metrics](current-default-metrics.json). The full-run gate remains **EXECUTION_LIMITED**. The engine/evaluation hash was independently recomputed against the working tree after the citation UI commit and matches exactly. UI-only files are outside that answer-engine hash and have their own browser/CI checks.

A preceding `4b893a4` run encountered **22 transport failures** and completed 18/40 tasks. Its [reviewed capture](transport-failure-reviewed.json) and [metrics](transport-failure-metrics.json) remain public, even though all twenty delivered propositions were supported. Transport recovery was then normalized to capability-unavailable errors without masking cancellation. The [three-case qualification replay](qualification-replay-reviewed.json) separately passed only 1/3 tasks and supported 10/12 propositions; [its metrics](qualification-replay-metrics.json) are BELOW_TARGET. Prompt changes alone did not establish a complete fix.

A current full-run pass must not be manufactured by combining successful cases from these separate attempts, omitting failures, replacing the default model silently, or counting source-only excerpts as generated answers. No further full default-model rerun is justified until provider capacity changes.
