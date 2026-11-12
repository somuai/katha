# Qwen capture review: first 20 cases

Reviewed the first 20 rows for `qwen/qwen3.8-27b` in the 12 November `data/evaluations/answers-reviewed/results.json`, against each saved question, source and correction. This is a qualitative inspection of an older capture, not a current model benchmark. Source IDs below are shortened for navigation; the original capture retains complete IDs. Cases recall-01–08 and memory-08 follow the application's deterministic date-recall path, so their results do not measure Qwen generation. The stored search snippets are incomplete extracts, so conclusions are bounded by captured evidence. No 90% support claim follows.

| Case | Observation |
| --- | --- |
| recall-01 | Original shortlist Alder, Birch and Cedar reproduced verbatim with its source. |
| recall-02 | RiverDB decision and connection-pooling reason reproduced verbatim. |
| recall-03 | Both owners and their roles reproduced verbatim. |
| recall-04 | USD 400 monthly amount and tax exclusion preserved. |
| recall-05 | Twenty sales seats and two viewers preserved. |
| recall-06 | European-region requirement preserved. |
| recall-07 | Postponement and Windows-installer cause preserved. |
| recall-08 | Original-record and quotation guidance preserved. |
| memory-01 | SQLite local-setup reason and single-writer trade-off match cited record `f772b7d4`. |
| memory-02 | Browser disconnection versus explicit cancellation matches cited record `6b55abd3`. |
| memory-03 | Lexical recall while embeddings prepare matches cited record `4ecd9a9d`. |
| memory-04 | Search failure is missing evidence and does not establish stability, as cited `8d8061c4`. |
| memory-05 | Answer's current quota eight is supported by correction `89cb7d9a`, and Europe by original `5703bc62`; however the answer cites only the original, which itself says quota five. The captured citation therefore does not directly support the corrected value. Test current behavior before concluding this remains unfixed. |
| memory-06 | Current Cedar selection and effective date match cited correction `8ae8f9e8`. |
| memory-07 | Cited original supports last recorded quota five. Answer appropriately says it cannot confirm a current value from that record alone. |
| memory-08 | Original shortlist count five reproduced verbatim, with source. |
| web-01 | WAL reader/writer concurrency and one-writer limit are supported by cited excerpt `7c80c156`. |
| web-02 | Source `354b7a45` describes a historical default and cautions against assuming it; the answer's unqualified claim that enforcement must always be enabled overstates the conclusion for builds with different defaults. |
| web-03 | Source `7549e2ed` supports the statement-start snapshot for other transactions; the answer's absolute “only” omits visibility of the transaction's own previous updates and does not mention different snapshots on successive SELECTs. |
| web-04 | Source `b838e8dd` supports one/two search credits. The additional extraction-price detail is also in the source, but was unnecessary for the question. |

The correction-citation mismatch deserves a regression at the Turns interface: a user inspecting a corrected current assertion should be able to reach the correction that establishes it, rather than only the superseded value. Other notable quality gaps are omitted qualifications and irrelevant but supported details. This review does not score the remaining cases, independently verify provider pages as they exist today, or establish representative accuracy.
