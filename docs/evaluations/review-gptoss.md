# GPT-OSS: review of the first 20 captured cases

Reviewed `openai/gpt-oss-120b` results in `data/evaluations/answers-reviewed/results.json` against the corresponding inputs in `evaluations/answer-cases.json`, retained source content, correction timestamps, and recorded terminal states. This is a qualitative review of the first 20 cases in fixture order, captured 12 November 2026, before later routing changes. It is not an independent, comprehensive evaluation of 40 cases or a claim-support percentage. Raw records and detailed source IDs remain local. No labels in the captured results were changed.

| Case | Finding | Evidence / limitation |
| --- | --- | --- |
| recall-01 | Original reproduced | Retained record contains Alder, Birch and Cedar, all quoted with a source link. |
| recall-02 | Original reproduced | Retained record states RiverDB and connection pooling, both quoted with a source link. |
| recall-03 | Original reproduced | Record names Nisha and Kabir and associates them with the two tasks; answer quotes it. |
| recall-04 | Original reproduced | The USD 400 monthly budget and exclusion of tax are quoted. |
| recall-05 | Original reproduced | Twenty sales seats and two viewers are quoted. |
| recall-06 | Original reproduced | European-region requirement is quoted. |
| recall-07 | Original reproduced | Postponement and the failed Windows installer are quoted. |
| recall-08 | Original reproduced | The original-record and quotation instruction is quoted. |
| memory-01 | Supported; small inference | Local judge setup and one writer are in the record. Avoiding external database dependencies is a reasonable inference, not an explicit statement of the record. |
| memory-02 | Supported | The retained record states disconnect detaches the observer and explicit cancellation stops the turn. |
| memory-03 | Supported; missing citation | The answer quotes the record's lexical-while-embedding behavior, but includes no clickable citation marker despite retaining a source. |
| memory-04 | Supported | The answer states that search failure means missing evidence and does not establish unchanged status, with a source marker. |
| memory-05 | Supported current interpretation | The selected correction makes quota eight effective 10 November; the region remains Europe. Both sources are available in the recorded result. |
| memory-06 | Supported current interpretation; missing citation | The selected correction says Cedar is selected; the answer omits a source marker. |
| memory-07 | Supported as of run time; missing citation | The quota of five remains current on 12 November because the quota-nine correction is effective 15 November. The answer omits a source marker; the review checks the original fixture's scheduled correction as well as the retained source. |
| memory-08 | Original reproduced | The question explicitly asks for the original. The answer quotes five vendors without substituting the later correction. |
| web-01 | Failed | Terminal status FAILED with provider HTTP 400 and no answer. This is an execution failure, not a supported or unsupported answer claim. |
| web-02 | Incomplete qualification | Cited SQLite excerpt states the historical default and also explicitly warns against assuming it. The answer states foreign keys are disabled by default and must be enabled, without noting builds/defaults may differ; checking or setting the per-connection state is safer. |
| web-03 | Incomplete qualification | The cited source supports statement-start snapshots for changes by other transactions and successive SELECTs seeing different commits. The answer says the snapshot excludes uncommitted rows without mentioning that a transaction sees its own prior updates. |
| web-04 | Main comparison supported; extra claim | The cited excerpt supports basic search costing one and advanced search two credits. The extraction discussion is outside the requested comparison; the excerpt describes Tavily Extract, so treating it as an additional charge on every search would be unsupported. |

The eight exact-date recall cases return retained text deterministically; they are not independent tests of GPT-OSS generation. The remaining cases test only these synthetic histories and saved web excerpts. Missing citations and missing qualifications matter separately from whether source text was retrieved. A complete claim-level audit must cover all 40 cases for both candidates and record claim-level verdicts and task outcomes before an accuracy gate can be computed.
