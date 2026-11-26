import { describe, expect, it } from "vitest";
import { segmentDocument } from "./segment";
import type { Clause } from "./types";

const textOf = (doc: string, clause: Clause) => doc.slice(clause.start, clause.end);
const labels = (clauses: Clause[]) => clauses.map((clause) => clause.label);

describe("segmentDocument", () => {
  it("returns no Clauses for empty or blank text", () => {
    expect(segmentDocument("")).toEqual([]);
    expect(segmentDocument("  \n\n \t\n")).toEqual([]);
  });

  it("cuts conventional 1. / 1.1 numbering at the deepest level with parents", () => {
    const doc = [
      "MUTUAL NONDISCLOSURE AGREEMENT",
      "",
      "1. Definitions",
      "1.1 \"Confidential Information\" means any information.",
      "1.2 \"Representatives\" means employees.",
      "2. Obligations",
      "Each party shall protect it.",
      "",
      "It continues here.",
    ].join("\n");
    const clauses = segmentDocument(doc);

    expect(labels(clauses)).toEqual(["P1", "§1", "§1.1", "§1.2", "§2"]);
    expect(clauses.map((c) => c.id)).toEqual(["c-001", "c-002", "c-003", "c-004", "c-005"]);
    expect(textOf(doc, clauses[1])).toBe("1. Definitions");
    expect(clauses[2]).toMatchObject({ parentId: "c-002", depth: 1 });
    expect(clauses[1]).toMatchObject({ parentId: null, depth: 0 });
    // Blank lines after the first marker don't split.
    expect(textOf(doc, clauses[4])).toBe("2. Obligations\nEach party shall protect it.\n\nIt continues here.");
  });

  it("handles ARTICLE / Section 1.01 headings", () => {
    const doc = [
      "ARTICLE I",
      "DEFINITIONS",
      "Section 1.01 Confidential Information. All information.",
      "Section 1.02 Purpose. The evaluation.",
      "ARTICLE II - OBLIGATIONS",
      "Section 2.01 Non-use.",
    ].join("\n");
    const clauses = segmentDocument(doc);

    expect(labels(clauses)).toEqual(["§1", "§1.01", "§1.02", "§2", "§2.01"]);
    expect(textOf(doc, clauses[0])).toBe("ARTICLE I\nDEFINITIONS");
    expect(clauses[1].parentId).toBe(clauses[0].id);
    expect(clauses[4].parentId).toBe(clauses[3].id);
  });

  it("splits a letter with no numbering into blank-line paragraphs", () => {
    const doc = "Dear Ms. Rivera,\n\nWe write to confirm\nthe terms below.\n\n\nSincerely,\nJ. Doe\n";
    const clauses = segmentDocument(doc);

    expect(labels(clauses)).toEqual(["P1", "P2", "P3"]);
    expect(textOf(doc, clauses[1])).toBe("We write to confirm\nthe terms below.");
    expect(textOf(doc, clauses[2])).toBe("Sincerely,\nJ. Doe");
    expect(clauses.every((c) => c.parentId === null && c.depth === 0)).toBe(true);
  });

  it("nests 1. → (a) → (i) and tells (i) the letter from (i) the numeral", () => {
    const doc = [
      "WHEREAS the parties wish to talk;",
      "",
      "NOW, THEREFORE, the parties agree:",
      "1. Definitions. In this Agreement:",
      "  (a) \"Affiliate\" means a controlled entity;",
      "  (b) \"Information\" includes:",
      "    (i) technical data;",
      "    (ii) business plans;",
      "  (c) \"Purpose\" means evaluation.",
      "  (d) d", "  (e) e", "  (f) f", "  (g) g", "  (h) h",
      "  (i) the ninth letter item.",
      "2. Term.",
    ].join("\n");
    const clauses = segmentDocument(doc);

    expect(labels(clauses)).toEqual([
      "P1", "P2", "§1", "§1(a)", "§1(b)", "§1(b)(i)", "§1(b)(ii)", "§1(c)",
      "§1(d)", "§1(e)", "§1(f)", "§1(g)", "§1(h)", "§1(i)", "§2",
    ]);
    const byLabel = new Map(clauses.map((c) => [c.label, c]));
    expect(byLabel.get("§1(b)(i)")).toMatchObject({ parentId: byLabel.get("§1(b)")!.id, depth: 2 });
    expect(byLabel.get("§1(i)")).toMatchObject({ parentId: byLabel.get("§1")!.id, depth: 1 });
    expect(textOf(doc, byLabel.get("§1(a)")!)).toBe("(a) \"Affiliate\" means a controlled entity;");
  });

  it("copes with PDF-style hard wraps and mixed Section 3 / 3.1", () => {
    const doc = [
      "Section 3. Term",
      "3.1 The obligations survive for a period of",
      "3 years as described in",
      "Section 3 of this Agreement and",
      "3.1 above.",
      "3.2  Each party may terminate.",
    ].join("\n");
    const clauses = segmentDocument(doc);

    expect(labels(clauses)).toEqual(["§3", "§3.1", "§3.2"]);
    expect(clauses[1].parentId).toBe(clauses[0].id);
    expect(textOf(doc, clauses[1])).toContain("3.1 above.");
  });

  it("handles CRLF line endings with exact offsets", () => {
    const doc = "1. First clause.\r\n2. Second clause.\r\n";
    const clauses = segmentDocument(doc);
    expect(clauses.map((c) => textOf(doc, c))).toEqual(["1. First clause.", "2. Second clause."]);
  });

  it("is deterministic and never overlaps Clauses", () => {
    const doc = "Title\n\n1. A\n(a) b\n(b) c\n2. D\n";
    const first = segmentDocument(doc);
    expect(segmentDocument(doc)).toEqual(first);
    for (let i = 1; i < first.length; i += 1) expect(first[i].start).toBeGreaterThanOrEqual(first[i - 1].end);
  });
});
