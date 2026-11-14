# Katha status — 14 November 2026

MiniMi chat-agent project. Local preview: http://localhost:3000/ . Public source: https://github.com/somuai/katha . This is separate from the Wispr portfolio; no Katha public multi-user deployment is claimed.

## Latest implementation

Runtime `6bc98c8` passes **250 automated tests**, TypeScript, formatting lint and production build locally. The Chromium regression passes upload, original/correction inspection, a saved-chat linked retry with original attachments, keyboard dismissal, responsive viewports and automated accessibility checks. Compact inline source controls hide technical IDs; historical answers can open their own evidence/audit view. The preview responds successfully.

The latest changes prevent a second workspace process from interrupting the owner's active work; recover committed turns after process termination; make deliberate retries fresh, linked and deletion-safe; restore observation of active chats; prevent the user question appearing as an assistant snapshot; label missing-model responses partial; and allow one search-plan shape repair. Prior selected-document, quote, mixed-topic comparison, date-validation and usage-accounting fixes remain in place.

Cross-platform/browser CI for answer engine `936da48` passed all six jobs: [Windows/Linux/macOS and Chromium/Firefox/WebKit](https://github.com/somuai/katha/actions/runs/43544854530). The latest citation UI also [passes all six jobs](https://github.com/somuai/katha/actions/runs/43545957892). The engine/evaluation implementation hash still exactly matches the captured current-default run; UI files are validated separately.

## What the evidence establishes

- The three hiring phrasings use persisted conversation fixtures, calendar/timezone resolution, immutable original answers and explicit missing-evidence outcomes. See `tests/judge-conversations.test.ts`.
- Earlier default-model live attachment checks passed 13 targeted PDF/CSV/image journeys, including the owner's report and cross-chat identity. [Scope and limitations](ATTACHMENT_AUDIT.md). This does not mean every arbitrary data type or unlimited attachment is supported.
- The current focused mixed-topic fixture passed **five price outcomes plus five dated releases** with real GPT-OSS model calls and invented vendor evidence. Its prior failures remain visible.
- The current-default forty-case capture delivered **50/52 supported factual propositions (96.2%)**, but only **30/40 complete tasks**, with **eight quota-limited cases**. The computed gate is **EXECUTION_LIMITED**. The two-model comparison, source passages, claims and failures are in the [release review](evaluations/release-review.md).
- The 40-case retrieval ablation (0/40 recent, 32/40 lexical/calendar, 40/40 hybrid) measures retrieval, not answer accuracy or superiority over competitors.
- Owner-confirmed physical microphone and VoiceOver/privacy checks are retained. Automated mobile viewports are not physical-device sign-off.

## Still open / explicitly deferred

A quota-unlimited forty-case run of the **current default runtime** remains pending provider capacity. The current run also exposes two qualified-prose failures; citation/date validation is not a semantic truth guarantee. No clean current-default release gate, production accuracy or model superiority is claimed.

Physical-mobile testing is deferred by the owner. HubSpot/Salesforce account activation and Shopify remain deferred; Notion is owner-confirmed, with earlier owner-authorized Canva/Gmail checks. Wider OAuth distribution, multi-tenant authentication and public hosting are outside this local workspace release.

[Requirements/evidence matrix](RELEASE_READINESS.md) · [Operating limits and metrics](OPERATING_LIMITS.md) · [Architecture comparison](research/open-source-comparison.md) · [Earlier chronological snapshots](STATUS_HISTORY.md)
