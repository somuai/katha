# Katha and adjacent open-source assistants

Checked 13 November 2026 against the primary sources linked below and this checkout. This is an architectural comparison, not a deployment audit or head-to-head benchmark. Documentation can change; an unconfirmed capability is not an absent capability. No competitor was installed or evaluated on Katha's fixtures.

## Positioning

Katha's defensible distinction is a narrow, explicit record contract: retrieve the original dated evidence, distinguish subsequent corrections from the original quotation, and prevent deleted evidence from reappearing through unfinished work. Its implementation and deterministic tests make that contract inspectable. This does not establish higher general answer quality than the projects below. See [DESIGN](../../DESIGN.md), [core implementation](../../src/core/index.ts), and [contract tests](../../tests/core.test.ts).

LibreChat and Open WebUI already offer persistent chat, memory management, web citations, and generation that survives a browser disconnection. Open WebUI also exposes model-controlled chat-history retrieval with timestamp parameters. These capabilities must not be presented as unique to Katha. Vane emphasizes a self-hosted answering engine with search modes and source selection. The former Perplexica repository now resolves to Vane; the [maintainer's announcement](https://github.com/ItzCrazyKns/Vane/discussions/1108) confirms the rename.

## Original records and temporal recall

| Project | Verified mechanism | Implication for this comparison |
| --- | --- | --- |
| Katha | Calendar constraints in an IANA timezone, lexical and local embedding ranking, neighboring evidence, original-record retrieval, and a turn acceptance cutoff separate from correction effective time. | Its retrieval path directly represents both when evidence applies and what evidence existed when a turn was accepted. See [temporal parser](../../src/core/temporal.ts), [core](../../src/core/index.ts), and date/cutoff cases in [tests](../../tests/core.test.ts). |
| LibreChat | [Message Search](https://www.librechat.ai/docs/features/search) searches saved conversation titles, tags, and message text through Meilisearch; chat-list date filters are separate. [User Memory](https://www.librechat.ai/docs/features/memory) stores structured key/value entries and explicitly distinguishes itself from semantic search over conversation history. | It already retrieves past message text. Katha's direct local hybrid evidence retrieval differs from the documented search/memory split; this is not proof that LibreChat cannot be extended to implement the same policy. |
| Open WebUI | [History tools](https://docs.openwebui.com/features/extensibility/plugin/tools) include text-based `search_chats` with `start_timestamp`/`end_timestamp` and `view_chat`; the latter reports truncation when configured limits cut history. | Dated, model-controlled original-chat access already exists. The reviewed docs do not establish Katha-style record effective-time/cutoff semantics; date filtering alone does not establish those semantics. |
| Vane | Its [architecture](https://github.com/ItzCrazyKns/Vane/blob/master/docs/architecture/README.md) describes stored chats/messages and semantic retrieval over uploaded files. | Saved history and document retrieval are documented. Equivalent cross-chat temporal reconstruction was not verified in these sources. |

## Corrections, lineage, and deletion

Katha retains the original text while creating linked whole-record or sentence-assertion corrections with effective dates. It rejects replacements that would strand scheduled corrections. Deletion invalidates dependent answers, cancels active work, and changes a workspace epoch checked before late results publish. Permanent removal purges source content and associated indexes. These are inspectable policies, not claims that generated assertions are verified facts. See [core](../../src/core/index.ts), [correction citation tests](../../tests/correction-citation.test.ts), and [deletion/correction race tests](../../tests/core.test.ts).

LibreChat documents manual memory entry edits/removal, optional automatic extraction, and explicitly requested agent `set_memory`/`delete_memory` operations in its [memory guide](https://www.librechat.ai/docs/features/memory). Open WebUI documents user-managed memories and native add/update/replace/delete tools in [Memory & Personalization](https://docs.openwebui.com/features/chat-conversations/memory); it also documents [chat deletion/export](https://docs.openwebui.com/features/chat-conversations/chat-features/history-search). Neither reviewed guide establishes effective-dated correction lineage or deletion-race invalidation equivalent to Katha's contract. That is an evidence limit, not a security finding or an assertion that their implementations lack safeguards. Vane's reviewed architecture does not settle these questions either.

Katha's advantage for this workload is that these particular consistency rules are first-class and testable together. The trade-off is substantial policy complexity: scheduled corrections, supersession, invalidated dependencies, and historical queries must remain mutually consistent.

## Execution and reconnect

| Project | What is established | Boundary |
| --- | --- | --- |
| Katha | SQLite stores accepted inputs, request identity, sequence, events, and terminal status; event replay and deletion/cancellation races have contract cases. | Browser disconnect does not cancel execution. Process restart retains history but marks unfinished turns `INTERRUPTED`; it does **not** transparently resume provider execution. Single-process SQLite is not a distributed workflow engine. [Implementation/tests](../../tests/core.test.ts). |
| LibreChat | [Resumable Streams](https://www.librechat.ai/docs/features/resumable_streams) continue server-side across disconnects and replay when users return. Redis supports cross-instance stream resumption. | The guide explicitly says generation stops if its server process stops. Single-instance streams use memory. |
| Open WebUI | [Event documentation](https://docs.openwebui.com/features/extensibility/plugin/development/events) describes background asyncio execution independent of HTTP/Socket.IO connection and database persistence for supported event types. | Connection survival is documented; automatic restart recovery of in-flight generation was not established here. |
| Vane | [Architecture](https://github.com/ItzCrazyKns/Vane/blob/master/docs/architecture/README.md) documents stored conversation reload. | This alone does not establish in-flight replay, request idempotency, or crash recovery; those remain unverified. |

Persisted records, replayable events, reconnecting clients, and crash-resumable computation are different guarantees. Katha should describe its exact guarantee instead of claiming durable execution as an exclusive feature.

## Web evidence and tool boundary

LibreChat's [web search](https://www.librechat.ai/docs/features/web_search) lets the model search, read returned pages, and cite them. Open WebUI's [native agentic search](https://docs.openwebui.com/features/chat-conversations/web-search/agentic-search) separates discovery from fetched evidence: search hits alone do not become citations; the model opens a page through `fetch_url`. Its legacy retrieval path behaves differently. Vane's [README](https://github.com/ItzCrazyKns/Vane/blob/master/README.md) documents SearxNG, local/cloud model options, speed/balanced/quality modes, domain restrictions, source categories, and cited answers.

Katha constrains the reasoning loop to `web_search`; selected connector records enter as explicit imports. It validates returned source IDs and structured dated-change evidence, preserving the distinction between a current observation and evidence of when a change occurred. See [provider adapters](../../src/providers/index.ts), [dated evidence](../../src/core/dated-evidence.ts), [commercial terms](../../src/core/pricing.ts), and [provider tests](../../tests/providers.test.ts). This focused boundary reduces integration ambiguity for the target task, but sacrifices broader autonomous browsing/tools. Citation existence and structural validation still do not prove every narrative claim is supported.

## Evaluation and claims allowed

Katha reports a 40-case synthetic original-source top-five retrieval ablation: recent-context 0/40, calendar/lexical 32/40, hybrid 40/40. The corpus intentionally puts relevant records before recent distractors; this is a stress test, not a traffic estimate or competitor benchmark. The [evaluation notes](../evaluations/README.md) distinguish retrieval, execution completion, task success, reviewed support, and quota failures. The live 90% supported-claim gate remains unverified; see [status](../STATUS.md).

Open WebUI has a documented [evaluation system](https://docs.openwebui.com/features/administration/evaluation) using model comparisons, user ratings, and Elo rankings. Such preference rankings answer a different question from temporal source recall or claim support. A comparable temporal benchmark for LibreChat or Vane was not established in the sources reviewed; no quality ordering follows from that gap.

Safe claim: **Katha implements an explicit temporal-record and correction/deletion contract, with reproducible local fixtures.** Unsupported claims: best memory, uniquely durable chat, better grounded answers than these projects, production accuracy, lower latency, or superiority derived from their documentation gaps.

To establish a comparative result, run all systems on the same consented corpus and dated questions, record versions/configurations, distinguish unsupported answers from useful abstentions, test disconnect/restart/deletion separately, and independently review source support. Report failures and coverage alongside scores.
