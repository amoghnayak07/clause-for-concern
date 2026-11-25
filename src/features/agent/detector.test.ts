import { describe, expect, it } from "vitest";
import { RULE_ID } from "@/common/constants";
import { citesEvidence, normalizeClaim, ruleById } from "./detector";
import type { DetectorOutput } from "./schemas";

const output = (overrides: Partial<DetectorOutput>): DetectorOutput => ({
  status: "RISK_FOUND",
  confidence: "HIGH",
  citations: [],
  redline: null,
  explanation: "x",
  ...overrides,
});
const replace = { kind: "REPLACE", clauseId: "c-001", targetQuote: "some target text here", text: "y" } as const;
const insert = { kind: "INSERT", clauseId: null, targetQuote: null, text: "New clause." } as const;

const required = ruleById(RULE_ID.GOVERNING_LAW);
const prohibited = ruleById(RULE_ID.NO_RESIDUALS);

describe("normalizeClaim", () => {
  it("turns NOT_FOUND on a PROHIBITED Rule into COMPLIANT", () => {
    expect(normalizeClaim(prohibited, output({ status: "NOT_FOUND" })).status).toBe("COMPLIANT");
    expect(normalizeClaim(required, output({ status: "NOT_FOUND" })).status).toBe("NOT_FOUND");
  });

  it.each<[string, Partial<DetectorOutput>, boolean]>([
    ["REPLACE on RISK_FOUND", { redline: replace }, true],
    ["REPLACE without a target", { redline: { ...replace, targetQuote: null } }, false],
    ["REPLACE on NOT_FOUND", { status: "NOT_FOUND", redline: replace }, false],
    ["INSERT on NOT_FOUND", { status: "NOT_FOUND", redline: insert }, true],
    ["INSERT on RISK_FOUND", { redline: insert }, false],
    ["any Redline on COMPLIANT", { status: "COMPLIANT", redline: replace }, false],
  ])("%s keeps the Redline: %s", (_label, overrides, kept) => {
    expect(normalizeClaim(required, output(overrides)).redline !== null).toBe(kept);
  });
});

describe("citesEvidence", () => {
  it("is false only when the model reported no relevant Clause", () => {
    expect(citesEvidence(required, { status: "RISK_FOUND" })).toBe(true);
    expect(citesEvidence(required, { status: "COMPLIANT" })).toBe(true);
    expect(citesEvidence(required, { status: "NOT_FOUND" })).toBe(false);
    expect(citesEvidence(prohibited, { status: "COMPLIANT" })).toBe(false);
  });
});
