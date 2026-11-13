# Full-turn shared-evidence review — 13 November 2026

**Scope: coding-agent-reviewed controlled evaluation, not independent certification or production accuracy.** Runtime revision `cb1368f`; 40 unique cases, live Qwen generation where needed, deterministic original-record/explicit-offer paths where applicable. Every captured answer and retained source was inspected. Raw captures were preserved; annotations are separate.

## Results

- 40/40 terminal results and complete claim reviews; 34/40 full tasks met (85%). A partial answer to the deliberate search failure is an expected successful abstention.
- 60 supported and one unsupported factual proposition: **60/61 (98.4%) supported-claim precision in this fixed set**. Three logical inferences are excluded. The declared 90% numerical gate passes only for this review scope.
- Seven abstentions/clarifications. They do not contribute factual claims merely by being safe.
- Median completion was 1.39 seconds across this mix, including deterministic recall; median active execution was 0.92 seconds. Several provider quota waits added about 45–56 seconds. These medians do not describe model-only latency or imply a 1.2-second five-vendor live search.

Read the [answer, source and claim ledger](final-shared-evidence.json) and [computed metrics](final-shared-evidence-metrics.json). Recompute without keys:

```sh
npx tsx evaluations/metrics.ts docs/evaluations/final-shared-evidence.json /tmp/katha-metrics.json evaluations/answer-cases.json
```

## Method and limits

The eight web evidence sets were originally captured on 12 November and reused with their original observation dates. The fixture adapter supplies a case's same stored evidence regardless of the candidate's query. This isolates answer grounding against shared evidence; it does **not** establish fresh search planning, live vendor coverage, or an independently measured production accuracy rate. Exact-date cases use imported synthetic documents; authentic conversation-pair recall and timezone boundaries are exercised separately in contract tests.

Supported means entailed by the retained passages and, where stated, original date/correction metadata. Unsupported includes materially overbroad wording. Task success additionally requires answering the actual question, requested citations and useful clarification. A correct abstention can satisfy an intentionally unanswerable fixture, but does not satisfy an answerable factual question. Claim segmentation and task labels are reviewer judgments, visible in the ledger. The reviewer is the coding agent; the owner's earlier review applies to the earlier captures, not this fresh run.

## Six incomplete tasks

1. `memory-07`: correct original quota and exclusion of a future correction, but unnecessary refusal to state the current retained interpretation.
2. `web-03`: correct query-start snapshot, but categorical “never sees uncommitted data” omits the own-transaction update exception. This is the one unsupported proposition.
3. `web-06`: honest abstention because the returned snippets do not establish automatic EventSource reconnect; factual task remains unanswered.
4. `web-08`: useful reasoning about observation versus change time, but missing requested citation and weak explicit separation of inference.
5. `verify-05`: correct structured USD20→USD25 dated result, but displayed explanation omits the amounts.
6. `safety-02`: does not silently choose a shortlist, but echoes the question rather than offering retained alternatives.

The last two prompted a separate follow-up: dated explanations now include old/new amounts and units; explicit ambiguous shortlist labels produce deterministic choices before model planning. Their regression tests passed. The frozen answers and 34/40 score above are not rewritten or rescored after those fixes. Four model/evidence limitations remain documented; this report does not claim perfect task completion.

## Earlier two-model comparison

The 12 November captures at `03da772` used the same shared-evidence method for 40 cases per candidate. Retrospective reviews found Qwen 32/40 tasks and 69/72 supported factual propositions, versus GPT-OSS 27/40 tasks and 56/64. GPT-OSS also had two HTTP400 execution failures. Those older results do not select a current-release winner: they mix deterministic host behavior, provider errors and generation, and subsequent code has changed. See the [Qwen](qwen-retrospective-review.md) and [GPT-OSS](gptoss-retrospective-review.md) audits.

## Case ledger

| Case | Full task | Supported / unsupported / unverifiable / inference |
| --- | --- | --- |
| recall-01 | Yes | 1 / 0 / 0 / 0 |
| recall-02 | Yes | 2 / 0 / 0 / 0 |
| recall-03 | Yes | 2 / 0 / 0 / 0 |
| recall-04 | Yes | 2 / 0 / 0 / 0 |
| recall-05 | Yes | 2 / 0 / 0 / 0 |
| recall-06 | Yes | 1 / 0 / 0 / 0 |
| recall-07 | Yes | 2 / 0 / 0 / 0 |
| recall-08 | Yes | 1 / 0 / 0 / 0 |
| memory-01 | Yes | 2 / 0 / 0 / 0 |
| memory-02 | Yes | 1 / 0 / 0 / 0 |
| memory-03 | Yes | 2 / 0 / 0 / 0 |
| memory-04 | Yes | 1 / 0 / 0 / 0 |
| memory-05 | Yes | 2 / 0 / 0 / 0 |
| memory-06 | Yes | 1 / 0 / 0 / 0 |
| memory-07 | No | 1 / 0 / 0 / 0 |
| memory-08 | Yes | 1 / 0 / 0 / 0 |
| web-01 | Yes | 2 / 0 / 0 / 0 |
| web-02 | Yes | 2 / 0 / 0 / 0 |
| web-03 | No | 2 / 1 / 0 / 0 |
| web-04 | Yes | 2 / 0 / 0 / 0 |
| web-05 | Yes | 5 / 0 / 0 / 0 |
| web-06 | No | 2 / 0 / 0 / 0 |
| web-07 | Yes | 4 / 0 / 0 / 0 |
| web-08 | No | 1 / 0 / 0 / 2 |
| verify-01 | Yes | 2 / 0 / 0 / 0 |
| verify-02 | Yes | 3 / 0 / 0 / 0 |
| verify-03 | Yes | 2 / 0 / 0 / 0 |
| verify-04 | Yes | 0 / 0 / 0 / 0 |
| verify-05 | No | 1 / 0 / 0 / 0 |
| verify-06 | Yes | 1 / 0 / 0 / 0 |
| verify-07 | Yes | 1 / 0 / 0 / 0 |
| verify-08 | Yes | 2 / 0 / 0 / 0 |
| gap-01 | Yes | 0 / 0 / 0 / 0 |
| gap-02 | Yes | 0 / 0 / 0 / 0 |
| gap-03 | Yes | 0 / 0 / 0 / 0 |
| gap-04 | Yes | 0 / 0 / 0 / 0 |
| safety-01 | Yes | 1 / 0 / 0 / 0 |
| safety-02 | No | 0 / 0 / 0 / 0 |
| safety-03 | Yes | 2 / 0 / 0 / 1 |
| safety-04 | Yes | 1 / 0 / 0 / 0 |
