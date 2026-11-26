import { REVIEW_PHASE, REVIEW_UI_TEXT, STREAM_EVENT, type ReviewPhase } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Coverage } from "./coverage";
import type { Finding } from "./finding";
import { ReviewRequestError, type ReviewEvent } from "./stream";

/**
 * Client-side state of one review, fed by the `/api/review` stream. Pure so
 * the workspace and later features (queue, coverage bar, minimap) share one
 * source of truth that is testable without React.
 */

export interface ReviewSession {
  readonly phase: ReviewPhase;
  /** The Document exactly as sent; Clause and Citation offsets index into it. */
  readonly text: string;
  readonly clauses: readonly Clause[] | null;
  /** One per Rule, in arrival order. */
  readonly findings: readonly Finding[];
  readonly coverage: Coverage | null;
  readonly error: string | null;
}

export type ReviewSessionAction =
  | { readonly type: "started"; readonly text: string }
  | { readonly type: "event"; readonly event: ReviewEvent }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "cancelled" }
  | { readonly type: "reset" };

export const INITIAL_REVIEW_SESSION: ReviewSession = {
  phase: REVIEW_PHASE.IDLE,
  text: "",
  clauses: null,
  findings: [],
  coverage: null,
  error: null,
};

export function reviewSessionReducer(state: ReviewSession, action: ReviewSessionAction): ReviewSession {
  switch (action.type) {
    case "started":
      return { ...INITIAL_REVIEW_SESSION, phase: REVIEW_PHASE.RUNNING, text: action.text };
    case "event":
      return state.phase === REVIEW_PHASE.RUNNING ? applyEvent(state, action.event) : state;
    case "failed":
      return state.phase === REVIEW_PHASE.RUNNING ? { ...state, phase: REVIEW_PHASE.FAILED, error: action.message } : state;
    case "cancelled":
      // Back to the input with the Document kept, so the user can edit and resubmit.
      return state.phase === REVIEW_PHASE.RUNNING ? { ...INITIAL_REVIEW_SESSION, text: state.text } : state;
    case "reset":
      return { ...INITIAL_REVIEW_SESSION, text: state.text };
  }
}

function applyEvent(state: ReviewSession, event: ReviewEvent): ReviewSession {
  switch (event.event) {
    case STREAM_EVENT.CLAUSES:
      return { ...state, clauses: event.clauses };
    case STREAM_EVENT.FINDING: {
      // One Finding per Rule: a repeat replaces rather than duplicates.
      const others = state.findings.filter((finding) => finding.ruleId !== event.finding.ruleId);
      return { ...state, findings: [...others, event.finding] };
    }
    case STREAM_EVENT.COVERAGE:
      return { ...state, coverage: event.coverage };
    case STREAM_EVENT.DONE:
      return { ...state, phase: REVIEW_PHASE.DONE };
    case STREAM_EVENT.ERROR:
      return { ...state, phase: REVIEW_PHASE.FAILED, error: event.message };
  }
}

/**
 * What to show when the request or stream throws (not for aborts). The route's
 * own messages are already user-facing; anything else is a broken stream or
 * network failure and gets a generic message.
 */
export function failureMessage(error: unknown): string {
  return error instanceof ReviewRequestError ? error.message : REVIEW_UI_TEXT.UNEXPECTED_ERROR;
}

/** Whether the workspace can render: the Document has been segmented. */
export function hasDocument(state: ReviewSession): state is ReviewSession & { clauses: readonly Clause[] } {
  return state.clauses !== null;
}
