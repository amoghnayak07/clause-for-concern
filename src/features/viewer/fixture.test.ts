import { describe, expect, it } from "vitest";
import { CITATION_STATE, FINDING_STATUS, PLAYBOOK, RECOMMENDED_ACTION } from "@/common/constants";
import { createCitationIndex, verifyQuote } from "@/features/citations/verify";
import { citationState, recommendedAction } from "@/features/review/derive";
import { FindingSchema } from "@/features/review/finding";
import { DEMO_CLAUSES, DEMO_FINDINGS, DEMO_TEXT } from "./fixture";
import { buildViewerBlocks } from "./segments";

describe("demo fixture", () => {
  it("segments into numbered Clauses with labels", () => {
    expect(DEMO_CLAUSES.map((c) => c.label)).toEqual(["P1", "P2", "A1", "A2", "A2(a)", "A2(b)", "A2(c)", "A3", "A4", "A5", "A6"]);
  });

  it("has exactly one Finding per Rule", () => {
    expect(DEMO_FINDINGS.map((f) => f.ruleId).sort()).toEqual(PLAYBOOK.map((r) => r.id).sort());
  });

  it.each(DEMO_FINDINGS.map((f) => [f.ruleId, f] as const))("%s passes the domain Finding schema", (_id, finding) => {
    expect(FindingSchema.safeParse(finding).error).toBeUndefined();
  });

  it("only has Citations the real quote verifier reproduces exactly", () => {
    const index = createCitationIndex(DEMO_TEXT, DEMO_CLAUSES);
    for (const finding of DEMO_FINDINGS) {
      for (const citation of finding.citations) {
        const quote = DEMO_TEXT.slice(citation.start, citation.end);
        expect(verifyQuote(index, { clauseId: citation.clauseId, quote })).toEqual({ ok: true, citation });
      }
    }
  });

  it("covers every scenario the viewer must render", () => {
    const has = (predicate: (f: (typeof DEMO_FINDINGS)[number]) => boolean) => DEMO_FINDINGS.some(predicate);
    expect(has((f) => f.status === FINDING_STATUS.RISK_FOUND && f.redline !== null)).toBe(true);
    expect(has((f) => f.status === FINDING_STATUS.RISK_FOUND && f.redline === null && f.citations.length > 0)).toBe(true);
    expect(has((f) => f.status === FINDING_STATUS.COMPLIANT)).toBe(true);
    expect(has((f) => f.status === FINDING_STATUS.NOT_FOUND)).toBe(true);
    expect(has((f) => f.status === FINDING_STATUS.ERROR)).toBe(true);
    expect(has((f) => citationState(f) === CITATION_STATE.BLOCKED)).toBe(true);
    expect(has((f) => f.blockedCitations.some((b) => b.clauseId === null))).toBe(true);
    expect(new Set(DEMO_FINDINGS.map(recommendedAction))).toEqual(new Set(Object.values(RECOMMENDED_ACTION)));

    const runs = buildViewerBlocks(DEMO_TEXT, DEMO_CLAUSES, DEMO_FINDINGS).flatMap((b) => b.runs);
    expect(runs.some((run) => new Set(run.highlights.map((h) => h.ruleId)).size > 1)).toBe(true);
  });
});
