import { CONFIDENCE, ERROR_KIND, FINDING_SOURCE, FINDING_STATUS, REDLINE_KIND, type RuleId } from "@/common/constants";
import { sanitizeFreeText } from "@/features/citations/verify";
import { FindingSchema, type Finding, type FindingError } from "@/features/review/finding";
import { ruleById } from "./detector";
import type { RuleReviewContext, RuleReviewState } from "./state";

/**
 * `emit` node: turns per-rule state into the one domain Finding for the Rule.
 * Unresolved quote failures become Blocked Citations (their quotes are
 * dropped), free text is sanitized (ADR 0002), and the result is checked
 * against `FindingSchema`; anything invalid becomes an ERROR Finding. Never
 * throws.
 */
export function emitFinding(state: RuleReviewState, context: RuleReviewContext): Finding {
  const claim = state.claim;
  if (state.error || !claim) {
    return errorFinding(state.ruleId, state.attempts, state.error ?? { kind: ERROR_KIND.INTERNAL, message: "No result." });
  }

  try {
    const { index } = context.document;
    const citations = [...state.citations].sort((a, b) => a.start - b.start);
    const cited = new Set(citations.map((c) => c.clauseId));
    const redline =
      claim.status === FINDING_STATUS.COMPLIANT ||
      (state.redline?.kind === REDLINE_KIND.REPLACE && !cited.has(state.redline.clauseId))
        ? null
        : state.redline;

    const finding = {
      ruleId: state.ruleId,
      ruleKind: ruleById(state.ruleId).kind,
      status: claim.status,
      confidence: claim.confidence,
      source: state.source,
      citations,
      blockedCitations: state.citationFeedback
        .filter((failure) => failure.kind === "CITATION")
        .map((failure) => failure.blocked),
      redline,
      explanation: sanitizeFreeText(index, claim.explanation),
      verifierNote: state.verifierNote === null ? null : sanitizeFreeText(index, state.verifierNote),
      error: null,
      attempts: state.attempts,
    } satisfies Finding;

    const parsed = FindingSchema.safeParse(finding);
    if (parsed.success) return parsed.data;
    const issues = parsed.error.issues.map((issue) => issue.message).join("; ");
    return errorFinding(state.ruleId, state.attempts, { kind: ERROR_KIND.INTERNAL, message: `Invalid Finding: ${issues}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorFinding(state.ruleId, state.attempts, { kind: ERROR_KIND.INTERNAL, message });
  }
}

export function errorFinding(ruleId: RuleId, attempts: number, error: FindingError): Finding {
  return {
    ruleId,
    ruleKind: ruleById(ruleId).kind,
    status: FINDING_STATUS.ERROR,
    confidence: CONFIDENCE.LOW,
    source: FINDING_SOURCE.MODEL,
    citations: [],
    blockedCitations: [],
    redline: null,
    explanation: "",
    verifierNote: null,
    error,
    attempts,
  };
}
