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

Search-call budgets should not be read as guaranteed billing credits across all providers or search depths. Cached or coalesced responses still count toward the incoming connection request limit. Limits and caches stored in memory reset on restart; the monthly search budget is stored in SQLite. API keys may have additional usage outside this process.

HTTP ingress additionally limits turn submissions to 30/minute and uploads to 12/minute per client IP, before body processing. State is bounded to 1,024 active client/bucket entries. Read, cancellation and SSE routes remain available. Rejections expose HTTP 429 and Retry-After.

## Remaining deployment boundaries

The app is designed for a local workspace. Its admission controls are single-process and do not provide distributed quota enforcement or user authentication. Hosting it for unrelated public users requires authentication, per-user isolation and ingress limits before exposing private connected accounts.

## Evaluation definitions

- Retrieval recall@5: whether the expected original record is among the first five retrieved records.
- Answer coverage: nonempty completed/partial answers divided by expected cases; execution success alone is not task success.
- Reviewed task success: reviewer-labelled completion of the actual question, including missing vendors and omissions.
- Supported-claim precision: supported factual claims divided by supported, unsupported and unverifiable factual claims; inferences excluded.
- Review coverage: complete, traceable reviews divided by expected cases. Unreviewed cases remain unreviewed.
- Latency: first-useful-answer and completion timings; quota waiting reported separately; failed/empty answers excluded from useful-answer latency.
- Reliability and cost: terminal failures, abstentions, evidence coverage, token usage, search attempts and cache reuse.

The 90% supported-claim gate has not been established. Existing synthetic retrieval and shared-evidence model results must not be presented as production answer accuracy.
