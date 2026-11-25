import { BLOCKED_REASON, MIN_QUOTE_CHARS, MIN_SANITIZED_QUOTE_CHARS, UNVERIFIED_QUOTE_PLACEHOLDER } from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import { normalizeForMatching, toOriginalSpan, type NormalizedText } from "./normalize";
import type { ProposedCitation, QuoteVerification } from "./types";

/**
 * Normalized views of one Document and its Clauses, built once per review and
 * reused for every quote check.
 */
export interface CitationIndex {
  readonly clauses: readonly Clause[];
  readonly document: NormalizedText;
  readonly byClauseId: ReadonlyMap<ClauseId, { clause: Clause; normalized: NormalizedText }>;
}

export function createCitationIndex(documentText: string, clauses: readonly Clause[]): CitationIndex {
  const byClauseId = new Map<ClauseId, { clause: Clause; normalized: NormalizedText }>();
  for (const clause of clauses) {
    byClauseId.set(clause.id, {
      clause,
      normalized: normalizeForMatching(documentText.slice(clause.start, clause.end)),
    });
  }
  return { clauses, document: normalizeForMatching(documentText), byClauseId };
}

/**
 * Proves a model quote occurs (contiguously, case-sensitive, after
 * normalization) inside the cited Clause. First occurrence wins. On success the
 * Citation carries exact offsets into the original Document.
 */
export function verifyQuote(index: CitationIndex, proposed: ProposedCitation): QuoteVerification {
  const entry = index.byClauseId.get(proposed.clauseId);
  if (!entry) return { ok: false, blocked: { clauseId: null, reason: BLOCKED_REASON.UNKNOWN_CLAUSE } };

  const quote = normalizeForMatching(proposed.quote).text;
  const minLength = Math.min(MIN_QUOTE_CHARS, entry.normalized.text.length);
  if (quote.length === 0 || quote.length < minLength) {
    return { ok: false, blocked: { clauseId: entry.clause.id, reason: BLOCKED_REASON.TOO_SHORT } };
  }

  const at = entry.normalized.text.indexOf(quote);
  if (at !== -1) {
    const span = toOriginalSpan(entry.normalized, at, at + quote.length);
    return {
      ok: true,
      citation: { clauseId: entry.clause.id, start: entry.clause.start + span.start, end: entry.clause.start + span.end },
    };
  }

  for (const other of index.byClauseId.values()) {
    if (other.clause.id !== entry.clause.id && other.normalized.text.includes(quote)) {
      return { ok: false, blocked: { clauseId: entry.clause.id, reason: BLOCKED_REASON.FOUND_IN_OTHER_CLAUSE } };
    }
  }
  return { ok: false, blocked: { clauseId: entry.clause.id, reason: BLOCKED_REASON.NOT_IN_CLAUSE } };
}

// Double-quoted runs, straight or curly. Single quotes are skipped: they collide with apostrophes.
const QUOTED_RUN = /"([^"\n]*)"|“([^“”\n]*)”/g;

/**
 * Replaces quoted passages in model free text (explanation, verifier note) that
 * don't occur anywhere in the Document with a placeholder (ADR 0002). Runs
 * shorter than `MIN_SANITIZED_QUOTE_CHARS` after normalization are left alone.
 */
export function sanitizeFreeText(index: CitationIndex, text: string): string {
  return text.replace(QUOTED_RUN, (match: string, straight?: string, curly?: string) => {
    const inner = normalizeForMatching(straight ?? curly ?? "").text;
    if (inner.length < MIN_SANITIZED_QUOTE_CHARS) return match;
    return index.document.text.includes(inner) ? match : UNVERIFIED_QUOTE_PLACEHOLDER;
  });
}
