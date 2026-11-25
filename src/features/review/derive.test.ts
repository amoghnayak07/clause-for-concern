import { describe, expect, it } from "vitest";
import { BLOCKED_REASON, CITATION_STATE, RECOMMENDED_ACTION, type FindingStatus } from "@/common/constants";
import { citationState, recommendedAction } from "./derive";
import type { Redline } from "./finding";

const cited = [{ clauseId: "c-002", start: 10, end: 40 }];
const blocked = [{ clauseId: "c-003", reason: BLOCKED_REASON.NOT_IN_CLAUSE }];
const replace: Redline = { kind: "REPLACE", clauseId: "c-002", start: 12, end: 20, replacement: "two (2) years" };

const finding = (
  status: FindingStatus,
  { citations = cited, blockedCitations = [] as typeof blocked, redline = null as Redline | null } = {},
) => ({ status, citations, blockedCitations, redline });

describe("citationState", () => {
  it.each([
    [[], [], CITATION_STATE.NONE],
    [cited, [], CITATION_STATE.VERIFIED],
    [cited, blocked, CITATION_STATE.PARTIAL],
    [[], blocked, CITATION_STATE.BLOCKED],
  ])("%j verified + %j blocked is %s", (citations, blockedCitations, expected) => {
    expect(citationState({ citations, blockedCitations })).toBe(expected);
  });
});

describe("recommendedAction", () => {
  it.each([
    ["ERROR", finding("ERROR", { citations: [] }), RECOMMENDED_ACTION.ESCALATE],
    ["NOT_FOUND, even with an INSERT", finding("NOT_FOUND", { citations: [], redline: { kind: "INSERT", afterClauseId: null, text: "x" } }), RECOMMENDED_ACTION.ESCALATE],
    ["RISK_FOUND without a Redline", finding("RISK_FOUND"), RECOMMENDED_ACTION.ESCALATE],
    ["RISK_FOUND with all Citations blocked", finding("RISK_FOUND", { citations: [], blockedCitations: blocked, redline: replace }), RECOMMENDED_ACTION.ESCALATE],
    ["COMPLIANT with all Citations blocked", finding("COMPLIANT", { citations: [], blockedCitations: blocked }), RECOMMENDED_ACTION.ESCALATE],
    ["RISK_FOUND with a Redline", finding("RISK_FOUND", { redline: replace }), RECOMMENDED_ACTION.FIX],
    ["RISK_FOUND with a Redline and some Citations blocked", finding("RISK_FOUND", { blockedCitations: blocked, redline: replace }), RECOMMENDED_ACTION.FIX],
    ["COMPLIANT", finding("COMPLIANT"), RECOMMENDED_ACTION.NONE],
    ["COMPLIANT with nothing cited", finding("COMPLIANT", { citations: [] }), RECOMMENDED_ACTION.NONE],
  ])("%s → %s", (_label, input, expected) => {
    expect(recommendedAction(input)).toBe(expected);
  });
});
