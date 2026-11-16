# Katha glossary
- **Conversation:** ordered user and assistant messages.
- **Turn:** one accepted user submission and its execution.
- **Source:** retained original message, attachment, or web observation.
- **Baseline:** historical statements selected for verification.
- **Observation:** evidence obtained at a known time, not proof of a change date.
- **Correction:** a new source that clarifies a past record or changes it from now.
- **Verification:** a source-backed comparison of a baseline with current evidence.

- **Connection**: a user's authorization for Katha to read selected material from an external provider.
- **Import selection**: the particular external records a user chooses to retain as sources; distinct from the broader permission granted by the provider.
- **Routing**: choosing retained evidence, current external evidence, or both for a question.

- **Document reference**: a contributor name resolved from a literal user mention and a retained document, linked to that message and document version; not an inferred identity or an assistant assertion.

- **Qualification review**: a bounded same-model check of provisional web prose for factual support and source version/environment caveats. It is distinct from a temporal verification and is not independent proof of semantic correctness.

- **Segment:** a located excerpt extracted from a retained source, with its source locator and preparation state.
- **Assertion:** a source-linked subject/predicate/value statement used for recall, correction and comparison.
- **Correction operation:** `CORRECT_PAST_RECORD` clarifies a past assertion; `CHANGE_FROM_NOW` appends a change with its effective date. Neither overwrites the original.
- **Recorded time:** when Katha learned material; distinct from its event time, web observation time, publication time and effective-change time.

- **Analysis plan:** a bounded description of the filters, grouping, ordering and calculation requested for a retained dataset; distinct from the resulting computed values.
- **Derived interpretation:** machine-read or model-described material linked to an original source; it can be incomplete or incorrect and does not replace that original.
