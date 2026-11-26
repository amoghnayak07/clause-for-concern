import { describe, expect, it } from "vitest";
import { BLOCKED_REASON, UNVERIFIED_QUOTE_PLACEHOLDER } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import { createCitationIndex, sanitizeFreeText, verifyQuote } from "./verify";

const DOC = [
  "1. Definitions",
  "1.1 “Confidential Information” means all non‑public information disclosed by either party.",
  "1.2 Term.",
  "2. Obligations",
  "2.1 The Receiving Party shall hold Confidential Information in strict",
  "confidence for a period of two (2) years — and no longer.",
  "2.2 The Receiving Party shall hold Confidential Information in strict confidence.",
].join("\n");

const clauses = segmentDocument(DOC);
const index = createCitationIndex(DOC, clauses);
const idOf = (label: string) => clauses.find((c) => c.label === label)!.id;

describe("verifyQuote", () => {
  it("verifies a quote across a hard line break and dash, returning original offsets", () => {
    const result = verifyQuote(index, {
      clauseId: idOf("§2.1"),
      quote: "in strict confidence for a period of two (2) years - and no longer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.citation.clauseId).toBe(idOf("§2.1"));
    expect(DOC.slice(result.citation.start, result.citation.end)).toBe(
      "in strict\nconfidence for a period of two (2) years — and no longer",
    );
  });

  it("matches straight quotes in the model output against curly quotes in the Document", () => {
    const result = verifyQuote(index, { clauseId: idOf("§1.1"), quote: '"Confidential Information" means all' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(DOC.slice(result.citation.start, result.citation.end)).toBe("“Confidential Information” means all");
  });

  it("uses the first occurrence within the cited Clause", () => {
    const quote = "The Receiving Party shall hold";
    const result = verifyQuote(index, { clauseId: idOf("§2.2"), quote });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.citation.start).toBe(DOC.lastIndexOf(quote));
  });

  it("blocks an unknown Clause ID with a null clauseId", () => {
    expect(verifyQuote(index, { clauseId: "c-999", quote: "The Receiving Party shall hold" })).toEqual({
      ok: false,
      blocked: { clauseId: null, reason: BLOCKED_REASON.UNKNOWN_CLAUSE },
    });
  });

  it("blocks quotes shorter than the minimum", () => {
    expect(verifyQuote(index, { clauseId: idOf("§2.1"), quote: "strict confidence" })).toEqual({
      ok: false,
      blocked: { clauseId: idOf("§2.1"), reason: BLOCKED_REASON.TOO_SHORT },
    });
    expect(verifyQuote(index, { clauseId: idOf("§2.1"), quote: "   " }).ok).toBe(false);
  });

  it("accepts the whole Clause when the Clause itself is shorter than the minimum", () => {
    const result = verifyQuote(index, { clauseId: idOf("§1.2"), quote: "1.2 Term." });
    expect(result.ok).toBe(true);
  });

  it("reports a quote that lives in a different Clause", () => {
    expect(verifyQuote(index, { clauseId: idOf("§2.1"), quote: "means all non-public information" })).toEqual({
      ok: false,
      blocked: { clauseId: idOf("§2.1"), reason: BLOCKED_REASON.FOUND_IN_OTHER_CLAUSE },
    });
  });

  it("rejects paraphrases, ellipses and case changes as NOT_IN_CLAUSE", () => {
    for (const quote of [
      "shall keep Confidential Information in strict confidence",
      "The Receiving Party ... for a period of two (2) years",
      "the receiving party shall hold confidential information",
    ]) {
      expect(verifyQuote(index, { clauseId: idOf("§2.1"), quote })).toEqual({
        ok: false,
        blocked: { clauseId: idOf("§2.1"), reason: BLOCKED_REASON.NOT_IN_CLAUSE },
      });
    }
  });

  it("does not let a quote span from a Parent Clause into its child", () => {
    const result = verifyQuote(index, { clauseId: idOf("§2.1"), quote: "2. Obligations 2.1 The Receiving Party" });
    expect(result).toMatchObject({ ok: false, blocked: { reason: BLOCKED_REASON.NOT_IN_CLAUSE } });
  });
});

describe("sanitizeFreeText", () => {
  it("keeps verified quotes and short quotes, removes unverified long ones", () => {
    const text =
      'The clause says "for a period of two (2) years - and no longer" but also “shall survive in perpetuity forever”; see "Term".';
    expect(sanitizeFreeText(index, text)).toBe(
      `The clause says "for a period of two (2) years - and no longer" but also ${UNVERIFIED_QUOTE_PLACEHOLDER}; see "Term".`,
    );
  });

  it("checks against the whole Document, across Clause boundaries", () => {
    const text = 'It reads "1.2 Term. 2. Obligations 2.1 The Receiving".';
    expect(sanitizeFreeText(index, text)).toBe(text);
  });
});
