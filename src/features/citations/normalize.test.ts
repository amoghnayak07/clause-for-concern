import { describe, expect, it } from "vitest";
import { normalizeForMatching, toOriginalSpan } from "./normalize";

describe("normalizeForMatching", () => {
  it("collapses and trims whitespace, including newlines and NBSP", () => {
    expect(normalizeForMatching("  a \n\t b  c  ").text).toBe("a b c");
  });

  it("straightens curly quotes and maps dashes to hyphens", () => {
    expect(normalizeForMatching("“Party”’s term – two — years").text).toBe(
      "\"Party\"'s term - two - years",
    );
  });

  it("drops soft hyphens", () => {
    expect(normalizeForMatching("confi­dential").text).toBe("confidential");
  });

  it("applies NFKC, composing decomposed accents and expanding ligatures", () => {
    expect(normalizeForMatching("Café").text).toBe("Café");
    expect(normalizeForMatching("ﬁnal").text).toBe("final");
  });

  it("is case-sensitive", () => {
    expect(normalizeForMatching("Party").text).not.toBe(normalizeForMatching("party").text);
  });

  it("maps normalized ranges back to exact original spans", () => {
    const original = "The  “Recipient”\nshall­not — ever";
    const normalized = normalizeForMatching(original);
    const needle = '"Recipient" shallnot - ever';
    const at = normalized.text.indexOf(needle);
    expect(at).toBeGreaterThanOrEqual(0);
    const span = toOriginalSpan(normalized, at, at + needle.length);
    expect(original.slice(span.start, span.end)).toBe("“Recipient”\nshall­not — ever");
  });

  it("maps a match ending on a decomposed accent to the full grapheme", () => {
    const original = "Café terms";
    const normalized = normalizeForMatching(original);
    const span = toOriginalSpan(normalized, 0, 4);
    expect(original.slice(span.start, span.end)).toBe("Café");
  });
});
