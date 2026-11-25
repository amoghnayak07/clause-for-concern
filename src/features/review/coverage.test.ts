import { describe, expect, it } from "vitest";
import { segmentDocument } from "@/features/document/segment";
import { computeCoverage } from "./coverage";
import type { Finding } from "./finding";

const clauses = segmentDocument("1. One.\n2. Two.\n3. Three.\n4. Four.");

const citing = (clauseId: string): Finding => ({
  ruleId: "GOVERNING_LAW",
  ruleKind: "REQUIRED",
  status: "RISK_FOUND",
  confidence: "HIGH",
  source: "MODEL",
  citations: [{ clauseId, start: 0, end: 1 }],
  blockedCitations: [],
  redline: null,
  explanation: "",
  verifierNote: null,
  error: null,
  attempts: 1,
});

describe("computeCoverage", () => {
  it("counts tagged Clauses (including ones judged irrelevant) and cited ones", () => {
    expect(computeCoverage(clauses, ["c-001", "c-002"], [citing("c-004")])).toEqual({
      available: true,
      covered: 3,
      total: 4,
      unmappedClauseIds: ["c-003"],
    });
  });

  it("does not double count a Clause that is both tagged and cited", () => {
    const coverage = computeCoverage(clauses, ["c-001"], [citing("c-001")]);
    expect(coverage).toMatchObject({ covered: 1, unmappedClauseIds: ["c-002", "c-003", "c-004"] });
  });

  it("is unavailable when the mapping failed, even with citations", () => {
    expect(computeCoverage(clauses, null, [citing("c-001")])).toEqual({ available: false, total: 4 });
  });

  it("covers an empty Document fully", () => {
    expect(computeCoverage([], [], [])).toEqual({ available: true, covered: 0, total: 0, unmappedClauseIds: [] });
  });
});
