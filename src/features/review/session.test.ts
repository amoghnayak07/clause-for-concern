import { describe, expect, it } from "vitest";
import { REVIEW_PHASE, REVIEW_UI_TEXT, RULE_ID, RULE_KIND, STREAM_EVENT } from "@/common/constants";
import type { Finding } from "./finding";
import {
  INITIAL_REVIEW_SESSION,
  failureMessage,
  hasDocument,
  reviewSessionReducer,
  type ReviewSession,
  type ReviewSessionAction,
} from "./session";
import { ReviewRequestError, ReviewStreamError } from "./stream";
import { sampleEvents, sampleFinding } from "./testing";

const TEXT = "1. The parties agree to keep everything confidential.";

function run(actions: readonly ReviewSessionAction[], from: ReviewSession = INITIAL_REVIEW_SESSION): ReviewSession {
  return actions.reduce(reviewSessionReducer, from);
}

const started: ReviewSessionAction = { type: "started", text: TEXT };
const events = (list: readonly (typeof sampleEvents)[number][]) =>
  list.map((event): ReviewSessionAction => ({ type: "event", event }));

describe("reviewSessionReducer", () => {
  it("starts a fresh run with the Document text and no results", () => {
    const previous = run([started, ...events(sampleEvents)]);
    const state = reviewSessionReducer(previous, { type: "started", text: "other" });
    expect(state).toEqual({ ...INITIAL_REVIEW_SESSION, phase: REVIEW_PHASE.RUNNING, text: "other" });
  });

  it("applies clauses → finding → coverage → done", () => {
    const afterClauses = run([started, ...events(sampleEvents.slice(0, 1))]);
    expect(hasDocument(afterClauses)).toBe(true);
    expect(afterClauses.phase).toBe(REVIEW_PHASE.RUNNING);

    const state = run([started, ...events(sampleEvents)]);
    expect(state.phase).toBe(REVIEW_PHASE.DONE);
    expect(state.text).toBe(TEXT);
    expect(state.clauses).toHaveLength(1);
    expect(state.findings).toEqual([sampleFinding]);
    expect(state.coverage).toEqual({ available: true, covered: 1, total: 1, unmappedClauseIds: [] });
    expect(state.error).toBeNull();
  });

  it("keeps Findings in arrival order and replaces a repeated Rule", () => {
    const other: Finding = { ...sampleFinding, ruleId: RULE_ID.NO_RESIDUALS, ruleKind: RULE_KIND.PROHIBITED };
    const revised: Finding = { ...sampleFinding, confidence: "LOW" };
    const state = run([
      started,
      ...events([
        { event: STREAM_EVENT.FINDING, finding: sampleFinding },
        { event: STREAM_EVENT.FINDING, finding: other },
        { event: STREAM_EVENT.FINDING, finding: revised },
      ]),
    ]);
    expect(state.findings).toEqual([other, revised]);
  });

  it("an error event fails the run and keeps partial results", () => {
    const state = run([
      started,
      ...events([sampleEvents[0], sampleEvents[1], { event: STREAM_EVENT.ERROR, message: "The review failed." }]),
    ]);
    expect(state.phase).toBe(REVIEW_PHASE.FAILED);
    expect(state.error).toBe("The review failed.");
    expect(state.findings).toHaveLength(1);
    expect(hasDocument(state)).toBe(true);
  });

  it("a client-side failure fails the run", () => {
    const state = run([started, { type: "failed", message: "HTTP 400" }]);
    expect(state.phase).toBe(REVIEW_PHASE.FAILED);
    expect(state.error).toBe("HTTP 400");
  });

  it("cancelling returns to idle and keeps the Document text for editing", () => {
    const state = run([started, ...events(sampleEvents.slice(0, 2)), { type: "cancelled" }]);
    expect(state).toEqual({ ...INITIAL_REVIEW_SESSION, text: TEXT });
  });

  it("ignores events, failures and cancels once the run is over", () => {
    const done = run([started, ...events(sampleEvents)]);
    expect(reviewSessionReducer(done, { type: "event", event: sampleEvents[1] })).toBe(done);
    expect(reviewSessionReducer(done, { type: "failed", message: "late" })).toBe(done);
    expect(reviewSessionReducer(done, { type: "cancelled" })).toBe(done);
    expect(reviewSessionReducer(INITIAL_REVIEW_SESSION, { type: "event", event: sampleEvents[0] })).toBe(
      INITIAL_REVIEW_SESSION,
    );
  });

  it("reset clears results but keeps the Document text", () => {
    const state = run([started, ...events(sampleEvents), { type: "reset" }]);
    expect(state).toEqual({ ...INITIAL_REVIEW_SESSION, text: TEXT });
  });
});

describe("failureMessage", () => {
  it("passes the route's message through", () => {
    expect(failureMessage(new ReviewRequestError("text must not be empty", 400))).toBe("text must not be empty");
  });

  it("uses a generic message for broken streams and network errors", () => {
    expect(failureMessage(new ReviewStreamError("Malformed review event"))).toBe(REVIEW_UI_TEXT.UNEXPECTED_ERROR);
    expect(failureMessage(new TypeError("Failed to fetch"))).toBe(REVIEW_UI_TEXT.UNEXPECTED_ERROR);
  });
});
