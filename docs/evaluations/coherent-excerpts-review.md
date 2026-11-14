# Evidence-context and citation follow-up — 14 November 2026

## What changed

Runtime `a251224` preserves short web parameter descriptions alongside their value/limitation sentences, retains definition labels, and excludes recognized documentation-shell configuration from model excerpts. Original observations remain unchanged. This fixes two real-source/public-Turn regressions: losing MDN's exception branch and losing Tavily's `max_age_hours=0` meaning. Private PDF/CSV selection is unchanged.

Explicit Unicode, ASCII and internal-link citation forms now share one parser across validation and rendering. Known inline references become canonical citations; unknown references still fail or receive the existing bounded repair. Code examples are not citations. Source-prefixed references cannot bypass quotation validation. A conceptual question about what a price observation can prove now stays on the explanation path; actual dated vendor-price comparisons retain their verification checks.

## Full text-candidate observation before this fix

[Forty-case ledger](candidate-f87358e-reviewed.json) · [computed metrics](candidate-f87358e-metrics.json).

Frozen runtime `f87358e`, GPT-OSS120B: **50/51 supported factual propositions (98.0%), 34/40 tasks (85%), one execution failure**. The gate remains **EXECUTION_LIMITED**. The failure was a missing required citation after bounded review/repair. The unsupported statement assigned an insecure-context API removal to Firefox 68, although its release notes describe a future removal. Three anonymous-capability cases asked for an entity clarification; they remain task failures rather than guessed successes. A conceptual price question was misrouted into commercial-term validation.

These are real model calls with reused, timestamped public documentation and labelled synthetic private/vendor records. They are not fresh search-discovery results, a default-model pass, production accuracy, or an independent review. Mixed deterministic/model turn medians are not model latency claims. Historical failures remain preserved; no successful cases from later attempts replace them.

## Targeted live check after the fix

[Two-case ledger](coherent-excerpts-reviewed.json) · [computed metrics](coherent-excerpts-metrics.json).

Runtime `a251224`, same text candidate and frozen observations: both executions completed. The freshness question correctly explains zero/live fetching, best-effort free-tier behavior, 434 capacity errors, omitted stale results and latency/credit qualifications. The conceptual question now answers instead of misrouting, **but invents a date-filter requirement and overstates what publication/update dates prove about a price change**. The reviewer approved it. Strict review: **4/6 supported factual propositions, 1/2 tasks**; this subset is not a release gate and does not establish the remaining semantic issue is solved.

The current default Qwen forty-case run is still pending provider capacity. It remains the default; the text-only candidate is not an image fallback. No paid quota or provider substitution is enabled. These new ledgers are coding-agent reviewed; prior owner sign-off does not automatically cover them.

## Verification

267 deterministic tests, type checking, lint and production build pass locally. Chromium upload/correction/conversation/responsive/accessibility regression passes. Cross-platform/browser workflow for `a251224`: [CI run](https://github.com/somuai/katha/actions/runs/43553087796). See its individual job outcomes rather than assuming an unfinished workflow passed.

## Explicit timestamp-contract follow-up (`dea37e2`)

Generation and review now explicitly separate publication/update, retrieval and effective-change timestamps; date filtering is not a price-history API. Both targeted executions completed with reused evidence. The [text candidate](date-contract-reviewed.json) still incorrectly says a live fetch or explicit date metadata establishes when a price was set (2/3 supported facts, task failed). The [unchanged Qwen default](date-contract-default-reviewed.json) correctly limits its explanation to the supplied freshness/date-filter documentation and labels the observation-versus-change inference (3/3 supported facts, task passed). Neither one-case result is a full gate, and no candidate/default answer is substituted into an earlier run.

The default's capacity returned during this check. A new complete forty-case default run is underway at `dea37e2`, with its own output directory and manifest. Its outcome and review must be inspected before the release gate can be assessed.
