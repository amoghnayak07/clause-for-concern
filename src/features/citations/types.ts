import type { BlockedReason } from "@/common/constants";
import type { ClauseId } from "@/features/document/types";

/** A verified pointer into the Document. No quote text is stored (ADR 0002). */
export interface Citation {
  readonly clauseId: ClauseId;
  readonly start: number;
  readonly end: number;
}

export interface BlockedCitation {
  /** Null when the model cited a Clause ID that doesn't exist. */
  readonly clauseId: ClauseId | null;
  readonly reason: BlockedReason;
}

/** A model-proposed Citation, before verification. */
export interface ProposedCitation {
  readonly clauseId: string;
  readonly quote: string;
}

export type QuoteVerification =
  | { readonly ok: true; readonly citation: Citation }
  | { readonly ok: false; readonly blocked: BlockedCitation };
