import { describe, expect, it } from "vitest";
import { segmentDocument } from "@/features/document/segment";
import type { Finding } from "@/features/review/finding";
import type { Decision } from "@/features/review/queue";
import { sampleFinding } from "@/features/review/testing";
import { measuredClauseIds, minimapModel } from "./minimap";

const CLAUSES = segmentDocument("1. One.\n2. Two.\n3. Three.\n4. Four.");

const finding = (overrides: Partial<Finding>): Finding => ({
  ...sampleFinding,
  citations: [],
  blockedCitations: [],
  ...overrides,
});

const fix = finding({
  ruleId: "CONFIDENTIALITY_TERM",
  citations: [
    { clauseId: "c-002", start: 8, end: 12 },
    { clauseId: "c-002", start: 12, end: 15 },
    { clauseId: "c-003", start: 16, end: 20 },
  ],
  redline: { kind: "REPLACE", clauseId: "c-002", start: 8, end: 12, replacement: "x" },
});
const compliantCited = finding({ ruleId: "MUTUAL", status: "COMPLIANT", citations: [{ clauseId: "c-001", start: 0, end: 3 }] });
const blocked = finding({
  ruleId: "NO_NON_SOLICIT",
  ruleKind: "PROHIBITED",
  blockedCitations: [
    { clauseId: "c-004", reason: "NOT_IN_CLAUSE" },
    { clauseId: null, reason: "UNKNOWN_CLAUSE" },
  ],
});
const notFound = finding({ ruleId: "GOVERNING_LAW", status: "NOT_FOUND" });
const unknownOnly = finding({
  ruleId: "NO_RESIDUALS",
  ruleKind: "PROHIBITED",
  blockedCitations: [{ clauseId: "c-999", reason: "UNKNOWN_CLAUSE" }],
});
const compliantUncited = finding({ ruleId: "CONFIDENTIALITY_CARVE_OUTS", status: "COMPLIANT" });

const decision = (ruleId: Decision["ruleId"]): Decision => ({
  ruleId,
  kind: "APPROVE",
  reason: null,
  editedReplacement: null,
  decidedAt: 1,
  elapsedMs: 1,
});

describe("minimapModel", () => {
  it("draws one tick per cited Clause per Finding, severe ticks painted last", () => {
    const { ticks } = minimapModel([compliantCited, fix, blocked], CLAUSES, null, {});
    expect(ticks).toEqual([
      { kind: "citation", ruleId: "MUTUAL", clauseId: "c-001", action: "NONE", decided: false },
      { kind: "citation", ruleId: "CONFIDENTIALITY_TERM", clauseId: "c-002", action: "FIX", decided: false },
      { kind: "citation", ruleId: "CONFIDENTIALITY_TERM", clauseId: "c-003", action: "FIX", decided: false },
      { kind: "blocked", ruleId: "NO_NON_SOLICIT", clauseId: "c-004", action: "ESCALATE", decided: false },
    ]);
  });

  it("pins Findings with nothing to draw, most severe first", () => {
    const { pinned } = minimapModel([compliantUncited, unknownOnly, notFound, fix], CLAUSES, null, {});
    expect(pinned).toEqual([
      { ruleId: "GOVERNING_LAW", action: "ESCALATE", decided: false },
      { ruleId: "NO_RESIDUALS", action: "ESCALATE", decided: false },
      { ruleId: "CONFIDENTIALITY_CARVE_OUTS", action: "NONE", decided: false },
    ]);
  });

  it("adds grey ticks for Unmapped Clauses beneath the Finding ticks", () => {
    const coverage = { available: true, covered: 2, total: 4, unmappedClauseIds: ["c-003", "c-004", "c-999"] } as const;
    const { ticks } = minimapModel([compliantCited], CLAUSES, coverage, {});
    expect(ticks.map((tick) => [tick.kind, tick.clauseId])).toEqual([
      ["unmapped", "c-003"],
      ["unmapped", "c-004"],
      ["citation", "c-001"],
    ]);
  });

  it("has no unmapped ticks when Coverage is unavailable or pending", () => {
    expect(minimapModel([], CLAUSES, { available: false, total: 4 }, {}).ticks).toEqual([]);
    expect(minimapModel([], CLAUSES, null, {}).ticks).toEqual([]);
  });

  it("marks decided Findings' ticks and pins", () => {
    const decisions = { CONFIDENTIALITY_TERM: decision("CONFIDENTIALITY_TERM"), GOVERNING_LAW: decision("GOVERNING_LAW") };
    const model = minimapModel([fix, notFound, compliantCited], CLAUSES, null, decisions);
    expect(model.ticks.filter((tick) => tick.kind !== "unmapped" && tick.decided).map((tick) => tick.clauseId)).toEqual([
      "c-002",
      "c-003",
    ]);
    expect(model.pinned).toEqual([{ ruleId: "GOVERNING_LAW", action: "ESCALATE", decided: true }]);
  });
});

describe("measuredClauseIds", () => {
  it("lists each ticked Clause once", () => {
    const coverage = { available: true, covered: 3, total: 4, unmappedClauseIds: ["c-004"] } as const;
    const model = minimapModel([fix, compliantCited, blocked], CLAUSES, coverage, {});
    expect(measuredClauseIds(model).sort()).toEqual(["c-001", "c-002", "c-003", "c-004"]);
  });
});
