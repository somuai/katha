# Source-qualification follow-up — 14 November 2026

This is a two-case text-candidate follow-up, not a default-model or forty-case release gate. [Reviewed current capture and preserved earlier attempts](qualified-prose-reviewed.json) · [computed metrics](qualified-prose-metrics.json).

## Runtime changes and deterministic proof

Runtime `caa68c2` retains the host's existing `verification` decision through the provider adapter. Ordinary explanations require an empty temporal-comparison array and bypass historical offer parsing. This fixes two public-turn regressions: ordinary API credit explanations being replaced by “cannot establish a change”, and current-price explanations being diverted into an unasked historical difference.

Selected version-risk web prose receives a bounded same-model qualification review. Six real-SQLite/public-Turn fixtures cover correction before publication, shared repair exhaustion, quota resumption without regenerating the draft, Stop during review, ordinary-answer path repair and the historical offer shortcut. There are 256 passing local tests, plus type/lint/build checks.

The review heuristic and same-model reviewer are not independent semantic certification. Ordinary prose now uses a shorter prompt without unused historical price schemas. The evaluator records actual model HTTP phases and whitelisted aggregate usage, excluding headers and provider reasoning fields.

## Live observations

- Default Qwen, `3b9f97a`: both targeted cases failed the existing provider quota before generating answers. No support or successful task is credited. The default has not changed.
- GPT-OSS candidate, `3b9f97a`: both turns completed, but the credit question became an irrelevant temporal-comparison refusal. This exposed the dropped host answer-path decision.
- GPT-OSS candidate, `df6b957`: the credit question answered its core costs and the microphone answer had the correct secure-context rule. One actual qualification-review request was observed for the microphone answer. The credit response also included an unlabelled causal gloss. The second turn included a roughly minute-long quota wait.
- GPT-OSS candidate, `caa68c2`: the credit question correctly states one/two credits, the free allowance and qualified paid rates, but adds an unestablished pay-as-you-go balance mechanic. The microphone question returns an optional specific-browser-versus-general preference question instead of the already requested general answer.

The strict current subset review reports **6/7 supported factual propositions (85.7%) and 0/2 complete tasks**. Neither optional clarification nor safe nonanswers count as task completion. The two original version-specific assertions did not recur in the latest capture, but one question was not answered; this does not establish that both original failures are fixed.

In the comparable completed credit case, generation input fell from 2,132 to 1,502 reported tokens after prompt separation. This is one observation, not a latency or quality benchmark. The latest microphone turn cannot support a useful-answer speed claim because it asked a clarification rather than answering.

## Remaining work

The default's quota-unlimited forty-case evaluation remains pending. Two additional concrete issues are now recorded: optional presentation-scope clarification blocking a factual web answer, and an unestablished billing gloss outside the version-risk selector. A broader prose-review policy or better clarification control needs public-interface tests and live review; no success is inferred from intent or an extra model call.

No paid tier, new provider key, silent default substitution, deferred connector activation or physical-mobile test is introduced here.
