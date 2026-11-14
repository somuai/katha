# Local operating limits

These are application limits, not promised provider quotas. They apply to one local Node process; they are not distributed account-level enforcement.

| Capability | Current application control |
| --- | --- |
| Model inference | Serialized requests, 20 requests per rolling minute, at least one second between dispatches, 7,000 estimated tokens per minute reconciled against reported usage, 30-second request timeout |
| Transcription | Six dispatched requests per rolling minute; upstream 429 cooldown honored; aborted requests do not consume the local allowance |
| Turns | One executing turn per conversation, two conversations active globally; at most 32 pending turns; 60 seconds active time and up to 120 seconds quota waiting |
| Web search | Three concurrent requests, twelve attempts per turn including retries, twelve-second request timeout, persistent 800-call monthly application budget |
| Search cache | Fifteen minutes; explicit freshness bypasses cache; original observation timestamp preserved; expired entries pruned and disposable caches capped at 1,000 entries |
| Connections | Six authorization/import operations per minute, thirty listings per minute, twelve callbacks per minute; success-only thirty-second listing cache with request coalescing |

Search-call budgets should not be read as guaranteed billing credits across all providers or search depths. Cached or coalesced responses still count toward the incoming connection request limit. Limits and caches stored in memory reset on restart; the monthly search budget is stored in SQLite. API keys may have additional usage outside this process. A rejected model dispatch with HTTP 429 releases its unused token reservation; RPM accounting remains conservative. Provider Retry-After values are preserved, including waits longer than the turn's quota-wait allowance. The turn fails explicitly instead of retrying before the provider permits it.

HTTP ingress additionally limits turn submissions to 30/minute and uploads to 12/minute per client IP, before body processing. State is bounded to 1,024 active client/bucket entries. Read, cancellation and SSE routes remain available. Rejections expose HTTP 429 and Retry-After.

Selected attachments (including eligible follow-ups) are promoted ahead of unrelated workspace hits. Both selected-file and ordinary recall paths apply the same effective correction interpretation and acceptance cutoff. Correction traversal is bounded to 128 linked records and rejects cycles or excessive chains explicitly. Original quotation mode retains original text.

Explicit/attributed quotations are checked against retained source text (normalizing layout whitespace and apostrophe typography). Unknown citation IDs, omitted explicitly requested citations, and invalid quotations share a maximum of one repair attempt per scoped provider assessment. Missing historical/current links in a comparison use that same allowance; a repair never creates a baseline. Invalid repairs fail closed. This is a narrow string/provenance check, not semantic verification of arbitrary prose. It does not certify that a valid citation entails every generated claim.

Search requests ask for page text. When available, a query-ranked raw-page excerpt is retained instead of the shorter search snippet, up to 12,000 characters from a 200,000-character candidate buffer. If raw text is unavailable, the snippet remains explicitly identified. Passage budgets include separators; URL destinations do not score as visible prose, ordinary plural matching is supported, and conceptual questions down-rank incidental code. Source inspectors retain the extraction method. This is bounded evidence selection, not a guarantee that every exception or page detail is present.

Verification prose is rendered from validated comparisons. Rejected effective-date claims are removed from prose and date fields; a dated passage about a different feature cannot date a price change.

Mixed pricing/release questions keep separate assessments. Explicit offer parsing can establish a price comparison but cannot short-circuit the requested release check. Missing per-vendor topics are exposed as UNVERIFIED with topic coverage in the audit. A planner clarification must be a short question, not an unvalidated factual answer; explicit web requests cannot be downgraded to general conversation (sources-only and private-data restrictions still apply).

## Inference outages

When inference quota or a model service prevents answering, already-materialized eligible records can be returned as a clearly labelled `PARTIAL` evidence-only response. No model answer or current verification is claimed; the trace records `generatedAnswer: false`. Cancellation and source deletion still take precedence. This does not restore provider capacity or replace model-based recommendations. Upload preparation that is throttled returns HTTP429 and Retry-After without claiming that a file was imported.

## Remaining deployment boundaries

The app is designed for a local workspace. Its admission controls are single-process and do not provide distributed quota enforcement or user authentication. Hosting it for unrelated public users requires authentication, per-user isolation and ingress limits before exposing private connected accounts.

## Usage reporting

Turn traces retain reported planning and generation tokens separately and together. Missing provider usage stays unknown, never an invented zero. Deterministic offer extraction reports zero model tokens because it makes no inference request. Usage covers completed adapter responses, not a billing invoice: unreported failed attempts, earlier attachment preparation/transcription and unrelated key usage can be absent. Search traces distinguish logical attempts/cache hits from search-adapter dispatches. The controlled runner separately counts core generation attempts and actual planning/generation HTTP requests.

## Evaluation definitions

- Retrieval recall@5: whether the expected original record is among the first five retrieved records.
- Answer coverage: nonempty completed/partial answers divided by expected cases; execution success alone is not task success.
- Reviewed task success: reviewer-labelled completion of the actual question, including missing vendors and omissions.
- Execution limitations: source-only fallback and terminal/provider errors are counted separately; they prevent a passed full-run support gate. Source-only recovery cannot inflate factual-claim support, task success or useful-answer latency.
- Supported-claim precision: supported factual claims divided by supported, unsupported and unverifiable factual claims; inferences excluded.
- Review coverage: complete, traceable reviews divided by expected cases. Unreviewed cases remain unreviewed.
- Latency: first-useful-answer and completion timings; quota waiting reported separately; failed/empty answers excluded from useful-answer latency.
- Reliability and cost: terminal failures, abstentions, evidence coverage, token usage, search attempts and cache reuse.

The historical fixed-set review passed its scoped 90% threshold, but the current-default run reports 50/52 supported delivered claims and 30/40 complete tasks, with eight inference quota failures. Its full-run gate is EXECUTION_LIMITED. See docs/evaluations/release-review.md for versioned failures and scope; none is independent or production certification.

## Workspace ownership and retries

A workspace has one lifetime SQLite owner connection. Exclusive locking is acquired before migrations or restart recovery, so a second Katha process cannot mark the first process's active turns interrupted. Competing connections (including read-only database inspectors) receive a workspace-in-use error; use Katha's read APIs while it runs, or stop it before inspecting SQLite directly. This targets local filesystems. No network request holds a database transaction. Process termination releases OS locks; startup recovery preserves committed inputs and marks unfinished turns interrupted without automatically repeating provider calls.

A deliberate retry creates a fresh turn with a retained `retryOf` link, current acceptance cutoff and a new request identity. The UI restores eligible original attachments for review before sending. Active/foreign parents and removed original questions are rejected. Replaying the same accepted request remains idempotent, even if its parent's availability later changes. Reopening an active conversation reattaches its observer; it does not restart execution.

Model transport failures preserve a safe capability-unavailable message and original cause rather than exposing low-level diagnostics. They can produce labelled retained-evidence-only recovery. Explicit cancellation is not reclassified as an outage. An unknown/failed request may have consumed provider resources; reported completed-response usage is not a billing total.

## Ordinary web-prose review

Ordinary web prose receives a same-model factual-support and qualification review before publication. The initial risk-marker selector was widened after it missed an unsupported billing mechanic. The review uses the existing 20 RPM/7,000 estimated tokens-per-minute limiter and turn deadlines. It shares the single scoped quotation/citation repair budget, then fails visibly if still unsupported. Pending unpublished drafts are bounded to 32 entries/five minutes across quota retries; crashes do not resume them. Completed usage includes review/repair. This adds requests and latency, can miss risks, and is not independent certification. See docs/adr/0001-bounded-source-qualification-review.md.

### Compound quota guidance

Runtime `fd37213` respects compound provider waits such as `2m35.952s`, `1h2m3.5s` and `1d3h`, rather than defaulting to a minute. A numeric or HTTP-date Retry-After header takes precedence. A delay exceeding the turn's two-minute total quota-wait budget terminates promptly; accepted history remains retained. The [daily-token diagnostic](evaluations/quota-diagnostics.md) shows actual larger requests rejected while a tiny capacity probe succeeded. A small successful request is not evidence of enough quota for a full evaluation.
