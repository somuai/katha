# Katha — remember the record, verify the change

**Problem.** A useful assistant must distinguish what I said, what I later corrected, and what changed outside the conversation. Similarity alone cannot establish chronology; current pricing alone cannot establish when it changed.

**Design.** One Node process owns a SQLite workspace. Two deep modules expose durable Turns and an Evidence Library. Original messages and text indexes commit before acceptance; local MiniLM embeddings enrich recall asynchronously. Retrieval combines calendar constraints, FTS, vector ranking, neighbors and source-linked corrections. Time is interpreted in an IANA timezone using half-open intervals; event time and ingestion time stay separate.

Each turn has an idempotent request identity, ordered conversation sequence, context cutoff, persistent events and terminal status. Disconnecting SSE does not cancel execution; explicit Stop does. Deletion increments an epoch, cancels active work and invalidates dependencies so late callbacks cannot restore removed evidence. Network work never runs inside SQLite transactions.

**Web verification.** The sole model-visible tool is web_search. The host constrains concurrency, attempts, timeouts, credits and returned evidence. Groq inference and Tavily search are injected external adapters; both have fixture adapters for deterministic tests. Comparisons distinguish current matches, unknown change timing, dated changes, conflicts and insufficient evidence. The model returns stored source IDs; unsupported citation IDs fail validation. Structured records are presented after validation, with honest progress rather than simulated token streaming.

**Trade-offs.** SQLite keeps judge setup local but supports one writer; native bindings require a supported Node version. A hosted open-weight model has free quotas, not unlimited capacity. Local embeddings add first-run download cost but no embedding API dependency. A generic workflow engine, remote vector database, and autonomous scraper were rejected as complexity without evidence of benefit. Scanned PDFs require model-derived interpretation and are labeled accordingly.

**Evidence and limits.** See tests and docs/STATUS.md. Offline passes do not demonstrate live grounding quality. Missing keys leave source retention and deterministic recall available. No P99, production accuracy or provider-comparison result is claimed without measurement.

**Another week.** Expand the hand-reviewed temporal evaluation, inspect false change claims, improve typed entity/price normalization and compare model candidates against captured evidence. Prioritize observed failures over adding tools.
