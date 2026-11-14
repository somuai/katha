## Latest follow-up: `a251224`

267 local tests, check/lint/build and Chromium browser regression pass. Web excerpts preserve parameter meaning and exception qualifications; explicit citation syntax is consistent across provider guards and UI. [Evidence and unresolved limits](evaluations/coherent-excerpts-review.md).

The complete text-candidate capture records 50/51 supported factual claims and 34/40 tasks, with one execution failure. It is not a clean default-model release gate. The new targeted replay passes the freshness task but still fails the conceptual-date task. Default Qwen evaluation remains capacity-limited. No new independent review is implied.

# Katha status — 14 November 2026

MiniMi chat-agent project. Local preview: http://localhost:3000/ . Public source: https://github.com/somuai/katha . This is separate from the Wispr portfolio; no Katha public multi-user deployment is claimed.

## Latest implementation

Runtime `caa68c2` passes **256 automated tests**, TypeScript, formatting lint and production build locally. The Chromium regression passes upload, original/correction inspection, a saved-chat linked retry with original attachments, keyboard dismissal, responsive viewports and automated accessibility checks. Compact inline source controls hide technical IDs; historical answers can open their own evidence/audit view. The preview responds successfully.

The latest changes prevent a second workspace process from interrupting the owner's active work; recover committed turns after process termination; make deliberate retries fresh, linked and deletion-safe; restore observation of active chats; prevent the user question appearing as an assistant snapshot; label missing-model responses partial; and allow one search-plan shape repair. Prior selected-document, quote, mixed-topic comparison, date-validation and usage-accounting fixes remain in place.

Current runtime [passes all six CI jobs](https://github.com/somuai/katha/actions/runs/43548250381): Windows/Linux/macOS install/tests/build and Chromium/Firefox/WebKit journeys. Earlier answer-capture hashes remain pinned to their own code versions; no old full-run result is relabelled as a current pass.

New public-turn regressions cover source-qualified draft repair, shared repair limits, quota resumption, cancellation, and the host's ordinary-versus-historical answer path. The shorter ordinary prompt avoids unnecessary historical commercial-term instructions. [Scope, added calls and remaining live failures](evaluations/qualified-prose-review.md).

## What the evidence establishes

- The three hiring phrasings use persisted conversation fixtures, calendar/timezone resolution, immutable original answers and explicit missing-evidence outcomes. See `tests/judge-conversations.test.ts`.
- Earlier default-model live attachment checks passed 13 targeted PDF/CSV/image journeys, including the owner's report and cross-chat identity. [Scope and limitations](ATTACHMENT_AUDIT.md). This does not mean every arbitrary data type or unlimited attachment is supported.
- The current focused mixed-topic fixture passed **five price outcomes plus five dated releases** with real GPT-OSS model calls and invented vendor evidence. Its prior failures remain visible.
- The last full default capture at `936da48` delivered **50/52 supported factual propositions (96.2%)**, but only **30/40 complete tasks**, with **eight quota-limited cases**. The computed gate is **EXECUTION_LIMITED**. The two-model comparison, source passages, claims and failures are in the [release review](evaluations/release-review.md).
- The 40-case retrieval ablation (0/40 recent, 32/40 lexical/calendar, 40/40 hybrid) measures retrieval, not answer accuracy or superiority over competitors.
- Owner-confirmed physical microphone and VoiceOver/privacy checks are retained. Automated mobile viewports are not physical-device sign-off.

## Still open / explicitly deferred

A quota-unlimited forty-case run of the **current default runtime** remains pending provider capacity. The last full run exposed two qualified-prose failures. The new two-case candidate replay also leaves an unsupported billing gloss and an unnecessary scope clarification; citation/date/model review is not a semantic truth guarantee. No clean current-default release gate, production accuracy or model superiority is claimed.

Physical-mobile testing is deferred by the owner. HubSpot/Salesforce account activation and Shopify remain deferred; Notion is owner-confirmed, with earlier owner-authorized Canva/Gmail checks. Wider OAuth distribution, multi-tenant authentication and public hosting are outside this local workspace release.

[Requirements/evidence matrix](RELEASE_READINESS.md) · [Operating limits and metrics](OPERATING_LIMITS.md) · [Architecture comparison](research/open-source-comparison.md) · [Earlier chronological snapshots](STATUS_HISTORY.md)
