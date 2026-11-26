import { describe, expect, it } from "vitest";
import { DECISION_KIND, REDLINE_KIND, RULE_ID, RULE_KIND, type DecisionKind, type RuleId } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import { acceptedRedlines, reviewSummary, reviseDocument } from "./export";
import type { Finding, Redline } from "./finding";
import type { Decision, QueueState } from "./queue";

const TEXT = [
  "1. Term. Obligations survive for five (5) years after termination.",
  "2. Law. This Agreement is governed by the laws of New York.",
].join("\n");
const CLAUSES = segmentDocument(TEXT);
const [c1, c2] = CLAUSES;
const at = (quote: string) => {
  const start = TEXT.indexOf(quote);
  return { start, end: start + quote.length };
};

function finding(ruleId: RuleId, redline: Redline | null, clauseId = c1.id): Finding {
  return {
    ruleId,
    ruleKind: ruleId === RULE_ID.NO_RESIDUALS ? RULE_KIND.PROHIBITED : RULE_KIND.REQUIRED,
    status: "RISK_FOUND",
    confidence: "HIGH",
    source: "MODEL",
    citations: [{ clauseId, start: 0, end: 5 }],
    blockedCitations: [],
    redline,
    explanation: "",
    verifierNote: null,
    error: null,
    attempts: 1,
  };
}

function decision(ruleId: RuleId, kind: DecisionKind, extra: Partial<Decision> = {}): Decision {
  return { ruleId, kind, reason: null, editedReplacement: null, decidedAt: 0, elapsedMs: 0, ...extra };
}

const decisions = (...list: Decision[]): QueueState["decisions"] =>
  Object.fromEntries(list.map((d) => [d.ruleId, d]));

const replaceTerm: Redline = { kind: REDLINE_KIND.REPLACE, clauseId: c1.id, ...at("five (5) years"), replacement: "two (2) years" };
const replaceLaw: Redline = { kind: REDLINE_KIND.REPLACE, clauseId: c2.id, ...at("New York"), replacement: "Delaware" };
const insertAfterLaw: Redline = { kind: REDLINE_KIND.INSERT, afterClauseId: c2.id, text: "3. Mutual. Each party is both discloser and recipient." };

const TERM = finding(RULE_ID.CONFIDENTIALITY_TERM, replaceTerm);
const LAW = finding(RULE_ID.GOVERNING_LAW, replaceLaw, c2.id);
const MUTUAL = finding(RULE_ID.MUTUAL, insertAfterLaw);

const revise = (findings: readonly Finding[], decided: QueueState["decisions"]) =>
  reviseDocument(TEXT, CLAUSES, acceptedRedlines(findings, decided));

describe("acceptedRedlines", () => {
  it("takes the agent's Redline on APPROVE and the reviewer's text on EDIT; ignores the rest", () => {
    const accepted = acceptedRedlines(
      [TERM, LAW, MUTUAL, finding(RULE_ID.NO_RESIDUALS, null)],
      decisions(
        decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.APPROVE),
        decision(RULE_ID.GOVERNING_LAW, DECISION_KIND.EDIT, { editedReplacement: "California" }),
        decision(RULE_ID.MUTUAL, DECISION_KIND.DISMISS),
        decision(RULE_ID.NO_RESIDUALS, DECISION_KIND.APPROVE),
      ),
    );
    expect(accepted.map(({ ruleId, text }) => [ruleId, text])).toEqual([
      [RULE_ID.CONFIDENTIALITY_TERM, "two (2) years"],
      [RULE_ID.GOVERNING_LAW, "California"],
    ]);
  });
});

describe("reviseDocument", () => {
  it("returns the Document unchanged when nothing is accepted", () => {
    expect(revise([TERM, LAW], decisions(decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.ESCALATE)))).toEqual({
      text: TEXT,
      applied: [],
      skipped: [],
    });
  });

  it("applies REPLACE and INSERT Redlines at the right offsets", () => {
    const revised = revise(
      [TERM, LAW, MUTUAL],
      decisions(
        decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.APPROVE),
        decision(RULE_ID.GOVERNING_LAW, DECISION_KIND.APPROVE),
        decision(RULE_ID.MUTUAL, DECISION_KIND.APPROVE),
      ),
    );
    expect(revised.text).toBe(
      [
        "1. Term. Obligations survive for two (2) years after termination.",
        "2. Law. This Agreement is governed by the laws of Delaware.",
        "",
        "3. Mutual. Each party is both discloser and recipient.",
      ].join("\n"),
    );
    expect(revised.applied).toEqual([RULE_ID.CONFIDENTIALITY_TERM, RULE_ID.GOVERNING_LAW, RULE_ID.MUTUAL]);
  });

  it("inserts at the start of the Document when there is no anchor Clause", () => {
    const top = finding(RULE_ID.MUTUAL, { kind: REDLINE_KIND.INSERT, afterClauseId: null, text: "Preamble." });
    const revised = revise([TERM, top], decisions(
      decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.APPROVE),
      decision(RULE_ID.MUTUAL, DECISION_KIND.APPROVE),
    ));
    expect(revised.text.startsWith("Preamble.\n\n1. Term. Obligations survive for two (2) years")).toBe(true);
  });

  it("keeps an INSERT in front of a REPLACE that starts at the same offset", () => {
    const top = finding(RULE_ID.MUTUAL, { kind: REDLINE_KIND.INSERT, afterClauseId: null, text: "Preamble." });
    const opening = finding(RULE_ID.CONFIDENTIALITY_TERM, { kind: REDLINE_KIND.REPLACE, clauseId: c1.id, ...at("1. Term."), replacement: "1. Duration." });
    // The INSERT comes first in the queue here, so a naive sort would let the REPLACE overwrite it.
    const revised = revise([top, opening], decisions(
      decision(RULE_ID.MUTUAL, DECISION_KIND.APPROVE),
      decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.APPROVE),
    ));
    expect(revised.text.startsWith("Preamble.\n\n1. Duration. Obligations")).toBe(true);
  });

  it("skips a REPLACE that overlaps an earlier accepted one and reports the clash", () => {
    const overlapping = finding(RULE_ID.NO_RESIDUALS, { kind: REDLINE_KIND.REPLACE, clauseId: c1.id, ...at("(5) years after"), replacement: "x" });
    const revised = revise([TERM, overlapping], decisions(
      decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.APPROVE),
      decision(RULE_ID.NO_RESIDUALS, DECISION_KIND.APPROVE),
    ));
    expect(revised.text).toContain("two (2) years after termination");
    expect(revised.applied).toEqual([RULE_ID.CONFIDENTIALITY_TERM]);
    expect(revised.skipped).toEqual([{ ruleId: RULE_ID.NO_RESIDUALS, reason: "OVERLAP", conflictsWith: RULE_ID.CONFIDENTIALITY_TERM }]);
  });

  it("skips an INSERT whose anchor Clause is unknown", () => {
    const lost = finding(RULE_ID.MUTUAL, { kind: REDLINE_KIND.INSERT, afterClauseId: "c-999", text: "Lost." });
    const revised = revise([lost], decisions(decision(RULE_ID.MUTUAL, DECISION_KIND.APPROVE)));
    expect(revised).toEqual({ text: TEXT, applied: [], skipped: [{ ruleId: RULE_ID.MUTUAL, reason: "UNKNOWN_CLAUSE", conflictsWith: null }] });
  });

  it("deletes the span when an edited REPLACE is empty", () => {
    const revised = revise([LAW], decisions(decision(RULE_ID.GOVERNING_LAW, DECISION_KIND.EDIT, { editedReplacement: "" })));
    expect(revised.text).toContain("governed by the laws of .");
  });
});

describe("reviewSummary", () => {
  it("lists escalations with reasons, then every Finding with its Decision and Redline outcome", () => {
    const findings = [TERM, LAW, MUTUAL];
    const decided = decisions(
      decision(RULE_ID.CONFIDENTIALITY_TERM, DECISION_KIND.EDIT, { editedReplacement: "one (1) year" }),
      decision(RULE_ID.GOVERNING_LAW, DECISION_KIND.ESCALATE, { reason: "Client prefers NY." }),
    );
    const summary = reviewSummary(findings, CLAUSES, TEXT, decided, revise(findings, decided));
    expect(summary).toContain("2 of 3 findings decided.");
    expect(summary).toMatch(/## Escalations\n\n- \*\*Governing law[^*]*\*\*: Client prefers NY\./);
    expect(summary).toContain("- Decision: Edited\n- Redline: Replace in §1, applied as edited");
    expect(summary).toContain("- Decision: Escalated\n- Reason: Client prefers NY.\n- Redline: Replace in §2, not applied");
    expect(summary).toContain("- Decision: Undecided\n- Redline: Insert after §2, not applied");
  });

  it("says so when nothing was escalated", () => {
    const summary = reviewSummary([TERM], CLAUSES, TEXT, {}, revise([TERM], {}));
    expect(summary).toContain("## Escalations\n\nNone.");
  });
});
