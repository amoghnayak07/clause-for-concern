import { describe, expect, it } from "vitest";
import { DECISION_KIND, IDLE_CAP_SECONDS, RULE_ID, type RuleId } from "@/common/constants";
import { DEMO_FINDINGS } from "@/features/viewer/fixture";
import { INITIAL_QUEUE_STATE, queueReducer, type Decision, type QueueAction, type QueueState } from "./queue";
import { averageDecisionSeconds, averageDecisionSummary, cappedElapsedMs } from "./timing";

const decision = (ruleId: RuleId, elapsedMs: number): Decision => ({
  ruleId,
  kind: DECISION_KIND.APPROVE,
  reason: null,
  editedReplacement: null,
  decidedAt: 0,
  elapsedMs,
});

const run = (actions: readonly QueueAction[]): QueueState => actions.reduce(queueReducer, INITIAL_QUEUE_STATE);

describe("cappedElapsedMs", () => {
  it("caps idle time at IDLE_CAP_SECONDS and floors at zero", () => {
    expect(cappedElapsedMs({ elapsedMs: 4_200 })).toBe(4_200);
    expect(cappedElapsedMs({ elapsedMs: 10 * 60_000 })).toBe(IDLE_CAP_SECONDS * 1_000);
    expect(cappedElapsedMs({ elapsedMs: -5 })).toBe(0);
    expect(cappedElapsedMs({ elapsedMs: Number.NaN })).toBe(0);
  });
});

describe("averageDecisionSeconds", () => {
  it("is null before the first Decision", () => {
    expect(averageDecisionSeconds({})).toBeNull();
    expect(averageDecisionSummary({})).toBeNull();
  });

  it("averages capped times over one Decision per Finding", () => {
    const decisions = {
      [RULE_ID.MUTUAL]: decision(RULE_ID.MUTUAL, 3_000),
      [RULE_ID.GOVERNING_LAW]: decision(RULE_ID.GOVERNING_LAW, 9_000),
      // Walked away: counts as the cap, not 15 minutes.
      [RULE_ID.NO_RESIDUALS]: decision(RULE_ID.NO_RESIDUALS, 15 * 60_000),
    };
    expect(averageDecisionSeconds(decisions)).toBe((3 + 9 + IDLE_CAP_SECONDS) / 3);
    expect(averageDecisionSummary(decisions)).toBe("Avg 24.0 s per decision");
  });

  it("formats to one decimal place", () => {
    expect(averageDecisionSummary({ [RULE_ID.MUTUAL]: decision(RULE_ID.MUTUAL, 1_234) })).toBe("Avg 1.2 s per decision");
  });
});

describe("averageDecisionSeconds over the Review Queue", () => {
  const order = DEMO_FINDINGS.map((finding) => finding.ruleId);
  const term = DEMO_FINDINGS.find((finding) => finding.ruleId === RULE_ID.CONFIDENTIALITY_TERM);
  if (!term) throw new Error("fixture");

  it("includes time spent in the inline editor", () => {
    const state = run([
      { type: "focus", ruleId: term.ruleId, now: 1_000 },
      { type: "beginEdit", finding: term },
      { type: "draft", draft: "one (1) year" },
      { type: "submit", order, now: 8_000 },
    ]);
    expect(averageDecisionSeconds(state.decisions)).toBe(7);
  });

  it("counts only the latest Decision when a Finding is re-decided", () => {
    const only = [RULE_ID.MUTUAL];
    const state = run([
      { type: "synced", order: only, now: 0 },
      { type: "approve", order: only, now: 50_000 },
      { type: "beginReason", decision: DECISION_KIND.DISMISS },
      { type: "submit", order: only, now: 52_000 },
    ]);
    expect(averageDecisionSeconds(state.decisions)).toBe(2);
  });
});
