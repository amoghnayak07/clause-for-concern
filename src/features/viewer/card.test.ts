import { describe, expect, it } from "vitest";
import { BLOCKED_REASON, REDLINE_KIND, RULE_ID } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import {
  blockedCitationHeadline,
  blockedCitationViews,
  citedClauseLabels,
  redlineHeadline,
  redlineView,
  ruleTitle,
} from "./card";

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

describe("ruleTitle", () => {
  it("reads the Playbook title", () => {
    expect(ruleTitle(RULE_ID.NO_RESIDUALS)).toBe("No residuals clause");
  });
});

describe("citedClauseLabels", () => {
  it("lists each cited Clause once, in citation order", () => {
    const citations = [
      { clauseId: c2.id, ...at("laws of New York") },
      { clauseId: c1.id, ...at("five (5) years") },
      { clauseId: c2.id, ...at("governed by") },
    ];
    expect(citedClauseLabels({ citations }, CLAUSES)).toEqual([c2.label, c1.label]);
  });
});

describe("blockedCitationViews", () => {
  it("shows the real Clause text sliced from the Document, never a quote", () => {
    const [view] = blockedCitationViews(
      { blockedCitations: [{ clauseId: c2.id, reason: BLOCKED_REASON.NOT_IN_CLAUSE }] },
      CLAUSES,
      TEXT,
    );
    expect(view).toEqual({
      kind: "IN_DOCUMENT",
      clauseId: c2.id,
      clauseLabel: c2.label,
      clauseText: "2. Law. This Agreement is governed by the laws of New York.",
      reason: BLOCKED_REASON.NOT_IN_CLAUSE,
    });
    expect(blockedCitationHeadline(view)).toBe(`Agent cited ${c2.label} but the quote didn't match`);
  });

  it.each([null, "c-999"])("treats Clause ID %s as not in the document", (clauseId) => {
    const [view] = blockedCitationViews(
      { blockedCitations: [{ clauseId, reason: BLOCKED_REASON.UNKNOWN_CLAUSE }] },
      CLAUSES,
      TEXT,
    );
    expect(view).toEqual({ kind: "NOT_IN_DOCUMENT", reason: BLOCKED_REASON.UNKNOWN_CLAUSE });
    expect(blockedCitationHeadline(view)).toBe("Agent cited a clause that is not in the document");
  });
});

describe("redlineView", () => {
  it("is null without a Redline", () => {
    expect(redlineView({ redline: null }, CLAUSES, TEXT)).toBeNull();
  });

  it("slices a REPLACE target from the Document", () => {
    const view = redlineView(
      { redline: { kind: REDLINE_KIND.REPLACE, clauseId: c1.id, ...at("five (5) years"), replacement: "two (2) years" } },
      CLAUSES,
      TEXT,
    )!;
    expect(view).toEqual({ kind: REDLINE_KIND.REPLACE, clauseLabel: c1.label, original: "five (5) years", replacement: "two (2) years" });
    expect(redlineHeadline(view)).toBe(`Replace in ${c1.label}`);
  });

  it("labels INSERT positions, including the start of the Document", () => {
    const after = redlineView({ redline: { kind: REDLINE_KIND.INSERT, afterClauseId: c2.id, text: "3. New." } }, CLAUSES, TEXT)!;
    expect(redlineHeadline(after)).toBe(`Insert after ${c2.label}`);
    const atStart = redlineView({ redline: { kind: REDLINE_KIND.INSERT, afterClauseId: null, text: "0. New." } }, CLAUSES, TEXT)!;
    expect(redlineHeadline(atStart)).toBe("Insert at the start of the document");
  });
});
