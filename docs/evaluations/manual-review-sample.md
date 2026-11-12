# Manual evidence review: five captured web answers

Reviewed from `data/evaluations/answers-reviewed/results.json`, Qwen candidate, captured 12 November 2026, against the stored source excerpts and fixture questions. This small convenience sample predates subsequent routing changes and is **not** an independent or representative estimate of end-to-end accuracy. Source text and detailed run data remain local. No claim of 90% support is made.

| Case | Judgment | Evidence and qualification |
| --- | --- | --- |
| web-01, SQLite WAL | Supported; task answered | The cited excerpt supports concurrent readers and one writer, and the one-writer restriction. |
| web-02, SQLite foreign keys | Qualified | The cited excerpt describes per-connection settings and the historical default. The answer's opening "must be enabled" overstates this when a build changes the default; checking or setting the per-connection state is the safer wording. |
| web-03, PostgreSQL Read Committed | Qualified | The excerpt supports the statement-start snapshot for other transactions, but also says a SELECT sees its own transaction's prior updates. The answer's unqualified "only sees data ... committed" omits that exception. It also does not mention successive queries can see different commits. |
| web-04, Tavily search credits | Supported, with unnecessary detail | The cited excerpt supports one and two credits for basic and advanced search. The extra extract-pricing statement is supported by the excerpt but outside the requested comparison. |
| web-05, Tavily freshness | Supported; task answered | The captured excerpts support live fetching at zero, omission when live retrieval fails, and best-effort/434 behavior on non-paying plans. This is a dated snapshot, not a current pricing or availability guarantee. |

These are qualitative notes, not approved claim-level annotations in `results.json`. The existing metrics correctly continue to report `NOT_REVIEWED`; no reviewed percentages or model winner follow from this sample. A complete audit must score every atomic factual claim and task outcome, include the second candidate, preserve failures and omissions, and identify the exact supporting evidence.

## Additional ten captured answers

These notes use the retained excerpts for the particular answer, not the other candidate's citations. A sound abstention and a failed execution are distinguished from a supported answer.

| Candidate / case | Judgment | Evidence and qualification |
| --- | --- | --- |
| Qwen web-06, EventSource | Evidence-limited abstention | No retained excerpt contains a statement about reconnect or retry. The response reasonably declines to assert automatic reconnect, but does not answer the original question. This identifies a retrieval gap rather than proving EventSource does not reconnect. |
| Qwen web-07, microphone | Supported with version detail | The `ec525f69` excerpt supports the secure-context, localhost and undefined-`mediaDevices` points. `30297e1d` supports the separate Firefox 68 release-note statement; error details should stay tied to that version. |
| Qwen web-08, price-change date | Sound inference; incomplete sourcing | A snapshot alone cannot identify the date of a change, but the answer supplies no citation marker and does not explicitly label the reasoning as inference. A baseline by itself may bound a change without establishing its exact date. |
| GPT-OSS web-01, SQLite WAL | Failed execution | The captured turn has status `FAILED`, an empty answer and no sources. It cannot be counted as a supported answer or given useful-answer latency. |
| GPT-OSS web-02, SQLite foreign keys | Qualified | The `6ede5362` excerpt supports the historical default and per-connection control. The categorical wording misses builds whose default is configured differently. |
| GPT-OSS web-03, PostgreSQL | Qualified | The `3e3c7295` excerpt supports statement-start snapshots and the response notes successive SELECTs can differ. Its blanket exclusion of uncommitted rows omits the transaction's own preceding writes, an exception the excerpt starts to describe. |
| GPT-OSS web-04, Tavily search credits | Core comparison supported; extra wording ambiguous | The `02ae495f` excerpt supports one versus two credits per search request and separate Extract pricing. The response adds an unrequested extraction statement that could be read as implying every search incurs an extra extraction charge; the supplied excerpt does not establish that. |
| GPT-OSS web-05, Tavily freshness | Partial answer; no citation | The `7c428a90` excerpt supports live fetch and the free-plan 434 limitation. The answer omits the fixture's expected note that inaccessible results may be omitted and supplies no citation marker despite the citation request. |
| GPT-OSS web-06, EventSource | Evidence-limited abstention | None of its retained excerpts explicitly says reconnect or retry, so its refusal to assert the fact is grounded in the captured evidence. It does not satisfy the user's original factual question. |
| GPT-OSS web-07, microphone | Core answer supported; exception caveat | `ea0212c4` supports secure contexts and undefined `mediaDevices`; `6fba7d4d` is specifically a Firefox 68 release note for `NotAllowedError`. The current MDN excerpt mentions `TypeError`, so the response's general opening should not suggest one universal exception across browsers. |

Together with the first five entries, these are **15 qualitative answer reviews**, not a full dataset review and not a numerical accuracy score. No entries were written into `results.json`; task success, supported-claim precision and the 90% gate remain unreviewed at the full-run level.
