import { FINDING_SOURCE, type Confidence, type FindingSource, type RuleId } from "@/common/constants";
import type { BlockedCitation, Citation, ProposedCitation } from "@/features/citations/types";
import { createCitationIndex, type CitationIndex } from "@/features/citations/verify";
import type { Clause, ClauseId } from "@/features/document/types";
import type { FindingError, Redline } from "@/features/review/finding";
import { ZERO_USAGE, type ModelClient, type TokenUsage } from "./callModel";
import type { DetectorOutput } from "./schemas";

/**
 * Per-rule review state and the context its steps run in. The steps
 * (`detectRule`, `verifyCitations`, `verifyFinding`, `emitFinding`) are plain
 * functions over this state so the graph only wires them together (ADR 0001).
 *
 * Model quotes live here only until verified; they are never part of a Finding
 * (ADR 0002).
 */

/** One Document, segmented and indexed once per review. */
export interface ReviewDocument {
  readonly text: string;
  readonly clauses: readonly Clause[];
  readonly index: CitationIndex;
}

export function createReviewDocument(text: string, clauses: readonly Clause[]): ReviewDocument {
  return { text, clauses, index: createCitationIndex(text, clauses) };
}

export interface RuleReviewContext {
  readonly client: ModelClient;
  readonly model: string;
  readonly document: ReviewDocument;
  readonly signal?: AbortSignal;
}

export type ModelStatus = DetectorOutput["status"];

/** The detector's verdict, after Playbook normalization (see `normalizeClaim`). */
export interface Claim {
  readonly status: ModelStatus;
  readonly confidence: Confidence;
  readonly explanation: string;
  /** The proposed Redline before its target is verified. */
  readonly redline: DetectorOutput["redline"];
}

/** A proposed quote that failed verification, kept for the repair prompt. */
export interface CitationFailure {
  /** CITATION: evidence quote. REDLINE_TARGET: the text a REPLACE Redline would edit. */
  readonly kind: "CITATION" | "REDLINE_TARGET";
  readonly proposed: ProposedCitation;
  readonly blocked: BlockedCitation;
}

/** Quotes awaiting verification, written by the detector, consumed by `verifyCitations`. */
export interface Proposals {
  readonly citations: readonly ProposedCitation[];
  readonly redlineTarget: ProposedCitation | null;
}

/** A Clause where a Trigger Term occurs. */
export interface TriggerHit {
  readonly clauseId: ClauseId;
  readonly term: string;
}

export const MODEL_PASS = {
  DETECT: "DETECT",
  REPAIR: "REPAIR",
  VERIFY: "VERIFY",
} as const;
export type ModelPass = (typeof MODEL_PASS)[keyof typeof MODEL_PASS];

export interface RuleReviewState {
  readonly ruleId: RuleId;
  /** Detector passes made: the first pass plus citation repairs. */
  readonly attempts: number;
  readonly claim: Claim | null;
  readonly source: FindingSource;
  readonly proposals: Proposals | null;
  readonly citations: readonly Citation[];
  /** Failures from the latest verification; non-empty means repair is wanted. */
  readonly citationFeedback: readonly CitationFailure[];
  /** Verified REPLACE (or INSERT) Redline. */
  readonly redline: Redline | null;
  readonly triggerHits: readonly TriggerHit[];
  readonly verifierNote: string | null;
  readonly error: FindingError | null;
  /** First-pass citation verification, for the eval's first-try pass rate. */
  readonly firstPassCitations: { readonly proposed: number; readonly verified: number } | null;
  readonly usage: Readonly<Record<ModelPass, TokenUsage>>;
}

export function initialRuleState(ruleId: RuleId): RuleReviewState {
  return {
    ruleId,
    attempts: 0,
    claim: null,
    source: FINDING_SOURCE.MODEL,
    proposals: null,
    citations: [],
    citationFeedback: [],
    redline: null,
    triggerHits: [],
    verifierNote: null,
    error: null,
    firstPassCitations: null,
    usage: { DETECT: ZERO_USAGE, REPAIR: ZERO_USAGE, VERIFY: ZERO_USAGE },
  };
}

/** Each step returns only the fields it changes, like a graph node. */
export type RuleReviewUpdate = { -readonly [K in keyof RuleReviewState]?: RuleReviewState[K] };
