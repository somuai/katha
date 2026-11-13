# Controlled five-vendor price check

This is a synthetic, single-run integration check using the real configured model and fixture-only search. It is not live vendor pricing research, independent accuracy certification or a production benchmark. Run `node --import tsx evaluations/synthetic-known-price.ts --run-live` with the documented server keys. Raw captures are ignored under `data/evaluations/synthetic-known-price.json`.

The final per-vendor run completed and recovered from one temporary provider quota response. All five vendor comparisons were produced by the model. The harness originally selected the first failed generation attempt when reporting model coverage; it now selects the last successful attempt. That reporting bug does not alter retained raw generation outputs or final verdicts.

| Synthetic vendor | Expected | Validated result | Finding |
| --- | --- | --- | --- |
| AsterCRM | Dated change | Dated change | Supported transition from USD 10 to 12 with explicit November 10 effective date. |
| BerylCRM | Dated change | Unverified | Model gave the change and effective date but omitted currentPrice. Commercial-term validation rejects incomplete extraction. |
| CedarCRM | Currently matches | Currently matches | Matching USD 30 monthly, per-seat, 20-seat US offers with stated limits/tax. |
| DuneCRM | Difference, date unknown | Difference, date unknown | USD 40 to 45 without an effective date. |
| ElmCRM | Conflicting | Unverified | Model recognized contradictory USD 60/70 current offers but used a null current amount; the current price validator cannot validate a unique comparison. |

Thus this one run matched three of five expected outcomes. No unsupported price change was promoted, but conservative failures remain failures to complete the requested comparison. The record does not establish the 90% release target. A future repair step or explicit alternative-offer representation should be evaluated before making stronger completeness claims.
