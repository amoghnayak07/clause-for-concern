import { CITATION_RETRIES, CONFIDENCE, FINDING_SOURCE, FINDING_STATUS, REDLINE_KIND } from "@/common/constants";
import { findTriggerTerms } from "@/features/citations/triggers";
import type { Citation } from "@/features/citations/types";
import { verifyQuote } from "@/features/citations/verify";
import type { Redline } from "@/features/review/finding";
import { citesEvidence, ruleById } from "./detector";
import type { CitationFailure, Claim, RuleReviewContext, RuleReviewState, RuleReviewUpdate, TriggerHit } from "./state";

/**
 * `verifyCitations` node (code, no model). Verifies the detector's proposed
 * quotes and Redline target, then runs the Trigger Term sweep: when the model
 * reported no relevant Clause but a Trigger Term occurs, the Finding becomes a
 * LOW-confidence RISK_FOUND Possible Miss.
 */
export function verifyCitations(state: RuleReviewState, context: RuleReviewContext): RuleReviewUpdate {
  const { claim, proposals } = state;
  if (state.error || !claim || !proposals) return {};
  const { index } = context.document;

  const citations: Citation[] = [...state.citations];
  const failures: CitationFailure[] = [];
  let verifiedNow = 0;

  for (const proposed of proposals.citations) {
    const result = verifyQuote(index, proposed);
    if (!result.ok) {
      failures.push({ kind: "CITATION", proposed, blocked: result.blocked });
      continue;
    }
    verifiedNow++;
    if (!citations.some((c) => c.start === result.citation.start && c.end === result.citation.end)) {
      citations.push(result.citation);
    }
  }

  let redline: Redline | null = state.redline;
  if (claim.redline?.kind === REDLINE_KIND.REPLACE && proposals.redlineTarget) {
    const result = verifyQuote(index, proposals.redlineTarget);
    if (result.ok) {
      redline = { kind: REDLINE_KIND.REPLACE, ...result.citation, replacement: claim.redline.text };
    } else {
      failures.push({ kind: "REDLINE_TARGET", proposed: proposals.redlineTarget, blocked: result.blocked });
    }
  } else if (claim.redline?.kind === REDLINE_KIND.INSERT) {
    const after = claim.redline.clauseId;
    redline =
      after === null || index.byClauseId.has(after)
        ? { kind: REDLINE_KIND.INSERT, afterClauseId: after, text: claim.redline.text }
        : null;
  }

  const update: RuleReviewUpdate = { proposals: null, citations, citationFeedback: failures, redline };
  if (state.firstPassCitations === null) {
    update.firstPassCitations = { proposed: proposals.citations.length, verified: verifiedNow };
  }

  const rule = ruleById(state.ruleId);
  if (!citesEvidence(rule, claim)) {
    const hits = findTriggerTerms(index, rule);
    if (hits.length > 0) {
      update.claim = possibleMiss(claim, hits, context);
      update.source = FINDING_SOURCE.TRIGGER_TERM;
      update.triggerHits = hits;
      update.redline = null;
    }
  }
  return update;
}

function possibleMiss(claim: Claim, hits: readonly TriggerHit[], context: RuleReviewContext): Claim {
  const labels = hits.map((hit) => {
    const label = context.document.index.byClauseId.get(hit.clauseId)?.clause.label ?? hit.clauseId;
    return `${label} ("${hit.term}")`;
  });
  return {
    status: FINDING_STATUS.RISK_FOUND,
    confidence: CONFIDENCE.LOW,
    explanation: `Possible Miss: the agent reported no relevant clause (${claim.status}), but trigger terms appear in ${labels.join(", ")}.`,
    redline: null,
  };
}

export const AFTER_VERIFY_CITATIONS = {
  REPAIR: "detectRule",
  VERIFY_FINDING: "verifyFinding",
  EMIT: "emit",
} as const;
export type AfterVerifyCitations = (typeof AFTER_VERIFY_CITATIONS)[keyof typeof AFTER_VERIFY_CITATIONS];

/** Repair while failures remain and the retry budget allows; errors go straight to emit. */
export function routeAfterVerifyCitations(state: RuleReviewState): AfterVerifyCitations {
  if (state.error) return AFTER_VERIFY_CITATIONS.EMIT;
  if (state.citationFeedback.length > 0 && state.attempts <= CITATION_RETRIES) return AFTER_VERIFY_CITATIONS.REPAIR;
  return AFTER_VERIFY_CITATIONS.VERIFY_FINDING;
}
