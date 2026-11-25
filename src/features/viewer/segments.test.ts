import { describe, expect, it } from "vitest";
import {
  BLOCKED_REASON,
  CONFIDENCE,
  ERROR_KIND,
  FINDING_SOURCE,
  FINDING_STATUS,
  RECOMMENDED_ACTION,
  REDLINE_KIND,
  RULE_ID,
  RULE_KIND,
  type RuleId,
} from "@/common/constants";
import type { Citation } from "@/features/citations/types";
import { segmentDocument } from "@/features/document/segment";
import type { Finding } from "@/features/review/finding";
import {
  buildViewerBlocks,
  citationKey,
  clauseDomId,
  displayHighlight,
  findingDomId,
  nextFocusRuleId,
  scrollTarget,
  type Highlight,
  type TextRun,
} from "./segments";

const TEXT = [
  "TITLE",
  "",
  "1. Term. Obligations survive for five (5) years after termination.",
  "2. Law. This Agreement is governed by the laws of New York.",
  "",
].join("\n");
const CLAUSES = segmentDocument(TEXT);
const [, c1, c2] = CLAUSES;

function cite(quote: string, occurrence = 0): Citation {
  let start = -1;
  for (let i = 0; i <= occurrence; i++) start = TEXT.indexOf(quote, start + 1);
  const clause = CLAUSES.find((c) => c.start <= start && start + quote.length <= c.end)!;
  return { clauseId: clause.id, start, end: start + quote.length };
}

function finding(ruleId: RuleId, overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId,
    ruleKind: RULE_KIND.REQUIRED,
    status: FINDING_STATUS.RISK_FOUND,
    confidence: CONFIDENCE.HIGH,
    source: FINDING_SOURCE.MODEL,
    citations: [],
    blockedCitations: [],
    redline: null,
    explanation: "",
    verifierNote: null,
    error: null,
    attempts: 1,
    ...overrides,
  };
}

/** Concatenated highlighted runs per Rule, read back from the original text. */
function highlightedText(runs: readonly TextRun[], ruleId: RuleId): string {
  return runs
    .filter((r) => r.highlights.some((h) => h.ruleId === ruleId))
    .map((r) => TEXT.slice(r.start, r.end))
    .join("");
}

describe("buildViewerBlocks", () => {
  it("covers the whole text exactly once, in order, with Clause and gap blocks", () => {
    const blocks = buildViewerBlocks(TEXT, CLAUSES, []);
    expect(blocks.map((b) => TEXT.slice(b.start, b.end)).join("")).toBe(TEXT);
    expect(blocks.flatMap((b) => b.runs).map((r) => TEXT.slice(r.start, r.end)).join("")).toBe(TEXT);
    expect(blocks.filter((b) => b.clause).map((b) => b.clause!.id)).toEqual(CLAUSES.map((c) => c.id));
    for (let i = 1; i < blocks.length; i++) expect(blocks[i].start).toBe(blocks[i - 1].end);
  });

  it("emits no highlights without Citations", () => {
    const runs = buildViewerBlocks(TEXT, CLAUSES, [finding(RULE_ID.GOVERNING_LAW)]).flatMap((b) => b.runs);
    expect(runs.every((r) => r.highlights.length === 0)).toBe(true);
  });

  it("highlights exactly the Citation's original span, coloured by recommended action", () => {
    const law = finding(RULE_ID.GOVERNING_LAW, { citations: [cite("governed by the laws of New York")] });
    const runs = buildViewerBlocks(TEXT, CLAUSES, [law]).flatMap((b) => b.runs);
    expect(highlightedText(runs, RULE_ID.GOVERNING_LAW)).toBe("governed by the laws of New York");
    const highlighted = runs.filter((r) => r.highlights.length > 0);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].highlights).toEqual([
      { ruleId: RULE_ID.GOVERNING_LAW, action: RECOMMENDED_ACTION.ESCALATE, citationIndex: 0 },
    ]);
    expect(highlighted[0].anchors).toEqual(highlighted[0].highlights);
  });

  it("splits overlapping Citations from different Findings and sorts the most severe first", () => {
    const term = finding(RULE_ID.CONFIDENTIALITY_TERM, {
      citations: [cite("Obligations survive for five (5) years")],
      redline: { kind: REDLINE_KIND.REPLACE, ...cite("five (5) years"), replacement: "two (2) years" },
    });
    const mutual = finding(RULE_ID.MUTUAL, {
      status: FINDING_STATUS.COMPLIANT,
      citations: [cite("five (5) years after termination.")],
    });
    const runs = buildViewerBlocks(TEXT, CLAUSES, [mutual, term]).flatMap((b) => b.runs);

    expect(highlightedText(runs, RULE_ID.CONFIDENTIALITY_TERM)).toBe("Obligations survive for five (5) years");
    expect(highlightedText(runs, RULE_ID.MUTUAL)).toBe("five (5) years after termination.");
    const shared = runs.find((r) => TEXT.slice(r.start, r.end) === "five (5) years")!;
    expect(shared.highlights.map((h) => h.action)).toEqual([RECOMMENDED_ACTION.FIX, RECOMMENDED_ACTION.NONE]);
    expect(shared.anchors.map((h) => h.ruleId)).toEqual([RULE_ID.MUTUAL]);
  });

  it("keeps adjacent Citations as separate runs", () => {
    const a = finding(RULE_ID.MUTUAL, { citations: [cite("Obligations survive")] });
    const b = finding(RULE_ID.NO_RESIDUALS, { ruleKind: RULE_KIND.PROHIBITED, citations: [cite(" for five (5) years")] });
    const runs = buildViewerBlocks(TEXT, CLAUSES, [a, b]).flatMap((block) => block.runs);
    const highlighted = runs.filter((r) => r.highlights.length > 0);
    expect(highlighted.map((r) => [TEXT.slice(r.start, r.end), r.highlights.map((h) => h.ruleId)])).toEqual([
      ["Obligations survive", [RULE_ID.MUTUAL]],
      [" for five (5) years", [RULE_ID.NO_RESIDUALS]],
    ]);
  });

  it("maps several Citations of one Finding back by index", () => {
    const f = finding(RULE_ID.MUTUAL, { citations: [cite("laws of New York"), cite("Obligations survive")] });
    const anchors = buildViewerBlocks(TEXT, CLAUSES, [f])
      .flatMap((b) => b.runs)
      .flatMap((r) => r.anchors.map((h) => [TEXT.slice(r.start, r.end), h.citationIndex]));
    expect(anchors).toEqual([
      ["Obligations survive", 1],
      ["laws of New York", 0],
    ]);
  });

  it("ignores Citations outside the Document instead of throwing", () => {
    const f = finding(RULE_ID.MUTUAL, { citations: [{ clauseId: c1.id, start: TEXT.length - 2, end: TEXT.length + 10 }] });
    const runs = buildViewerBlocks(TEXT, CLAUSES, [f]).flatMap((b) => b.runs);
    expect(runs.every((r) => r.highlights.length === 0)).toBe(true);
  });

  it("ignores blocked Citations: only verified offsets are highlighted", () => {
    const f = finding(RULE_ID.MUTUAL, { blockedCitations: [{ clauseId: c2.id, reason: BLOCKED_REASON.NOT_IN_CLAUSE }] });
    const runs = buildViewerBlocks(TEXT, CLAUSES, [f]).flatMap((b) => b.runs);
    expect(runs.every((r) => r.highlights.length === 0)).toBe(true);
  });
});

describe("nextFocusRuleId", () => {
  const h = (ruleId: RuleId): Highlight => ({ ruleId, action: RECOMMENDED_ACTION.FIX, citationIndex: 0 });
  const highlights = [h(RULE_ID.MUTUAL), h(RULE_ID.NO_RESIDUALS), h(RULE_ID.MUTUAL)];

  it("focuses the first (most severe) Finding when none of the run's is focused", () => {
    expect(nextFocusRuleId(highlights, null)).toBe(RULE_ID.MUTUAL);
    expect(nextFocusRuleId(highlights, RULE_ID.GOVERNING_LAW)).toBe(RULE_ID.MUTUAL);
  });

  it("cycles through distinct overlapping Findings", () => {
    expect(nextFocusRuleId(highlights, RULE_ID.MUTUAL)).toBe(RULE_ID.NO_RESIDUALS);
    expect(nextFocusRuleId(highlights, RULE_ID.NO_RESIDUALS)).toBe(RULE_ID.MUTUAL);
  });

  it("returns null for plain text", () => {
    expect(nextFocusRuleId([], RULE_ID.MUTUAL)).toBeNull();
  });
});

describe("displayHighlight", () => {
  const run: TextRun = {
    start: 0,
    end: 1,
    anchors: [],
    highlights: [
      { ruleId: RULE_ID.MUTUAL, action: RECOMMENDED_ACTION.ESCALATE, citationIndex: 0 },
      { ruleId: RULE_ID.NO_RESIDUALS, action: RECOMMENDED_ACTION.NONE, citationIndex: 0 },
    ],
  };

  it("prefers the focused Finding, else the most severe", () => {
    expect(displayHighlight(run, RULE_ID.NO_RESIDUALS)?.ruleId).toBe(RULE_ID.NO_RESIDUALS);
    expect(displayHighlight(run, null)?.ruleId).toBe(RULE_ID.MUTUAL);
    expect(displayHighlight({ ...run, highlights: [] }, null)).toBeNull();
  });
});

describe("scrollTarget", () => {
  it("targets the earliest Citation in document order", () => {
    const f = finding(RULE_ID.MUTUAL, { citations: [cite("laws of New York"), cite("Obligations survive")] });
    expect(scrollTarget(f, CLAUSES)).toEqual({ kind: "citation", ruleId: RULE_ID.MUTUAL, citationIndex: 1 });
  });

  it("falls back to a blocked Citation's real Clause", () => {
    const f = finding(RULE_ID.MUTUAL, {
      blockedCitations: [
        { clauseId: null, reason: BLOCKED_REASON.UNKNOWN_CLAUSE },
        { clauseId: c2.id, reason: BLOCKED_REASON.NOT_IN_CLAUSE },
      ],
    });
    expect(scrollTarget(f, CLAUSES)).toEqual({ kind: "clause", clauseId: c2.id });
  });

  it("falls back to an INSERT Redline's anchor Clause", () => {
    const f = finding(RULE_ID.GOVERNING_LAW, {
      status: FINDING_STATUS.NOT_FOUND,
      redline: { kind: REDLINE_KIND.INSERT, afterClauseId: c1.id, text: "Delaware law governs." },
    });
    expect(scrollTarget(f, CLAUSES)).toEqual({ kind: "clause", clauseId: c1.id });
  });

  it("is null for positionless Findings", () => {
    const error = finding(RULE_ID.MUTUAL, {
      status: FINDING_STATUS.ERROR,
      error: { kind: ERROR_KIND.API, message: "boom" },
      blockedCitations: [{ clauseId: "c-999", reason: BLOCKED_REASON.UNKNOWN_CLAUSE }],
    });
    expect(scrollTarget(error, CLAUSES)).toBeNull();
  });
});

describe("DOM ids", () => {
  it("are stable and derived from Clause and Rule IDs", () => {
    expect(clauseDomId("c-003")).toBe("clause-c-003");
    expect(findingDomId(RULE_ID.MUTUAL)).toBe("finding-MUTUAL");
    expect(citationKey(RULE_ID.MUTUAL, 2)).toBe("MUTUAL:2");
  });
});
