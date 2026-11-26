import {
  ACTION_SORT_ORDER,
  DECISION_KIND,
  KEYBOARD_SHORTCUTS,
  PLAYBOOK,
  REDLINE_KIND,
  type DecisionKind,
  type RuleId,
  type ShortcutAction,
} from "@/common/constants";
import type { Clause } from "@/features/document/types";
import { scrollTarget } from "@/features/viewer/segments";
import { recommendedAction } from "./derive";
import type { Finding } from "./finding";

/**
 * Review Queue (DESIGN "UI"): ordering, focus and Decisions. Pure so the
 * keyboard flow is testable without React; time comes in on each action.
 */

export interface Decision {
  readonly ruleId: RuleId;
  readonly kind: DecisionKind;
  readonly reason: string | null;
  /** EDIT only: the reviewer's Redline text (REPLACE replacement or INSERT text). */
  readonly editedReplacement: string | null;
  readonly decidedAt: number;
  /** Focus → Decision, uncapped; the average (`timing.ts`) applies `IDLE_CAP_SECONDS`. */
  readonly elapsedMs: number;
}

/* ------------------------------------------------------------------------ */
/* Ordering                                                                  */
/* ------------------------------------------------------------------------ */

const playbookOrder = new Map(PLAYBOOK.map((rule, index) => [rule.id, index]));

/**
 * Where a Finding sits in the Document: its scroll target's start (earliest
 * verified Citation, else the Clause it points at). Null when positionless.
 */
export function findingPosition(finding: Finding, clauses: readonly Clause[]): number | null {
  const target = scrollTarget(finding, clauses);
  if (!target) return null;
  if (target.kind === "citation") return finding.citations[target.citationIndex].start;
  return clauses.find((clause) => clause.id === target.clauseId)?.start ?? null;
}

/**
 * ESCALATE → FIX → NONE (so COMPLIANT sits at the bottom); within a group,
 * positionless Findings first, then Document order; Playbook order breaks ties.
 */
export function orderQueue(findings: readonly Finding[], clauses: readonly Clause[]): Finding[] {
  const keyed = findings.map((finding) => ({
    finding,
    action: ACTION_SORT_ORDER[recommendedAction(finding)],
    position: findingPosition(finding, clauses),
  }));
  keyed.sort(
    (a, b) =>
      a.action - b.action ||
      positionRank(a.position) - positionRank(b.position) ||
      (playbookOrder.get(a.finding.ruleId) ?? 0) - (playbookOrder.get(b.finding.ruleId) ?? 0),
  );
  return keyed.map(({ finding }) => finding);
}

function positionRank(position: number | null): number {
  return position ?? -1;
}

/* ------------------------------------------------------------------------ */
/* Keys                                                                      */
/* ------------------------------------------------------------------------ */

export interface KeyLike {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
}

const shortcutByKey = new Map(
  (Object.entries(KEYBOARD_SHORTCUTS) as Array<[ShortcutAction, string]>).map(([action, key]) => [key, action]),
);

/** The triage shortcut a key press maps to; browser/OS chords never match. */
export function shortcutFor(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  return shortcutByKey.get(event.key.toLowerCase()) ?? null;
}

/* ------------------------------------------------------------------------ */
/* Editing                                                                   */
/* ------------------------------------------------------------------------ */

/** The Redline text the inline editor starts from, or null when E doesn't apply. */
export function editableRedlineText(finding: Pick<Finding, "redline">): string | null {
  const redline = finding.redline;
  if (!redline) return null;
  return redline.kind === REDLINE_KIND.REPLACE ? redline.replacement : redline.text;
}

/* ------------------------------------------------------------------------ */
/* State                                                                     */
/* ------------------------------------------------------------------------ */

export type QueueMode =
  | { readonly kind: "browse" }
  | {
      readonly kind: "edit";
      readonly ruleId: RuleId;
      readonly original: string;
      readonly draft: string;
      /** REPLACE may delete the span; an INSERT needs text. */
      readonly allowEmpty: boolean;
    }
  | {
      readonly kind: "reason";
      readonly ruleId: RuleId;
      readonly decision: typeof DECISION_KIND.ESCALATE | typeof DECISION_KIND.DISMISS;
      readonly draft: string;
    };

export interface QueueState {
  readonly focusedRuleId: RuleId | null;
  /** When the focused Finding gained focus; Decision time is measured from here. */
  readonly focusedAt: number | null;
  /** Latest Decision per Finding. */
  readonly decisions: Readonly<Partial<Record<RuleId, Decision>>>;
  readonly mode: QueueMode;
}

export const INITIAL_QUEUE_STATE: QueueState = {
  focusedRuleId: null,
  focusedAt: null,
  decisions: {},
  mode: { kind: "browse" },
};

/** `order` is the queue's Rule IDs as currently shown. */
export type QueueAction =
  | { readonly type: "synced"; readonly order: readonly RuleId[]; readonly now: number }
  | { readonly type: "focus"; readonly ruleId: RuleId; readonly now: number }
  | { readonly type: "move"; readonly delta: 1 | -1; readonly order: readonly RuleId[]; readonly now: number }
  | { readonly type: "approve"; readonly order: readonly RuleId[]; readonly now: number }
  | { readonly type: "beginEdit"; readonly finding: Pick<Finding, "ruleId" | "redline"> }
  | { readonly type: "beginReason"; readonly decision: typeof DECISION_KIND.ESCALATE | typeof DECISION_KIND.DISMISS }
  | { readonly type: "draft"; readonly draft: string }
  | { readonly type: "cancel" }
  | { readonly type: "submit"; readonly order: readonly RuleId[]; readonly now: number };

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "synced":
      // First Finding to arrive takes focus; after that focus is pinned to its Rule ID.
      return state.focusedRuleId === null && action.order.length > 0 ? focus(state, action.order[0], action.now) : state;
    case "focus":
      return focus(state, action.ruleId, action.now);
    case "move": {
      if (state.mode.kind !== "browse" || action.order.length === 0) return state;
      const at = state.focusedRuleId === null ? -1 : action.order.indexOf(state.focusedRuleId);
      const next = at === -1 ? 0 : clamp(at + action.delta, 0, action.order.length - 1);
      return focus(state, action.order[next], action.now);
    }
    case "approve":
      if (state.mode.kind !== "browse" || state.focusedRuleId === null) return state;
      return decide(state, { kind: DECISION_KIND.APPROVE, reason: null, editedReplacement: null }, action.order, action.now);
    case "beginEdit": {
      if (state.mode.kind !== "browse" || state.focusedRuleId !== action.finding.ruleId) return state;
      const original = editableRedlineText(action.finding);
      if (original === null) return state;
      const allowEmpty = action.finding.redline?.kind === REDLINE_KIND.REPLACE;
      return { ...state, mode: { kind: "edit", ruleId: action.finding.ruleId, original, draft: original, allowEmpty } };
    }
    case "beginReason":
      if (state.mode.kind !== "browse" || state.focusedRuleId === null) return state;
      return { ...state, mode: { kind: "reason", ruleId: state.focusedRuleId, decision: action.decision, draft: "" } };
    case "draft":
      return state.mode.kind === "browse" ? state : { ...state, mode: { ...state.mode, draft: action.draft } };
    case "cancel":
      return state.mode.kind === "browse" ? state : { ...state, mode: { kind: "browse" } };
    case "submit":
      return submit(state, action.order, action.now);
  }
}

/** Whether submitting the open editor would record a Decision. */
export function canSubmit(mode: QueueMode): boolean {
  switch (mode.kind) {
    case "browse":
      return false;
    case "edit":
      return mode.allowEmpty || mode.draft.trim() !== "";
    case "reason":
      return mode.decision !== DECISION_KIND.ESCALATE || mode.draft.trim() !== "";
  }
}

function submit(state: QueueState, order: readonly RuleId[], now: number): QueueState {
  const mode = state.mode;
  if (mode.kind === "browse" || !canSubmit(mode)) return state;
  if (mode.kind === "edit") {
    // An unchanged Redline is the agent's own: that's an approval.
    const decision =
      mode.draft === mode.original
        ? { kind: DECISION_KIND.APPROVE, reason: null, editedReplacement: null }
        : { kind: DECISION_KIND.EDIT, reason: null, editedReplacement: mode.draft };
    return decide(state, decision, order, now);
  }
  const reason = mode.draft.trim();
  return decide(state, { kind: mode.decision, reason: reason === "" ? null : reason, editedReplacement: null }, order, now);
}

function focus(state: QueueState, ruleId: RuleId, now: number): QueueState {
  if (state.focusedRuleId === ruleId) return state;
  return { ...state, focusedRuleId: ruleId, focusedAt: now, mode: { kind: "browse" } };
}

function decide(
  state: QueueState,
  decision: Pick<Decision, "kind" | "reason" | "editedReplacement">,
  order: readonly RuleId[],
  now: number,
): QueueState {
  const ruleId = state.focusedRuleId;
  if (ruleId === null) return state;
  const recorded: Decision = {
    ruleId,
    ...decision,
    decidedAt: now,
    elapsedMs: state.focusedAt === null ? 0 : Math.max(0, now - state.focusedAt),
  };
  const decisions = { ...state.decisions, [ruleId]: recorded };
  const decided: QueueState = { ...state, decisions, mode: { kind: "browse" } };
  const next = nextUndecided(order, decisions, ruleId);
  // Re-deciding restarts the clock for this Finding even when nothing is left to advance to.
  return next === null ? { ...decided, focusedAt: now } : focus(decided, next, now);
}

/** The first undecided Finding after `from` in queue order, wrapping; null when all are decided. */
export function nextUndecided(
  order: readonly RuleId[],
  decisions: QueueState["decisions"],
  from: RuleId | null,
): RuleId | null {
  const start = from === null ? -1 : order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const ruleId = order[(start + step + order.length) % order.length];
    if (ruleId !== from && !decisions[ruleId]) return ruleId;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
