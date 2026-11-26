import { describe, expect, it } from "vitest";
import { DECISION_KIND, RULE_ID, type RuleId } from "@/common/constants";
import { DEMO_CLAUSES, DEMO_FINDINGS } from "@/features/viewer/fixture";
import type { Finding } from "./finding";
import {
  INITIAL_QUEUE_STATE,
  canSubmit,
  findingPosition,
  nextUndecided,
  orderQueue,
  queueReducer,
  shortcutFor,
  type QueueAction,
  type QueueState,
} from "./queue";

const byRule = (ruleId: RuleId): Finding => {
  const finding = DEMO_FINDINGS.find((f) => f.ruleId === ruleId);
  if (!finding) throw new Error(ruleId);
  return finding;
};

const ORDER = orderQueue(DEMO_FINDINGS, DEMO_CLAUSES).map((f) => f.ruleId);

function run(actions: readonly QueueAction[], from: QueueState = INITIAL_QUEUE_STATE): QueueState {
  return actions.reduce(queueReducer, from);
}

const synced = (now = 0): QueueAction => ({ type: "synced", order: ORDER, now });
const focus = (ruleId: RuleId, now = 0): QueueAction => ({ type: "focus", ruleId, now });

describe("orderQueue", () => {
  it("sorts ESCALATE → FIX → NONE, positionless first in a group, then Document order", () => {
    expect(ORDER).toEqual([
      // ESCALATE: positionless (ERROR), then by position: §2(c) blocked Clause, §4, then GOVERNING_LAW's INSERT anchor §6.
      RULE_ID.NO_RESIDUALS,
      RULE_ID.CONFIDENTIALITY_CARVE_OUTS,
      RULE_ID.NO_NON_SOLICIT,
      RULE_ID.GOVERNING_LAW,
      // FIX
      RULE_ID.CONFIDENTIALITY_TERM,
      // NONE (COMPLIANT) at the bottom.
      RULE_ID.MUTUAL,
    ]);
  });

  it("keeps the same order whatever order Findings arrive in", () => {
    const reversed = orderQueue([...DEMO_FINDINGS].reverse(), DEMO_CLAUSES).map((f) => f.ruleId);
    expect(reversed).toEqual(ORDER);
  });

  it("breaks ties between positionless Findings by Playbook order", () => {
    const error = byRule(RULE_ID.NO_RESIDUALS);
    const other = { ...error, ruleId: RULE_ID.MUTUAL };
    expect(orderQueue([error, other], DEMO_CLAUSES).map((f) => f.ruleId)).toEqual([RULE_ID.MUTUAL, RULE_ID.NO_RESIDUALS]);
  });
});

describe("findingPosition", () => {
  it("uses the earliest Citation, else the pointed-at Clause, else null", () => {
    const term = byRule(RULE_ID.CONFIDENTIALITY_TERM);
    expect(findingPosition(term, DEMO_CLAUSES)).toBe(term.citations[0].start);
    const carveOuts = byRule(RULE_ID.CONFIDENTIALITY_CARVE_OUTS);
    const blockedClause = DEMO_CLAUSES.find((c) => c.id === carveOuts.blockedCitations[0].clauseId);
    expect(findingPosition(carveOuts, DEMO_CLAUSES)).toBe(blockedClause?.start);
    expect(findingPosition(byRule(RULE_ID.NO_RESIDUALS), DEMO_CLAUSES)).toBeNull();
  });
});

describe("shortcutFor", () => {
  it("maps keys case-insensitively and ignores chords", () => {
    expect(shortcutFor({ key: "k" })).toBe("NEXT");
    expect(shortcutFor({ key: "J" })).toBe("PREVIOUS");
    expect(shortcutFor({ key: "a" })).toBe("APPROVE");
    expect(shortcutFor({ key: "e" })).toBe("EDIT");
    expect(shortcutFor({ key: "x" })).toBe("ESCALATE");
    expect(shortcutFor({ key: "d" })).toBe("DISMISS");
    expect(shortcutFor({ key: "a", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "d", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "q" })).toBeNull();
  });
});

describe("queueReducer: focus", () => {
  it("focuses the first Finding once, then stays pinned while the order changes", () => {
    const first = run([synced(5)]);
    expect(first).toMatchObject({ focusedRuleId: ORDER[0], focusedAt: 5 });
    const reordered = queueReducer(first, { type: "synced", order: [RULE_ID.MUTUAL, ...ORDER], now: 9 });
    expect(reordered).toBe(first);
  });

  it("does nothing on an empty queue", () => {
    expect(run([{ type: "synced", order: [], now: 0 }])).toBe(INITIAL_QUEUE_STATE);
  });

  it("J/K move through every Finding, decided or not, and stop at the ends", () => {
    const move = (delta: 1 | -1, now = 0): QueueAction => ({ type: "move", delta, order: ORDER, now });
    let state = run([synced(), move(-1)]);
    expect(state.focusedRuleId).toBe(ORDER[0]);
    state = run([{ type: "approve", order: ORDER, now: 1 }, focus(ORDER[0]), move(1)], state);
    expect(state.focusedRuleId).toBe(ORDER[1]);
    state = run(ORDER.map(() => move(1)), state);
    expect(state.focusedRuleId).toBe(ORDER[ORDER.length - 1]);
  });

  it("J with nothing focused picks the first Finding", () => {
    expect(run([{ type: "move", delta: 1, order: ORDER, now: 0 }]).focusedRuleId).toBe(ORDER[0]);
  });

  it("resets the clock only when focus actually changes", () => {
    const state = run([focus(RULE_ID.MUTUAL, 10), focus(RULE_ID.MUTUAL, 20)]);
    expect(state.focusedAt).toBe(10);
  });

  it("focusing another Finding closes an open editor", () => {
    const state = run([
      focus(RULE_ID.CONFIDENTIALITY_TERM),
      { type: "beginEdit", finding: byRule(RULE_ID.CONFIDENTIALITY_TERM) },
      focus(RULE_ID.MUTUAL),
    ]);
    expect(state.mode).toEqual({ kind: "browse" });
  });
});

describe("queueReducer: Decisions", () => {
  it("approves with elapsed time from focus and auto-advances to the next undecided", () => {
    const state = run([synced(1_000), { type: "approve", order: ORDER, now: 4_500 }]);
    expect(state.decisions[ORDER[0]]).toEqual({
      ruleId: ORDER[0],
      kind: DECISION_KIND.APPROVE,
      reason: null,
      editedReplacement: null,
      decidedAt: 4_500,
      elapsedMs: 3_500,
    });
    expect(state).toMatchObject({ focusedRuleId: ORDER[1], focusedAt: 4_500 });
  });

  it("skips decided Findings when advancing and wraps around", () => {
    const state = run([
      focus(ORDER[1]),
      { type: "approve", order: ORDER, now: 0 }, // → ORDER[2]
      focus(ORDER[ORDER.length - 1]),
      { type: "approve", order: ORDER, now: 0 }, // wraps → ORDER[0]
    ]);
    expect(state.focusedRuleId).toBe(ORDER[0]);
    const all = ORDER.reduce(
      (s) => queueReducer(s, { type: "approve", order: ORDER, now: 0 }),
      state,
    );
    expect(Object.keys(all.decisions)).toHaveLength(ORDER.length);
  });

  it("stays put when everything is decided, and the latest Decision replaces the earlier one", () => {
    const only = [RULE_ID.MUTUAL];
    const state = run([
      { type: "synced", order: only, now: 0 },
      { type: "approve", order: only, now: 10 },
      { type: "beginReason", decision: DECISION_KIND.DISMISS },
      { type: "submit", order: only, now: 30 },
    ]);
    expect(state.focusedRuleId).toBe(RULE_ID.MUTUAL);
    expect(state.decisions[RULE_ID.MUTUAL]).toMatchObject({ kind: DECISION_KIND.DISMISS, reason: null, elapsedMs: 20 });
  });

  it("ESCALATE requires a reason; DISMISS's is optional and trimmed", () => {
    const escalating = run([
      focus(RULE_ID.NO_NON_SOLICIT),
      { type: "beginReason", decision: DECISION_KIND.ESCALATE },
      { type: "draft", draft: "   " },
    ]);
    expect(canSubmit(escalating.mode)).toBe(false);
    expect(queueReducer(escalating, { type: "submit", order: ORDER, now: 0 })).toBe(escalating);

    const escalated = run([{ type: "draft", draft: "  Ask counsel " }, { type: "submit", order: ORDER, now: 0 }], escalating);
    expect(escalated.decisions[RULE_ID.NO_NON_SOLICIT]).toMatchObject({ kind: DECISION_KIND.ESCALATE, reason: "Ask counsel" });
    expect(escalated.mode).toEqual({ kind: "browse" });
  });

  it("keys other than submit/cancel don't act while an editor is open", () => {
    const open = run([focus(RULE_ID.MUTUAL), { type: "beginReason", decision: DECISION_KIND.DISMISS }]);
    expect(queueReducer(open, { type: "approve", order: ORDER, now: 0 })).toBe(open);
    expect(queueReducer(open, { type: "move", delta: 1, order: ORDER, now: 0 })).toBe(open);
    expect(queueReducer(open, { type: "cancel" }).mode).toEqual({ kind: "browse" });
  });

  it("does nothing without a focused Finding", () => {
    expect(run([{ type: "approve", order: ORDER, now: 0 }])).toBe(INITIAL_QUEUE_STATE);
    expect(run([{ type: "beginReason", decision: DECISION_KIND.ESCALATE }])).toBe(INITIAL_QUEUE_STATE);
  });
});

describe("queueReducer: inline Redline edit", () => {
  const term = byRule(RULE_ID.CONFIDENTIALITY_TERM);
  const editing = run([focus(term.ruleId), { type: "beginEdit", finding: term }]);

  it("starts from the agent's Redline text", () => {
    expect(editing.mode).toMatchObject({ kind: "edit", ruleId: term.ruleId, draft: "two (2) years", allowEmpty: true });
  });

  it("records EDIT with the new text", () => {
    const state = run([{ type: "draft", draft: "one (1) year" }, { type: "submit", order: ORDER, now: 0 }], editing);
    expect(state.decisions[term.ruleId]).toMatchObject({ kind: DECISION_KIND.EDIT, editedReplacement: "one (1) year" });
  });

  it("records an unchanged Redline as APPROVE", () => {
    const state = queueReducer(editing, { type: "submit", order: ORDER, now: 0 });
    expect(state.decisions[term.ruleId]).toMatchObject({ kind: DECISION_KIND.APPROVE, editedReplacement: null });
  });

  it("allows an empty REPLACE (deletion) but not an empty INSERT", () => {
    expect(canSubmit({ ...editing.mode, draft: "" } as QueueState["mode"])).toBe(true);
    const law = byRule(RULE_ID.GOVERNING_LAW);
    const inserting = run([focus(law.ruleId), { type: "beginEdit", finding: law }, { type: "draft", draft: " " }]);
    expect(inserting.mode).toMatchObject({ kind: "edit", allowEmpty: false });
    expect(canSubmit(inserting.mode)).toBe(false);
  });

  it("is unavailable without a Redline or for an unfocused Finding", () => {
    const noRedline = run([focus(RULE_ID.MUTUAL), { type: "beginEdit", finding: byRule(RULE_ID.MUTUAL) }]);
    expect(noRedline.mode).toEqual({ kind: "browse" });
    const unfocused = run([focus(RULE_ID.MUTUAL), { type: "beginEdit", finding: term }]);
    expect(unfocused.mode).toEqual({ kind: "browse" });
  });
});

describe("nextUndecided", () => {
  it("returns null when nothing else is undecided", () => {
    expect(nextUndecided([RULE_ID.MUTUAL], {}, RULE_ID.MUTUAL)).toBeNull();
    expect(nextUndecided([], {}, null)).toBeNull();
  });
});
