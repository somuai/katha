import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEvaluation } from "../evaluations/metrics.ts";
const row = (extra: any = {}) => ({
  id: "one",
  model: "A",
  completionMs: 100,
  firstUsefulMs: 80,
  quotaMs: 20,
  snapshot: { status: "COMPLETED", answer: "Answer" },
  review: {
    reviewed: true,
    taskSuccess: true,
    claims: [{ verdict: "supported" }],
  },
  ...extra,
});
test("empty failed turns never acquire useful-answer latency", () => {
  const report = summarizeEvaluation({
    models: ["A"],
    results: [
      row({ snapshot: { status: "FAILED", answer: "" }, firstUsefulMs: 100 }),
    ],
  });
  assert.equal(report.models[0].latency.medianFirstUsefulMs, null);
  assert.equal(report.models[0].answered, 0);
  assert.equal(report.models[0].executionCompleted, 0);
});
test("unreviewed claims cannot establish the ninety-percent gate", () => {
  const report = summarizeEvaluation({
    models: ["A"],
    results: [
      row(),
      row({
        id: "two",
        review: { reviewed: false, claims: [{ verdict: "supported" }] },
      }),
    ],
  });
  assert.equal(report.models[0].claims.precision, 1);
  assert.equal(report.models[0].claimSupportGate, "NOT_REVIEWED");
  assert.equal(report.models[0].reviewCoverage, 0.5);
});
test("inferences and abstentions do not inflate factual claim precision", () => {
  const report = summarizeEvaluation({
    models: ["A"],
    expectedCaseIds: ["one", "two"],
    results: [
      row({
        review: {
          reviewed: true,
          taskSuccess: false,
          abstained: true,
          claims: [],
        },
      }),
      row({
        id: "two",
        review: {
          reviewed: true,
          taskSuccess: true,
          claims: [
            { verdict: "supported" },
            { verdict: "unsupported" },
            { verdict: "unverifiable" },
            { verdict: "inference" },
          ],
        },
      }),
    ],
  });
  const r = report.models[0];
  assert.equal(r.claims.precision, 1 / 3);
  assert.equal(r.claims.factual, 3);
  assert.equal(r.taskSuccessRate, 0.5);
  assert.equal(r.claimSupportGate, "BELOW_TARGET");
  assert.equal(r.abstentions, 1);
});
test("latencies report wall and quota separately", () => {
  const r = summarizeEvaluation({
    models: ["A"],
    results: [
      row(),
      row({ id: "two", completionMs: 300, firstUsefulMs: 200, quotaMs: 100 }),
    ],
  }).models[0];
  assert.equal(r.latency.medianAnswerCompletionMs, 200);
  assert.equal(r.latency.medianActiveCompletionMs, 140);
  assert.equal(r.latency.medianQuotaMs, 60);
});
test("missing candidate cases and duplicate results prevent gate completion", () => {
  const report = summarizeEvaluation({
    models: ["A", "B"],
    results: [
      row(),
      row({ id: "two" }),
      row({ model: "B" }),
      row({ model: "B" }),
    ],
  });
  assert.equal(report.models[1].claimSupportGate, "INCOMPLETE_RUN");
  assert.deepEqual(report.models[1].missingCaseIds, ["two"]);
  assert.deepEqual(report.models[1].duplicateCaseIds, ["one"]);
});
test("a fully reviewed score at the target can pass without calling task completion accuracy", () => {
  const r = summarizeEvaluation({
    models: ["A"],
    expectedCaseIds: ["one"],
    results: [
      row({
        review: {
          reviewed: true,
          taskSuccess: false,
          claims: Array.from({ length: 10 }, (_, i) => ({
            verdict: i < 9 ? "supported" : "unsupported",
          })),
        },
      }),
    ],
  }).models[0];
  assert.equal(r.claims.precision, 0.9);
  assert.equal(r.claimSupportGate, "PASSED");
  assert.equal(r.taskSuccessRate, 0);
});
test("a reviewed answer with no factual claims has no precision score", () => {
  const r = summarizeEvaluation({
    results: [
      row({ review: { reviewed: true, taskSuccess: false, claims: [] } }),
    ],
  }).models[0];
  assert.equal(r.claims.precision, null);
  assert.equal(r.claimSupportGate, "NO_FACTUAL_CLAIMS");
});

test("a partial file cannot pass without a declared expected case set", () => {
  const r = summarizeEvaluation({ results: [row()] }).models[0];
  assert.equal(r.claimSupportGate, "CASE_SET_UNDECLARED");
});
