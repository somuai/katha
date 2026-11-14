# Bounded source-qualification review

Status: implemented; live validation pending.

The fixed-set review exposed prose that repeated old parameter restrictions or merged browser-specific errors into a universal rule. Exact citation IDs and verbatim quotes did not catch this. Stronger generation instructions alone still failed a targeted replay.

For ordinary web prose with explicit version-risk markers in retained text, use one same-model source-qualification review before publication. The heuristic currently checks “previously”, “in the future”, “deprecated”, “now applies” and “in some browsers”. Structured comparisons retain their separate host validation; private-file and ordinary memory answers do not enter this path.

The review returns a small validated supported/issues record, not a replacement answer or private reasoning. A rejected draft may consume the same single repair allowance already used for quotation/citation repair. A revised draft is reviewed again; rejection or malformed review fails visibly rather than publishing unsupported text. This is not independent semantic certification and the heuristic can miss risks or select harmless material.

Both generation and review use the existing model limiter, active deadline and quota-wait policy. The bounded five-minute/32-entry draft cache preserves an unpublished draft across same-process quota retries. A crash still interrupts the turn; cancellation/deletion validation remains authoritative. Known completed-response usage includes review and repair; unknown failed-attempt usage stays unknown.

Trade-off: selected web questions take an extra model request, or three extra requests if review requires a repair and re-review. No extra agent tool, new provider, paid fallback or public interface is introduced. Full grounding accuracy, added latency and free-quota impact must be measured on the frozen evidence, not inferred from deterministic tests.

The targeted candidate replay also exposed an existing adapter omission: the host already computed `verification`, but the provider input dropped it. Propagate that decision explicitly. An ordinary explanation requires `comparisons: []` and bypasses historical offer parsing/per-vendor verification. An accidental comparison gets the same bounded repair, not a fabricated baseline or an irrelevant “cannot establish a change” answer. The evaluator records actual planning/generation/qualification-review HTTP phases without headers or provider reasoning fields, making added calls observable.

Ordinary explanations use a shorter dedicated prompt instead of carrying unused historical commercial-comparison schemas. This reduces context pressure and makes the host path less ambiguous. The evaluator publishes only whitelisted aggregate input/output/total usage and visible review findings; headers, raw provider reasoning fields and reasoning-token detail structures are excluded. Any latency benefit remains a versioned observation to measure, not a guaranteed speed claim.
