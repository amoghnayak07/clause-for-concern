/**
 * Matching normalization for quote verification (see docs/DESIGN.md
 * "Quote verification"):
 *
 *   NFKC → collapse whitespace → curly quotes to straight → en/em dash to "-"
 *   → drop soft hyphens. Case is preserved.
 *
 * Returns an offset map so a match in normalized text maps back to an exact
 * span of the original text.
 */
export interface NormalizedText {
  readonly text: string;
  /** Original offset where normalized char `i` starts. */
  readonly originalStart: readonly number[];
  /** Original offset (exclusive) where normalized char `i` ends. */
  readonly originalEnd: readonly number[];
}

/** Original span `[start, end)` covered by normalized range `[from, to)`. */
export function toOriginalSpan(normalized: NormalizedText, from: number, to: number): { start: number; end: number } {
  return { start: normalized.originalStart[from], end: normalized.originalEnd[to - 1] };
}

const SINGLE_QUOTES = new Set(["‘", "’", "‚", "‛", "′"]);
const DOUBLE_QUOTES = new Set(["“", "”", "„", "‟", "″"]);
const DASHES = new Set(["‐", "‑", "‒", "–", "—", "―", "−"]);
const SOFT_HYPHEN = "­";

// Built at runtime: Unicode property escapes need an ES2018 regex target.
const COMBINING_MARK = new RegExp("^\\p{M}$", "u");
const WHITESPACE = /^\s$/;

/**
 * Normalizes `text`, keeping an offset map. Each base character is normalized
 * together with its following combining marks, so decomposed and precomposed
 * accents compare equal.
 */
export function normalizeForMatching(text: string): NormalizedText {
  const out: string[] = [];
  const originalStart: number[] = [];
  const originalEnd: number[] = [];
  let pendingSpace: { start: number; end: number } | null = null;

  const emit = (char: string, start: number, end: number) => {
    if (pendingSpace) {
      if (out.length > 0) {
        out.push(" ");
        originalStart.push(pendingSpace.start);
        originalEnd.push(pendingSpace.end);
      }
      pendingSpace = null;
    }
    out.push(char);
    originalStart.push(start);
    originalEnd.push(end);
  };

  let index = 0;
  while (index < text.length) {
    const segmentStart = index;
    index += codePointLength(text, index);
    while (index < text.length && COMBINING_MARK.test(codePointAt(text, index))) {
      index += codePointLength(text, index);
    }
    const segmentEnd = index;

    for (const char of text.slice(segmentStart, segmentEnd).normalize("NFKC")) {
      if (char === SOFT_HYPHEN) continue;
      if (WHITESPACE.test(char)) {
        pendingSpace = pendingSpace
          ? { start: pendingSpace.start, end: segmentEnd }
          : { start: segmentStart, end: segmentEnd };
        continue;
      }
      emit(mapChar(char), segmentStart, segmentEnd);
    }
  }
  // Trailing whitespace is dropped, so the result is trimmed at both ends.

  return { text: out.join(""), originalStart, originalEnd };
}

function mapChar(char: string): string {
  if (SINGLE_QUOTES.has(char)) return "'";
  if (DOUBLE_QUOTES.has(char)) return '"';
  if (DASHES.has(char)) return "-";
  return char;
}

function codePointAt(text: string, index: number): string {
  return String.fromCodePoint(text.codePointAt(index) ?? 0);
}

function codePointLength(text: string, index: number): number {
  return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}
