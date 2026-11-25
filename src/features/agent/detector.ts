import { APIUserAbortError } from "@anthropic-ai/sdk";
import {
  EFFORT,
  ERROR_KIND,
  FINDING_STATUS,
  MAX_TOKENS,
  PLAYBOOK,
  REDLINE_KIND,
  RULE_KIND,
  type PlaybookRule,
  type RuleId,
} from "@/common/constants";
import type { ProposedCitation } from "@/features/citations/types";
import { addUsage, callModel } from "./callModel";
import { DETECTOR_SYSTEM, detectorContent, repairContent } from "./prompts";
import { CitationRepairOutputSchema, DetectorOutputSchema, type DetectorOutput } from "./schemas";
import type { Claim, Proposals, RuleReviewContext, RuleReviewState, RuleReviewUpdate } from "./state";

export function ruleById(ruleId: RuleId): PlaybookRule {
  const rule = PLAYBOOK.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Unknown Rule ${ruleId}`);
  return rule;
}

/**
 * `detectRule` node. First pass: checks the whole Document against one Rule.
 * Repair mode (when `citationFeedback` is non-empty): a fresh single-turn
 * prompt re-asking only the failed quotes; status, explanation and verified
 * Citations are kept. Never throws, except to end an aborted run.
 */
export async function detectRule(state: RuleReviewState, context: RuleReviewContext): Promise<RuleReviewUpdate> {
  try {
    return state.citationFeedback.length > 0 && state.claim
      ? await repair(state, state.claim, context)
      : await firstPass(state, context);
  } catch (error) {
    if (error instanceof APIUserAbortError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { error: { kind: ERROR_KIND.INTERNAL, message } };
  }
}

async function firstPass(state: RuleReviewState, context: RuleReviewContext): Promise<RuleReviewUpdate> {
  const rule = ruleById(state.ruleId);
  const result = await callModel({
    client: context.client,
    model: context.model,
    schema: DetectorOutputSchema,
    system: DETECTOR_SYSTEM,
    content: detectorContent(context.document, rule),
    effort: EFFORT.DETECTOR,
    maxTokens: MAX_TOKENS.DETECTOR,
    signal: context.signal,
  });
  const usage = { ...state.usage, DETECT: addUsage(state.usage.DETECT, result.usage) };
  if (!result.ok) return { attempts: state.attempts + 1, usage, error: result.error };

  const claim = normalizeClaim(rule, result.output);
  return {
    attempts: state.attempts + 1,
    usage,
    claim,
    proposals: {
      citations: citesEvidence(rule, claim) ? result.output.citations : [],
      redlineTarget: redlineTargetOf(claim),
    },
  };
}

async function repair(state: RuleReviewState, claim: Claim, context: RuleReviewContext): Promise<RuleReviewUpdate> {
  const rule = ruleById(state.ruleId);
  const failures = state.citationFeedback;
  const result = await callModel({
    client: context.client,
    model: context.model,
    schema: CitationRepairOutputSchema,
    system: DETECTOR_SYSTEM,
    content: repairContent(context.document, rule, claim, failures),
    effort: EFFORT.DETECTOR,
    maxTokens: MAX_TOKENS.DETECTOR,
    signal: context.signal,
  });
  const usage = { ...state.usage, REPAIR: addUsage(state.usage.REPAIR, result.usage) };

  // A failed repair call is not a failed Rule: re-verify the original quotes so
  // they end up as Blocked Citations, and keep everything already verified.
  const repairs = result.ok ? result.output.repairs : [];
  const redlineFix = result.ok ? result.output.redlineTarget : null;

  const citations: ProposedCitation[] = [];
  let redlineTarget: ProposedCitation | null = null;
  let redline = claim.redline;

  for (const [i, failure] of failures.entries()) {
    if (failure.kind === "REDLINE_TARGET") {
      if (redlineFix && redline) {
        redline = { ...redline, targetQuote: redlineFix.targetQuote, text: redlineFix.text };
        redlineTarget = { clauseId: failure.proposed.clauseId, quote: redlineFix.targetQuote };
      } else {
        redlineTarget = failure.proposed;
      }
      continue;
    }
    const fix = repairs.find((r) => r.item === i + 1);
    citations.push(fix ? { clauseId: fix.clauseId, quote: fix.quote } : failure.proposed);
  }

  return {
    attempts: state.attempts + 1,
    usage,
    claim: { ...claim, redline },
    proposals: { citations, redlineTarget } satisfies Proposals,
    citationFeedback: [],
  };
}

/**
 * Applies the Playbook to the model's answer so impossible states never reach
 * verification: PROHIBITED absence is COMPLIANT (never NOT_FOUND); COMPLIANT
 * has no Redline; REPLACE only on RISK_FOUND, INSERT only on NOT_FOUND.
 */
export function normalizeClaim(rule: PlaybookRule, output: DetectorOutput): Claim {
  const status =
    rule.kind === RULE_KIND.PROHIBITED && output.status === FINDING_STATUS.NOT_FOUND
      ? FINDING_STATUS.COMPLIANT
      : output.status;

  let redline = output.redline;
  if (redline) {
    const fitsStatus =
      (redline.kind === REDLINE_KIND.REPLACE &&
        status === FINDING_STATUS.RISK_FOUND &&
        redline.clauseId !== null &&
        redline.targetQuote !== null) ||
      (redline.kind === REDLINE_KIND.INSERT && status === FINDING_STATUS.NOT_FOUND && redline.text.trim() !== "");
    if (!fitsStatus) redline = null;
  }

  return { status, confidence: output.confidence, explanation: output.explanation, redline };
}

/** NOT_FOUND and PROHIBITED COMPLIANT mean "no relevant Clause": nothing to cite. */
export function citesEvidence(rule: PlaybookRule, claim: Pick<Claim, "status">): boolean {
  if (claim.status === FINDING_STATUS.NOT_FOUND) return false;
  return !(claim.status === FINDING_STATUS.COMPLIANT && rule.kind === RULE_KIND.PROHIBITED);
}

function redlineTargetOf(claim: Claim): ProposedCitation | null {
  const redline = claim.redline;
  if (redline?.kind !== REDLINE_KIND.REPLACE || redline.clauseId === null || redline.targetQuote === null) return null;
  return { clauseId: redline.clauseId, quote: redline.targetQuote };
}
