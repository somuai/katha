# Katha release evidence — 14 November 2026

This is the MiniMi chat-agent project, separate from the Wispr portfolio. Runtime under review: `fd37213`; older full answer captures are revision-pinned separately; platform/browser CI is revision-pinned in STATUS. The application is a single local workspace; public multi-user hosting is not part of this release.

## Requirements to evidence

| Requirement | Implementation and reproducible evidence | Scope / remaining boundary |
| --- | --- | --- |
| Durable accepted turns, ordering, retries, restart and disconnect | `src/core/index.ts`; `tests/core.test.ts`; `tests/http.test.ts`; `tests/browser-regression.mjs` | Original acceptance is atomic; SSE disconnect is not cancellation. Linked retry and single-owner/process-termination cases are in `tests/retry.test.ts` and `tests/workspace-owner.test.ts`. |
| Monday / last Tuesday / November 3 originals | `src/core/temporal.ts`; `tests/judge-conversations.test.ts`; dated/core fixtures | The three challenge phrasings use actual persisted conversation messages, including a restart. Missing or failed current searches cannot establish stability. |
| Five-vendor comparison | Shared `src/core/shortlist.ts`; core/provider fixtures; `evaluations/judge-followup.ts` | A generic “five tools” follow-up no longer hides historical names. Every recognized vendor has an individual result or explicit UNVERIFIED outcome. Separate price/release scopes, effective-date and evidence-link guards have public tests. The controlled real-model packet passes all ten mixed outcomes; this is not live market discovery. |
| Immutable originals, effective corrections, cutoff and deletion | `tests/active-sources.test.ts`; correction/deletion/cancellation cases in `tests/core.test.ts` | Selected files and recall use the same eligible correction lineage. Queued work cannot see later corrections; deleted sources cannot be resurrected. |
| PDF / CSV / images | [Attachment audit](ATTACHMENT_AUDIT.md), synthetic acceptance ledger and public ingestion/HTTP tests | Earlier default-model live checks are pinned separately. Excerpts and image descriptions are bounded; arbitrary databases, XLSX and video are unsupported. |
| Selected-source priority and long file follow-ups | Explicit `activeSourceIds`, durable user/source references, `tests/active-sources.test.ts` | Identity comes from eligible original user messages, never a fixed owner profile. Ambiguous people/files need clarification. |
| Faithful quotations and inspectable citations | `tests/source-claims.test.ts`; provider tests | Exact/attributed quotes and explicitly requested citations get one repair at most. Compact UI references validate against the saved turn before opening a source, and every historical assistant answer can open its audit. String/provenance validation is not a semantic truth guarantee. |
| Only web search exposed to the model | `src/providers/index.ts`, routing tests, [DESIGN](../DESIGN.md) | OAuth imports are user-selected evidence ingestion, not extra autonomous tools. |
| Search freshness, credit/cache bounds and API limits | [Operating limits](OPERATING_LIMITS.md); providers/routing/HTTP fixtures | Free quotas and missing evidence remain explicit. No paid overage or silent model fallback. |
| OAuth connections and official identities | [MCP setup](MCP.md); connection/provider tests; owner-authorized Canva/Gmail checks | Notion owner-confirmed; HubSpot/Salesforce activation and Shopify remain deferred, not live verified. |
| Notion-style chat, doodle, source indicators and voice | Existing UI and browser regression suite | Owner confirmed VoiceOver/privacy controls and physical microphone transcription. Physical-mobile testing is explicitly deferred. |
| Reproducible judge setup and architecture rationale | README, `.env.example`, one-page DESIGN, GitHub CI | Normal clone needs Node 24, `npm install`, keys, `npm run dev`; no external SSD setup required. |
| Retrieval and answer evaluations | [Evaluation notes](evaluations/README.md), captured source/claim ledgers | Retrieval 40-case ablation is distinct from factual support; model-only and production accuracy are not inferred from either. |

## Validation discipline

The runtime passes 268 public-interface/provider/HTTP tests, TypeScript, lint and production build locally. Current CI results and newly captured answer outcomes are recorded in STATUS and the release evaluation report. Older captures remain preserved and retain their own revision, observation times and review scope. A provider failure or evidence-only PARTIAL response does not count as completing a generated answer task.

Do not describe this as better than every open-source assistant. Its defensible distinction is the explicit, tested temporal-original/correction/deletion contract; [the comparison](research/open-source-comparison.md) records overlapping features and lacks a competitor head-to-head benchmark.


## Release decision

The [complete current-default evaluation](evaluations/default-fd37213-evening-review.md) records **59/63 supported factual claims (93.7%), 37/40 successful tasks and no execution errors**. All forty cases are reviewed; the agreed 90% fixed-evidence gate passes. The report retains three failed web tasks, coding-agent review scope, normal quota delays, original source dates and the distinction between synthetic search fixtures and fresh discovery. This is not production accuracy or a competitor ranking.

Earlier incomplete runs remain preserved in their own reports, including [the preceding full attempt](evaluations/default-fd37213-review.md). No targeted successes are substituted into them. Runtime tests total 268 and all six runtime/checkout platform/browser CI jobs pass. The matrix above maps the rest of the implementation and validation requirements to their evidence. User-deferred integrations and physical-mobile testing remain deferred, and no application submission or new deployment is included.
