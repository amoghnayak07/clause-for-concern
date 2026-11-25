import {
  CITATION_STATE,
  FINDING_STATUS,
  RECOMMENDED_ACTION,
  type CitationState,
  type RecommendedAction,
} from "@/common/constants";
import type { Finding } from "./finding";

/** Pure views of a Finding. Never stored; always recomputed (DESIGN "Types"). */

type CitationFields = Pick<Finding, "citations" | "blockedCitations">;

export function citationState(finding: CitationFields): CitationState {
  const verified = finding.citations.length;
  const blocked = finding.blockedCitations.length;
  if (verified === 0 && blocked === 0) return CITATION_STATE.NONE;
  if (verified === 0) return CITATION_STATE.BLOCKED;
  return blocked === 0 ? CITATION_STATE.VERIFIED : CITATION_STATE.PARTIAL;
}

/**
 * ESCALATE: ERROR, NOT_FOUND, Citation Blocked, or RISK_FOUND without a Redline.
 * FIX: RISK_FOUND with a Redline. NONE: COMPLIANT.
 */
export function recommendedAction(finding: Pick<Finding, "status" | "redline"> & CitationFields): RecommendedAction {
  if (finding.status === FINDING_STATUS.ERROR || finding.status === FINDING_STATUS.NOT_FOUND) {
    return RECOMMENDED_ACTION.ESCALATE;
  }
  if (citationState(finding) === CITATION_STATE.BLOCKED) return RECOMMENDED_ACTION.ESCALATE;
  if (finding.status === FINDING_STATUS.RISK_FOUND) {
    return finding.redline === null ? RECOMMENDED_ACTION.ESCALATE : RECOMMENDED_ACTION.FIX;
  }
  return RECOMMENDED_ACTION.NONE;
}
