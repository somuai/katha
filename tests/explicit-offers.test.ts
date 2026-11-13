import test from "node:test";
import assert from "node:assert/strict";
import { explicitOfferAnswer } from "../src/providers/explicit-offers.ts";
const line = (name: string, amount: number, region = "US") =>
  `${name} Core: USD ${amount} per seat per month, billed monthly; region ${region}; 20 seats; unlimited contacts; tax excluded.`;
const source = (id: string, text: string) => ({
  id,
  title: "Offer",
  text,
  observedAt: "2026-11-13",
});
const input = (name: string, text: string) => ({
  question: `Has ${name} pricing changed?`,
  now: "2026-11-13T00:00:00Z",
  baseline: [source("old", line(name, 20))],
  evidence: [source("new", text)],
});
test("complete explicit offers cover dated, equal, undated and conflicting outcomes without missing terms", () => {
  const dated = explicitOfferAnswer(
    input(
      "Acme",
      line("Acme", 25) +
        "\nEffective 2026-11-10, Acme Core changes from USD 20 to USD 25 per seat per month.",
    ),
  );
  assert.equal(dated?.comparisons[0].status, "CHANGED_WITH_DATED_EVIDENCE");
  assert.equal(dated?.comparisons[0].effectiveAt, "2026-11-10");
  assert.equal(
    explicitOfferAnswer(
      input(
        "Acme",
        "Effective 2026-11-10, " +
          line("Acme", 25).replace("Core:", "Core costs"),
      ),
    )?.comparisons[0].status,
    "CHANGED_WITH_DATED_EVIDENCE",
  );
  assert.equal(
    explicitOfferAnswer(input("Acme", line("Acme", 20)))?.comparisons[0].status,
    "CURRENTLY_MATCHES",
  );
  assert.equal(
    explicitOfferAnswer(input("Acme", line("Acme", 25)))?.comparisons[0].status,
    "DIFFERS_CHANGE_TIME_UNKNOWN",
  );
  assert.equal(
    explicitOfferAnswer(
      input(
        "Acme",
        line("Acme", 25) +
          "\n" +
          line("Acme", 30) +
          " Both equally current offers conflict; neither supersedes the other.",
      ),
    )?.comparisons[0].status,
    "CONFLICTING",
  );
});
test("incomplete, mixed-region, historical and future offers do not become false stable or dated results", () => {
  assert.equal(
    explicitOfferAnswer(
      input(
        "Acme",
        line("Acme", 25) +
          "\n" +
          line("Acme", 30) +
          " There is no conflict: one quote is historical.",
      ),
    ),
    undefined,
  );
  assert.equal(
    explicitOfferAnswer(input("Acme", line("Acme", 25, "US; region IN"))),
    undefined,
  );
  assert.equal(
    explicitOfferAnswer(
      input("Acme", line("Acme", 25).replace("; tax excluded.", ".")),
    ),
    undefined,
  );
  assert.equal(
    explicitOfferAnswer(input("Acme", line("Acme", 25, "IN")))?.comparisons[0]
      .status,
    "UNVERIFIED",
  );
  assert.equal(
    explicitOfferAnswer(
      input("Acme", line("Acme", 25) + "\n" + line("Acme", 30)),
    ),
    undefined,
  );
  assert.equal(
    explicitOfferAnswer(
      input(
        "Acme",
        line("Acme", 25) +
          "\nEffective 2027-11-10, Acme Core costs USD 25 per seat per month.",
      ),
    )?.comparisons[0].status,
    "DIFFERS_CHANGE_TIME_UNKNOWN",
  );
  assert.equal(
    explicitOfferAnswer(
      input(
        "Acme",
        line("Acme", 25) +
          "\nPublished 2026-11-10, Acme Core costs USD 25 per seat per month.",
      ),
    )?.comparisons[0].status,
    "DIFFERS_CHANGE_TIME_UNKNOWN",
  );
});
