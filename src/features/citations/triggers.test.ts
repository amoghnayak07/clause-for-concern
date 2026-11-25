import { describe, expect, it } from "vitest";
import { segmentDocument } from "@/features/document/segment";
import { findTriggerTerms } from "./triggers";
import { createCitationIndex } from "./verify";

const index = (text: string) => createCitationIndex(text, segmentDocument(text));

describe("findTriggerTerms", () => {
  const text = [
    "1. Neither party shall SOLICIT the other's staff.",
    "2. Neither party shall hire or solicit employees.",
    "3. Governing law is Delaware.",
  ].join("\n");

  it("returns one case-insensitive hit per Clause, using the first listed term that occurs", () => {
    expect(findTriggerTerms(index(text), { triggerTerms: ["solicit", "hire"] })).toEqual([
      { clauseId: "c-001", term: "solicit" },
      { clauseId: "c-002", term: "solicit" },
    ]);
  });

  it("matches inside longer words and across normalized whitespace", () => {
    const doc = index("1. No solicitation of\n   unaided   memory rights.");
    expect(findTriggerTerms(doc, { triggerTerms: ["unaided memory"] })).toEqual([{ clauseId: "c-001", term: "unaided memory" }]);
    expect(findTriggerTerms(doc, { triggerTerms: ["solicit"] })).toHaveLength(1);
  });

  it("returns nothing when no term occurs", () => {
    expect(findTriggerTerms(index(text), { triggerTerms: ["residual"] })).toEqual([]);
  });
});
