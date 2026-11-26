"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from "react";
import { DECISION_KIND, type RuleId } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import { INITIAL_QUEUE_STATE, orderQueue, queueReducer, shortcutFor } from "@/features/review/queue";

/**
 * Review Queue state for one review: Findings in queue order, focus pinned to
 * a Rule ID while new Findings stream in, and J/K/A/E/X/D on the window.
 * Remounting (a new review) starts afresh. `now` is the clock Decision times are measured with.
 */
export function useReviewQueue(findings: readonly Finding[], clauses: readonly Clause[], now: () => number = Date.now) {
  const ordered = useMemo(() => orderQueue(findings, clauses), [findings, clauses]);
  const order = useMemo(() => ordered.map((finding) => finding.ruleId), [ordered]);
  const [state, dispatch] = useReducer(queueReducer, INITIAL_QUEUE_STATE);

  useEffect(() => {
    dispatch({ type: "synced", order, now: now() });
  }, [order, now]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isEditable(event.target)) return;
    if (event.key === "Escape") {
      dispatch({ type: "cancel" });
      return;
    }
    const shortcut = shortcutFor(event);
    if (!shortcut) return;
    const at = now();
    const focused = ordered.find((finding) => finding.ruleId === state.focusedRuleId);
    switch (shortcut) {
      case "NEXT":
      case "PREVIOUS":
        dispatch({ type: "move", delta: shortcut === "NEXT" ? 1 : -1, order, now: at });
        break;
      case "APPROVE":
        dispatch({ type: "approve", order, now: at });
        break;
      case "EDIT":
        if (focused) dispatch({ type: "beginEdit", finding: focused });
        break;
      case "ESCALATE":
      case "DISMISS":
        dispatch({ type: "beginReason", decision: DECISION_KIND[shortcut] });
        break;
    }
    // Stops the key that opened an editor from also typing into it.
    event.preventDefault();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const focus = useCallback((ruleId: RuleId) => dispatch({ type: "focus", ruleId, now: now() }), [now]);
  const setDraft = useCallback((draft: string) => dispatch({ type: "draft", draft }), []);
  const cancel = useCallback(() => dispatch({ type: "cancel" }), []);
  const submit = useCallback(() => dispatch({ type: "submit", order, now: now() }), [order, now]);

  return { ordered, state, focus, setDraft, cancel, submit };
}

/** Typing in a field (the inline editor, or anything else) is never a shortcut. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
