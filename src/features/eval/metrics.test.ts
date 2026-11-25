import { describe, expect, it } from "vitest";
import { PLAYBOOK, type FindingStatus, type RuleId } from "@/common/constants";
import type { TokenUsage } from "@/features/agent/callModel";
import type { ReviewResult, RuleRun } from "@/features/agent/graph";
import type { Finding } from "@/features/review/finding";
import { validateLabels, type LabeledDocument } from "./labels";
import { compareDocument, costUsd, rate, summarize, type DocumentRun } from "./metrics";
import { SAMPLE_NDA, sampleLabelFile } from "./testing";

function labeledSample(name = "sample.txt"): LabeledDocument {
  const result = validateLabels(name, SAMPLE_NDA, sampleLabelFile(name));
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.document;
}

const kindOf = (ruleId: RuleId) => PLAYBOOK.find((rule) => rule.id === ruleId)!.kind;

function finding(ruleId: RuleId, status: FindingStatus, overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId,
    ruleKind: kindOf(ruleId),
    status,
    confidence: "HIGH",
    source: "MODEL",
    citations: [],
    blockedCitations: [],
    redline: null,
    explanation: "",
    verifierNote: null,
    error: status === "ERROR" ? { kind: "API", message: "boom" } : null,
    attempts: 1,
    ...overrides,
  };
}

const usage = (input: number, output: number, thinking: number): TokenUsage => ({ input, output, thinking });
const ZERO = usage(0, 0, 0);

function ruleRun(ruleId: RuleId, overrides: Partial<RuleRun> = {}): RuleRun {
  return {
    ruleId,
    usage: { DETECT: usage(100, 10, 5), REPAIR: ZERO, VERIFY: ZERO },
    firstPassCitations: { proposed: 0, verified: 0 },
    ...overrides,
  };
}

/**
 * Labels (sampleLabelFile): MUTUAL C, GOVERNING_LAW R, CONFIDENTIALITY_TERM R,
 * NO_NON_SOLICIT R, NO_RESIDUALS C, CONFIDENTIALITY_CARVE_OUTS R.
 */
function sampleRun(name = "sample.txt"): DocumentRun {
  const findings: Finding[] = [
    finding("MUTUAL", "RISK_FOUND"), // false positive
    finding("GOVERNING_LAW", "RISK_FOUND", {
      citations: [{ clauseId: "c-007", start: 0, end: 10 }],
      blockedCitations: [{ clauseId: "c-002", reason: "NOT_IN_CLAUSE" }],
    }), // caught, exact
    finding("CONFIDENTIALITY_TERM", "COMPLIANT"), // miss
    finding("NO_NON_SOLICIT", "ERROR"), // error = miss
    finding("NO_RESIDUALS", "COMPLIANT"), // correct negative
    finding("CONFIDENTIALITY_CARVE_OUTS", "NOT_FOUND"), // caught, not exact
  ];
  const result: ReviewResult = {
    clauses: [],
    findings,
    coverage: { available: true, covered: 0, total: 0, unmappedClauseIds: [] },
    usage: {
      rules: PLAYBOOK.map((rule) =>
        rule.id === "GOVERNING_LAW"
          ? ruleRun(rule.id, {
              firstPassCitations: { proposed: 2, verified: 1 },
              usage: { DETECT: usage(100, 10, 5), REPAIR: usage(40, 4, 2), VERIFY: usage(60, 6, 3) },
            })
          : rule.id === "NO_NON_SOLICIT"
            ? ruleRun(rule.id, { firstPassCitations: null })
            : ruleRun(rule.id),
      ),
      mapClauses: usage(50, 5, 0),
    },
  };
  return { document: labeledSample(name), result };
}

describe("compareDocument", () => {
  it("classifies each Rule's outcome in Playbook order", () => {
    expect(compareDocument(sampleRun()).map((c) => [c.ruleId, c.outcome, c.exact])).toEqual([
      ["MUTUAL", "FALSE_POSITIVE", false],
      ["GOVERNING_LAW", "CAUGHT", true],
      ["CONFIDENTIALITY_TERM", "MISS", false],
      ["NO_NON_SOLICIT", "ERROR", false],
      ["NO_RESIDUALS", "CORRECT_NEGATIVE", true],
      ["CONFIDENTIALITY_CARVE_OUTS", "CAUGHT", false],
    ]);
  });
});

describe("summarize", () => {
  it("counts recall over Positives with ERROR as a miss, and precision over flagged Findings", () => {
    const { total, rules } = summarize([sampleRun()], null);
    expect(total.recall).toEqual({ hit: 2, total: 4 });
    expect(total.precision).toEqual({ hit: 2, total: 3 });
    expect(total.exact).toEqual({ hit: 2, total: 6 });
    expect(total.errors).toBe(1);

    expect(rules.NO_NON_SOLICIT.recall).toEqual({ hit: 0, total: 1 });
    expect(rules.NO_NON_SOLICIT.precision).toEqual({ hit: 0, total: 0 });
    expect(rate(rules.NO_NON_SOLICIT.precision)).toBeNull();
    expect(rules.MUTUAL.precision).toEqual({ hit: 0, total: 1 });
    expect(rules.MUTUAL.recall).toEqual({ hit: 0, total: 0 });
  });

  it("reports first-try and final citation pass rates", () => {
    const { rules, total } = summarize([sampleRun()], null);
    expect(rules.GOVERNING_LAW.citationsFirstTry).toEqual({ hit: 1, total: 2 });
    expect(rules.GOVERNING_LAW.citationsFinal).toEqual({ hit: 1, total: 2 });
    expect(total.citationsFirstTry).toEqual({ hit: 1, total: 2 });
  });

  it("sums across Documents", () => {
    const { total, rules, documents } = summarize([sampleRun("a.txt"), sampleRun("b.txt")], null);
    expect(total.recall).toEqual({ hit: 4, total: 8 });
    expect(rules.GOVERNING_LAW.usage.REPAIR).toEqual(usage(80, 8, 4));
    expect(documents.map((d) => d.name)).toEqual(["a.txt", "b.txt"]);
  });

  it("totals tokens per Document (all passes plus mapClauses) and prices them", () => {
    const pricing = { inputPerMTok: 4, outputPerMTok: 20 };
    const summary = summarize([sampleRun(), sampleRun()], pricing);
    // 6 × DETECT(100, 10, 5) + REPAIR(40, 4, 2) + VERIFY(60, 6, 3) + map(50, 5, 0)
    expect(summary.documents[0].usage).toEqual(usage(750, 75, 35));
    expect(summary.documents[0].costUsd).toBeCloseTo((750 * 4 + 75 * 20) / 1e6);
    expect(summary.totalCostUsd).toBeCloseTo((2 * (750 * 4 + 75 * 20)) / 1e6);
    expect(summary.mapClauses).toEqual(usage(100, 10, 0));
  });

  it("has no cost without pricing", () => {
    expect(costUsd(usage(1, 1, 0), null)).toBeNull();
    expect(summarize([sampleRun()], null).totalCostUsd).toBeNull();
  });
});
