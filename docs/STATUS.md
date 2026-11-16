# Katha implementation and release status — 16 November 2026

Katha is the MiniMi chat agent, separate from the Wispr portfolio. The historical full answer evaluation is pinned to runtime `fd37213` / tested checkout `3960ef9`; the changes below are newer. The repository and source remain public at https://github.com/somuai/katha.

## Latest changes — 16 November

- **291 deterministic tests**, TypeScript, lint and production build pass for the updated working tree.
- CSV totals and date filters, explicit web routing, contributor/pronoun evidence selection, selected-file isolation, and bounded incomplete-answer repair have new regression coverage.
- An explicit `Remember:` statement now acknowledges its committed original note rather than asking a model whether an older copy exists. The README GIF records a real saved shortlist and model-backed recall in an isolated workspace.
- The [fresh multimodal audit](evaluations/multimodal-2026-11-16.md) retains both original failures and targeted reruns. Its captures belong to their stated working-tree fingerprints; they do not rescore the historical 40-case evaluation.
- Check GitHub Actions for the submitted commit. Historical green jobs do not establish the status of a later push.

- [Data-handling hardening](evaluations/data-hardening-2026-11-16.md): bundled local English OCR for dense text/scans, validated CSV analysis plans, semantic result tables, image-interpretation caching and shared provider cooldowns. Five live CSV checks pass; the applied computation is inspectable. This does not remove external quota limits or establish universal OCR/analytics correctness.

## Historical release evidence

- **268 deterministic tests**, TypeScript, lint and production build pass.
- All six Windows/Linux/macOS and Chromium/Firefox/WebKit CI jobs pass for the runtime and tested checkout.
- The [complete current-default evaluation](evaluations/default-fd37213-evening-review.md) records **59/63 supported factual claims (93.7%), 37/40 tasks and zero execution errors**. All forty cases are recorded and coding-agent reviewed; the agreed 90% fixed-evidence gate passes.
- Three ordinary web tasks fail strict review. Their unsupported/unverifiable details remain in the score. No perfect, production or independently certified accuracy is claimed.

[Requirements-to-evidence matrix](RELEASE_READINESS.md) · [Attachment audit](ATTACHMENT_AUDIT.md) · [Operating limits](OPERATING_LIMITS.md) · [One-page design](../DESIGN.md).

## Retained limitations and deferrals

The full evaluation uses actual model calls with frozen public documentation and labelled synthetic records; it is not fresh market discovery or a head-to-head competitor benchmark. Same-model qualification review can miss semantic errors. Independent review of the new capture and broader multilingual memory remain future work. File interpretation and source excerpts have the documented bounds; CSV is not arbitrary database analysis.

Owner-confirmed VoiceOver/privacy and physical microphone checks retain their prior scope. Physical-mobile testing and HubSpot/Salesforce/Shopify activation remain explicitly user-deferred. Optional connections import user-selected records; the model-controlled tool remains web search. No public multi-user deployment or hiring-form submission was performed.

## Historical failures remain visible

The [preceding full default run](evaluations/default-fd37213-review.md), [earlier default run](evaluations/default-dea37e2-review.md), [quota diagnosis](evaluations/quota-diagnostics.md), [text-candidate and targeted checks](evaluations/coherent-excerpts-review.md), and [older release ledger](evaluations/release-review.md) retain their original failures and revision/source identities. They are not rescored or combined with successful cases from this run.
