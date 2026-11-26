import { describe, expect, it } from "vitest";
import { PLAYBOOK, REVIEW_PHASE } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import type { Finding } from "./finding";
import { coverageView, ruleStatusRows } from "./overview";
import type { Decision } from "./queue";
import { sampleFinding } from "./testing";

const compliant: Finding = {
  ...sampleFinding,
  ruleId: "NO_RESIDUALS",
  ruleKind: "PROHIBITED",
  status: "COMPLIANT",
  citations: [],
  explanation: "",
};

const approved: Decision = {
  ruleId: "NO_RESIDUALS",
  kind: "APPROVE",
  reason: null,
  editedReplacement: null,
  decidedAt: 1,
  elapsedMs: 1,
};

describe("ruleStatusRows", () => {
  it("lists every Playbook Rule in Playbook order, pending until its Finding arrives", () => {
    const rows = ruleStatusRows([compliant, sampleFinding], {});
    expect(rows.map((row) => row.ruleId)).toEqual(PLAYBOOK.map((rule) => rule.id));

    const pending = rows.find((row) => row.ruleId === "MUTUAL");
    expect(pending).toMatchObject({ finding: null, action: null, decision: null, kind: "REQUIRED" });
  });

  it("derives the recommended action and attaches the latest Decision", () => {
    const rows = ruleStatusRows([compliant, sampleFinding], { NO_RESIDUALS: approved });
    expect(rows.find((row) => row.ruleId === "GOVERNING_LAW")).toMatchObject({
      finding: sampleFinding,
      action: "ESCALATE",
      decision: null,
    });
    expect(rows.find((row) => row.ruleId === "NO_RESIDUALS")).toMatchObject({ action: "NONE", decision: approved });
  });
});

describe("coverageView", () => {
  const clauses = segmentDocument("1. One.\n2. Two.\n3. Three.");

  it("is pending while the run is still going and Coverage hasn't arrived", () => {
    expect(coverageView(null, clauses, REVIEW_PHASE.RUNNING)).toEqual({ kind: "pending" });
  });

  it("shows nothing when the run ended without Coverage", () => {
    expect(coverageView(null, clauses, REVIEW_PHASE.FAILED)).toBeNull();
    expect(coverageView(null, clauses, REVIEW_PHASE.DONE)).toBeNull();
  });

  it("is unavailable when the mapping failed", () => {
    expect(coverageView({ available: false, total: 3 }, clauses, REVIEW_PHASE.DONE)).toEqual({ kind: "unavailable" });
  });

  it("summarises the mapped share and labels Unmapped Clauses in Document order", () => {
    const view = coverageView(
      { available: true, covered: 1, total: 3, unmappedClauseIds: ["c-002", "c-003"] },
      clauses,
      REVIEW_PHASE.DONE,
    );
    expect(view).toEqual({
      kind: "available",
      covered: 1,
      total: 3,
      percent: (1 / 3) * 100,
      summary: "1 of 3 clauses mapped",
      unmapped: [
        { clauseId: "c-002", label: "§2" },
        { clauseId: "c-003", label: "§3" },
      ],
    });
  });

  it("formats large counts in the fixed UI locale and handles singular and empty Documents", () => {
    const big = coverageView({ available: true, covered: 1200, total: 1500, unmappedClauseIds: [] }, [], REVIEW_PHASE.DONE);
    expect(big).toMatchObject({ summary: "1,200 of 1,500 clauses mapped", percent: 80 });

    const one = coverageView({ available: true, covered: 1, total: 1, unmappedClauseIds: [] }, [], REVIEW_PHASE.DONE);
    expect(one).toMatchObject({ summary: "1 of 1 clause mapped" });

    const empty = coverageView({ available: true, covered: 0, total: 0, unmappedClauseIds: [] }, [], REVIEW_PHASE.DONE);
    expect(empty).toMatchObject({ percent: 100 });
  });

  it("falls back to the Clause ID for an unknown Clause", () => {
    const view = coverageView({ available: true, covered: 0, total: 1, unmappedClauseIds: ["c-999"] }, [], REVIEW_PHASE.DONE);
    expect(view).toMatchObject({ unmapped: [{ clauseId: "c-999", label: "c-999" }] });
  });
});
