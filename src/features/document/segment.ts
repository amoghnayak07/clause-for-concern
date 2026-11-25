import { CLAUSE_ID_PAD_LENGTH, CLAUSE_ID_PREFIX, CLAUSE_LABEL_PREFIX } from "@/common/constants";
import type { Clause, ClauseId } from "./types";

/**
 * Deterministic Clause splitter (see docs/DESIGN.md "Segmentation").
 *
 * - A Clause starts at every numbered marker at the start of a line:
 *   `ARTICLE IV`, `Section 3`, `Section 1.01`, `1.`, `3.2`, `(a)`, `(i)`, `(A)`, `(1)`.
 *   Each Clause runs until the next marker, so a Parent Clause's span is only its
 *   intro text and every Clause is cut at the deepest level present.
 * - Text before the first marker (title, parties, recitals, or a whole letter
 *   with no numbering) is split into blank-line paragraphs.
 * - After the first marker, blank lines do not split: headings stay with their body.
 *
 * Offsets index into the untouched Document text; IDs are positional, so the
 * same input always yields the same Clauses.
 */
export function segmentDocument(text: string): Clause[] {
  const starts = findClauseStarts(text);
  const clauses: Clause[] = [];

  starts.forEach((clauseStart, index) => {
    const limit = index + 1 < starts.length ? starts[index + 1].offset : text.length;
    clauses.push({
      id: clauseId(index),
      label: clauseStart.label,
      parentId: clauseStart.parentIndex === null ? null : clauseId(clauseStart.parentIndex),
      depth: clauseStart.depth,
      start: clauseStart.offset,
      end: trimEnd(text, clauseStart.offset, limit),
    });
  });

  return clauses;
}

export function clauseId(index: number): ClauseId {
  return `${CLAUSE_ID_PREFIX}${String(index + 1).padStart(CLAUSE_ID_PAD_LENGTH, "0")}`;
}

/* ------------------------------------------------------------------------ */
/* Clause starts                                                             */
/* ------------------------------------------------------------------------ */

interface ClauseStart {
  offset: number;
  label: string;
  parentIndex: number | null;
  depth: number;
}

interface Line {
  /** Offset of the first non-whitespace character (or line end if blank). */
  contentStart: number;
  /** Line text from `contentStart`, without the line terminator. */
  content: string;
  blank: boolean;
}

interface OpenLevel {
  type: LevelType;
  token: string;
  label: string;
  clauseIndex: number;
}

function findClauseStarts(text: string): ClauseStart[] {
  const starts: ClauseStart[] = [];
  const stack: OpenLevel[] = [];
  let paragraphCount = 0;
  let seenMarker = false;
  let previousBlank = true;

  for (const line of splitLines(text)) {
    if (line.blank) {
      previousBlank = true;
      continue;
    }

    const marker = parseMarker(line.content, stack);
    if (marker) {
      seenMarker = true;
      const parent = placeInStack(stack, marker);
      const clauseIndex = starts.length;
      const label = labelFor(marker, parent);
      starts.push({
        offset: line.contentStart,
        label,
        parentIndex: parent ? parent.clauseIndex : null,
        depth: stack.length,
      });
      stack.push({ type: marker.type, token: marker.token, label, clauseIndex });
    } else if (!seenMarker && previousBlank) {
      paragraphCount += 1;
      starts.push({
        offset: line.contentStart,
        label: `${CLAUSE_LABEL_PREFIX.PARAGRAPH}${paragraphCount}`,
        parentIndex: null,
        depth: 0,
      });
    }
    previousBlank = false;
  }

  return starts;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    let contentStart = lineStart;
    while (contentStart < lineEnd && isWhitespace(text[contentStart])) contentStart += 1;
    const content = text.slice(contentStart, lineEnd).replace(/\r$/, "");
    lines.push({ contentStart, content, blank: content.trim().length === 0 });
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  return lines;
}

/**
 * Pops the stack to where `marker` belongs and returns its parent level (the
 * new top), or null for a top-level Clause. The caller pushes the marker.
 */
function placeInStack(stack: OpenLevel[], marker: Marker): OpenLevel | null {
  if (marker.type === "article") {
    stack.length = 0;
  } else if (marker.type.startsWith("dot")) {
    const segments = dottedSegments(marker.type);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const keep = top.type === "article" || (top.type.startsWith("dot") && dottedSegments(top.type) < segments);
      if (keep) break;
      stack.pop();
    }
  } else {
    const existing = findLastIndex(stack, (level) => level.type === marker.type);
    if (existing !== -1) stack.length = existing;
  }
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

function labelFor(marker: Marker, parent: OpenLevel | null): string {
  if (marker.type === "article" || marker.type.startsWith("dot")) {
    return `${CLAUSE_LABEL_PREFIX.NUMBERED}${marker.token}`;
  }
  const base = parent ? parent.label : CLAUSE_LABEL_PREFIX.NUMBERED;
  return `${base}(${marker.token})`;
}

/* ------------------------------------------------------------------------ */
/* Markers                                                                   */
/* ------------------------------------------------------------------------ */

type DottedType = `dot${number}`;
type ParenType = "paren-digit" | "paren-lower" | "paren-lower-roman" | "paren-upper" | "paren-upper-roman";
type LevelType = "article" | DottedType | ParenType;

interface Marker {
  type: LevelType;
  /** Normalized numbering token: "4" for ARTICLE IV, "3.2", "a", "ii". */
  token: string;
}

const ARTICLE_RE = /^(?:ARTICLE|Article)\s+([IVXLC]+|\d{1,3})\b(.*)$/;
const SECTION_RE = /^(?:SECTION|Section)\s+(\d{1,3}(?:\.\d{1,3})*)\b(.*)$/;
const DOTTED_RE = /^(\d{1,3}(?:\.\d{1,3})*)(\.?)(?=\s|$)(.*)$/;
const PAREN_RE = /^\((\d{1,2}|[a-z]{1,4}|[A-Z]{1,4})\)(?=\s|$)/;

function parseMarker(content: string, stack: readonly OpenLevel[]): Marker | null {
  const article = ARTICLE_RE.exec(content);
  if (article && looksLikeHeading(article[2])) {
    const value = /^\d+$/.test(article[1]) ? Number(article[1]) : romanValue(article[1]);
    if (value !== null && value > 0) return { type: "article", token: String(value) };
  }

  const section = SECTION_RE.exec(content);
  if (section && looksLikeHeading(section[2])) return dottedMarker(section[1]);

  const dotted = DOTTED_RE.exec(content);
  if (dotted && looksLikeHeading(dotted[3])) {
    const singleSegment = !dotted[1].includes(".");
    // A bare number needs its trailing dot ("1."), otherwise "30 days" on a wrapped line would split.
    if (!singleSegment || dotted[2] === ".") return dottedMarker(dotted[1]);
  }

  const paren = PAREN_RE.exec(content);
  if (paren) return parenMarker(paren[1], stack);

  return null;
}

function dottedMarker(token: string): Marker {
  return { type: `dot${token.split(".").length}`, token };
}

function dottedSegments(type: LevelType): number {
  return Number(type.slice("dot".length));
}

/**
 * Rejects cross-references on wrapped lines ("Section 3 of this Agreement",
 * "3.1 above"): after the marker, the text must be empty, punctuation, or
 * something that does not start with a lowercase word.
 */
function looksLikeHeading(rest: string): boolean {
  const trimmed = rest.replace(/^[\s.:\-–—]+/, "");
  return trimmed.length === 0 || !/^[a-z]/.test(trimmed);
}

function parenMarker(token: string, stack: readonly OpenLevel[]): Marker | null {
  if (/^\d+$/.test(token)) return { type: "paren-digit", token };

  const lower = token === token.toLowerCase();
  const alphaType: ParenType = lower ? "paren-lower" : "paren-upper";
  const romanType: ParenType = lower ? "paren-lower-roman" : "paren-upper-roman";
  const isRoman = romanValue(token) !== null;

  // Continuing an open list wins, so "(i)" after "(h)" is a letter and "(v)" after "(iv)" a numeral.
  const openAlpha = findLast(stack, (level) => level.type === alphaType);
  if (openAlpha && token.length === 1 && token.charCodeAt(0) === openAlpha.token.charCodeAt(0) + 1) {
    return { type: alphaType, token };
  }
  const openRoman = findLast(stack, (level) => level.type === romanType);
  if (openRoman && isRoman && romanValue(token) === (romanValue(openRoman.token) ?? 0) + 1) {
    return { type: romanType, token };
  }

  if (isRoman && (token.length > 1 || token.toLowerCase() === "i")) return { type: romanType, token };
  if (token.length === 1) return { type: alphaType, token };
  if (/^(.)\1*$/.test(token)) return { type: alphaType, token }; // "(aa)" style lists
  return null;
}

const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
const ROMAN_DIGITS: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanValue(token: string): number | null {
  const upper = token.toUpperCase();
  if (upper.length === 0 || !ROMAN_RE.test(upper)) return null;
  let total = 0;
  for (let i = 0; i < upper.length; i += 1) {
    const value = ROMAN_DIGITS[upper[i]];
    const next = i + 1 < upper.length ? ROMAN_DIGITS[upper[i + 1]] : 0;
    total += value < next ? -value : value;
  }
  return total;
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function trimEnd(text: string, start: number, limit: number): number {
  let end = limit;
  while (end > start && isWhitespace(text[end - 1])) end -= 1;
  return end;
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (predicate(items[i])) return i;
  return -1;
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  const index = findLastIndex(items, predicate);
  return index === -1 ? undefined : items[index];
}
