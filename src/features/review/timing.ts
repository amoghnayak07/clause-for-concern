import { IDLE_CAP_SECONDS, UI_NUMBER_LOCALE } from "@/common/constants";
import type { Decision, QueueState } from "./queue";

/**
 * Avg seconds per Decision (DESIGN "UI", Goal 3). Each Decision's measured
 * time runs from focus to Decision, editing included; it is capped at
 * `IDLE_CAP_SECONDS` so a reviewer who walks away doesn't skew the average.
 * Only the latest Decision per Finding counts, which `QueueState.decisions`
 * already guarantees. Pure: times come from the recorded Decisions, never a clock.
 */

const IDLE_CAP_MS = IDLE_CAP_SECONDS * 1_000;

/** One Decision's contribution to the average, in milliseconds. */
export function cappedElapsedMs(decision: Pick<Decision, "elapsedMs">): number {
  const elapsed = Number.isFinite(decision.elapsedMs) ? decision.elapsedMs : 0;
  return Math.min(IDLE_CAP_MS, Math.max(0, elapsed));
}

/** Mean capped seconds over the latest Decision per Finding; null before the first Decision. */
export function averageDecisionSeconds(decisions: QueueState["decisions"]): number | null {
  const latest = Object.values(decisions).filter((decision): decision is Decision => decision !== undefined);
  if (latest.length === 0) return null;
  const totalMs = latest.reduce((sum, decision) => sum + cappedElapsedMs(decision), 0);
  return totalMs / latest.length / 1_000;
}

/** "12.3 s per decision", or null before the first Decision. */
export function averageDecisionSummary(decisions: QueueState["decisions"]): string | null {
  const seconds = averageDecisionSeconds(decisions);
  if (seconds === null) return null;
  const formatted = seconds.toLocaleString(UI_NUMBER_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `Avg ${formatted} s per decision`;
}
