# Daily-token quota diagnosis — 14 November 2026

[Captured turns and sanitized provider guidance](quota-diagnostics-reviewed.json) · [metrics](quota-diagnostics-metrics.json).

Runtime `fd37213` fixes parsing of compound provider delays (days/hours/minutes/seconds/milliseconds). A public-Turn regression first failed because `1h2m3.5s` entered a premature short retry. It now promptly terminates the turn with the existing two-minute wait-limit explanation; `2m1s` and `1d3h` are covered too. Numeric/date Retry-After headers retain precedence. Original evidence, cancellation and source-only recovery policies are unchanged. Local tests: 268 pass, plus type checking, lint and production build.

A three-token capacity probe succeeded, but that did not establish capacity for a normal answer. The two targeted full-size generations were rejected with HTTP429 and an explicit **daily_tokens** classification. Provider body guidance was `2m35.952s` and `7m19.776s`; Retry-After headers requested 156 and 440 seconds. Both exceed the permitted wait. One case failed with no answer; one retained a labelled evidence-only partial response. Neither is credited as task completion or factual support. Planning succeeded before generation was rejected.

The evaluator now records only whitelisted quota classification and duration/numeric Retry-After guidance. It excludes raw error messages, account identifiers, authorization headers, provider reasoning and secrets. These observations explain why a small request can succeed while a larger release evaluation cannot. They do not predict exactly when enough account capacity for a complete forty-case run will exist.

This is a separate diagnostic capture, not a recovery substituted into the previous full evaluation. The current-default full gate remains open. No paid overage, silent model substitution, deferred connector activation or physical-mobile test is introduced.
