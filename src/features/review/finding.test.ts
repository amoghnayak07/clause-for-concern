import { describe, expect, it } from "vitest";
import { BLOCKED_REASON, ERROR_KIND, RULE_ID, RULE_KIND } from "@/common/constants";
import { FindingSchema, type Finding } from "./finding";

const base: Finding = {
  ruleId: RULE_ID.GOVERNING_LAW,
  ruleKind: RULE_KIND.REQUIRED,
  status: "RISK_FOUND",
  confidence: "HIGH",
  source: "MODEL",
  citations: [{ clauseId: "c-004", start: 120, end: 160 }],
  blockedCitations: [],
  redline: { kind: "REPLACE", clauseId: "c-004", start: 140, end: 148, replacement: "Delaware" },
  explanation: "Governing law is New York.",
  verifierNote: null,
  error: null,
  attempts: 1,
};

const prohibited: Finding = {
  ...base,
  ruleId: RULE_ID.NO_RESIDUALS,
  ruleKind: RULE_KIND.PROHIBITED,
  status: "COMPLIANT",
  citations: [],
  redline: null,
};

function issues(finding: Finding): string[] {
  const result = FindingSchema.safeParse(finding);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("FindingSchema", () => {
  it.each<[string, Finding]>([
    ["RISK_FOUND with a REPLACE on a cited Clause", base],
    ["PROHIBITED COMPLIANT with nothing cited", prohibited],
    ["REQUIRED NOT_FOUND with an INSERT", { ...base, status: "NOT_FOUND", citations: [], redline: { kind: "INSERT", afterClauseId: null, text: "This Agreement is governed by Delaware law." } }],
    ["ERROR with an error", { ...base, status: "ERROR", citations: [], redline: null, error: { kind: ERROR_KIND.API, message: "boom" } }],
    ["Possible Miss at LOW confidence", { ...base, source: "TRIGGER_TERM", confidence: "LOW", citations: [], redline: null }],
  ])("accepts %s", (_label, finding) => {
    expect(issues(finding)).toEqual([]);
  });

  it.each<[string, Finding, string]>([
    ["ERROR without an error", { ...base, status: "ERROR", redline: null }, "error must be set exactly when status is ERROR"],
    ["an error on a non-ERROR status", { ...base, error: { kind: ERROR_KIND.API, message: "x" } }, "error must be set exactly when status is ERROR"],
    ["NOT_FOUND on a PROHIBITED Rule", { ...prohibited, status: "NOT_FOUND" }, "NOT_FOUND is only valid on REQUIRED Rules"],
    ["PROHIBITED COMPLIANT with a Citation", { ...prohibited, citations: base.citations }, "COMPLIANT on a PROHIBITED Rule must not cite anything"],
    ["PROHIBITED COMPLIANT with a Blocked Citation", { ...prohibited, blockedCitations: [{ clauseId: "c-001", reason: BLOCKED_REASON.NOT_IN_CLAUSE }] }, "COMPLIANT on a PROHIBITED Rule must not cite anything"],
    ["COMPLIANT with a Redline", { ...base, status: "COMPLIANT" }, "COMPLIANT Findings have no Redline"],
    ["REPLACE on an uncited Clause", { ...base, redline: { kind: "REPLACE", clauseId: "c-009", start: 1, end: 2, replacement: "x" } }, "REPLACE Redline must target a cited Clause"],
    ["Possible Miss at HIGH confidence", { ...base, source: "TRIGGER_TERM" }, "Possible Miss Findings are always LOW confidence"],
    ["a ruleKind that contradicts the Playbook", { ...base, ruleKind: RULE_KIND.PROHIBITED }, "ruleKind must match the Playbook (REQUIRED)"],
    ["an empty Citation span", { ...base, citations: [{ clauseId: "c-004", start: 5, end: 5 }] }, "end must be after start"],
  ])("rejects %s", (_label, finding, message) => {
    expect(issues(finding)).toContain(message);
  });
});
