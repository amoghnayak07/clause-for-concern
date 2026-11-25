import { APIUserAbortError } from "@anthropic-ai/sdk";
import {
  CONFIDENCE,
  EFFORT,
  FINDING_SOURCE,
  FINDING_STATUS,
  MAX_TOKENS,
  RULE_KIND,
  type PlaybookRule,
} from "@/common/constants";
import type { Citation } from "@/features/citations/types";
import { verifyQuote } from "@/features/citations/verify";
import type { ClauseId } from "@/features/document/types";
import { addUsage, callModel } from "./callModel";
import { ruleById } from "./detector";
import { VERIFIER_SYSTEM, verifierContent, type VerifierPromptInput } from "./prompts";
import { VerifierOutputSchema, type VerifierOutput } from "./schemas";
import type { CitationFailure, Claim, RuleReviewContext, RuleReviewState, RuleReviewUpdate } from "./state";

export const VERIFIER_UNAVAILABLE_NOTE = "Verifier unavailable; confidence lowered.";

/**
 * `verifyFinding` node. A second model pass that can only make a Finding
 * stricter: it may upgrade COMPLIANT / NOT_FOUND to RISK_FOUND (new quotes are
 * verified, with no retry) or lower confidence, never relax a status. If the
 * call fails the detector's Finding is kept at LOW confidence. ERROR skips.
 */
export async function verifyFinding(state: RuleReviewState, context: RuleReviewContext): Promise<RuleReviewUpdate> {
  const claim = state.claim;
  if (state.error || !claim) return {};
  const rule = ruleById(state.ruleId);

  try {
    const result = await callModel({
      client: context.client,
      model: context.model,
      schema: VerifierOutputSchema,
      system: VERIFIER_SYSTEM,
      content: verifierContent(context.document, promptInput(state, claim, rule, context)),
      effort: EFFORT.VERIFIER,
      maxTokens: MAX_TOKENS.VERIFIER,
      signal: context.signal,
    });
    const usage = { ...state.usage, VERIFY: addUsage(state.usage.VERIFY, result.usage) };
    if (!result.ok) return { usage, ...unavailable(claim) };
    return { usage, ...applyVerdict(state, claim, rule, result.output, context) };
  } catch (error) {
    if (error instanceof APIUserAbortError) throw error;
    return unavailable(claim);
  }
}

function unavailable(claim: Claim): RuleReviewUpdate {
  return { claim: { ...claim, confidence: CONFIDENCE.LOW }, verifierNote: VERIFIER_UNAVAILABLE_NOTE };
}

function promptInput(
  state: RuleReviewState,
  claim: Claim,
  rule: PlaybookRule,
  context: RuleReviewContext,
): VerifierPromptInput {
  const { document } = context;
  const citedText = state.citations.map((c) => ({
    label: document.index.byClauseId.get(c.clauseId)?.clause.label ?? c.clauseId,
    text: document.text.slice(c.start, c.end),
  }));
  return {
    rule,
    status: claim.status,
    explanation: claim.explanation,
    citedText,
    contextClauseIds: contextClauses(state, claim),
    triggerTerms: [...new Set(state.triggerHits.map((hit) => hit.term))],
  };
}

/**
 * RISK_FOUND sees its cited Clauses (or, for a Possible Miss, the Clauses with
 * Trigger Terms) plus Parents. COMPLIANT / NOT_FOUND see the whole Document so
 * a missed violation can be found. Null means the whole Document.
 */
export function contextClauses(state: RuleReviewState, claim: Claim): ClauseId[] | null {
  if (claim.status !== FINDING_STATUS.RISK_FOUND) return null;
  const ids = new Set<ClauseId>(state.citations.map((c) => c.clauseId));
  for (const failure of state.citationFeedback) if (failure.blocked.clauseId) ids.add(failure.blocked.clauseId);
  for (const hit of state.triggerHits) ids.add(hit.clauseId);
  return ids.size > 0 ? [...ids] : null;
}

/** Merges the verifier's view into the state without ever relaxing the Finding. */
export function applyVerdict(
  state: RuleReviewState,
  claim: Claim,
  rule: PlaybookRule,
  output: VerifierOutput,
  context: RuleReviewContext,
): RuleReviewUpdate {
  const verdict =
    rule.kind === RULE_KIND.PROHIBITED && output.status === FINDING_STATUS.NOT_FOUND
      ? FINDING_STATUS.COMPLIANT
      : output.status;
  const upgrade = verdict === FINDING_STATUS.RISK_FOUND && claim.status !== FINDING_STATUS.RISK_FOUND;
  const agrees = verdict === claim.status;

  const lowered =
    !agrees || upgrade || output.confidence === CONFIDENCE.LOW || state.source === FINDING_SOURCE.TRIGGER_TERM;
  const confidence = lowered ? CONFIDENCE.LOW : claim.confidence;

  const update: RuleReviewUpdate = upgrade
    ? {
        claim: { status: FINDING_STATUS.RISK_FOUND, confidence, explanation: output.note, redline: null },
        redline: null,
        verifierNote: `Upgraded from ${claim.status} by the verifier. The detector said: ${claim.explanation}`,
      }
    : { claim: { ...claim, confidence }, verifierNote: output.note };

  if (verdict === FINDING_STATUS.RISK_FOUND && output.newCitations.length > 0) {
    const citations: Citation[] = [...state.citations];
    const failures: CitationFailure[] = [...state.citationFeedback];
    for (const proposed of output.newCitations) {
      const result = verifyQuote(context.document.index, proposed);
      if (!result.ok) failures.push({ kind: "CITATION", proposed, blocked: result.blocked });
      else if (!citations.some((c) => c.start === result.citation.start && c.end === result.citation.end)) {
        citations.push(result.citation);
      }
    }
    update.citations = citations;
    update.citationFeedback = failures;
  }
  return update;
}
