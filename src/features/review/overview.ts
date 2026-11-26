import {
  PLAYBOOK,
  REVIEW_PHASE,
  UI_NUMBER_LOCALE,
  type RecommendedAction,
  type ReviewPhase,
  type RuleId,
  type RuleKind,
} from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Coverage } from "./coverage";
import { recommendedAction } from "./derive";
import type { Finding } from "./finding";
import type { Decision, QueueState } from "./queue";

/**
 * Pure view models for the review overview (DESIGN "UI"): the Rule status
 * panel and the coverage bar.
 */

export interface RuleStatusRow {
  readonly ruleId: RuleId;
  readonly kind: RuleKind;
  readonly title: string;
  /** Null while the Rule is still being checked. */
  readonly finding: Finding | null;
  readonly action: RecommendedAction | null;
  readonly decision: Decision | null;
}

/** One row per Playbook Rule, in Playbook order, whether or not its Finding has arrived. */
export function ruleStatusRows(findings: readonly Finding[], decisions: QueueState["decisions"]): RuleStatusRow[] {
  const byRule = new Map(findings.map((finding) => [finding.ruleId, finding]));
  return PLAYBOOK.map((rule) => {
    const finding = byRule.get(rule.id) ?? null;
    return {
      ruleId: rule.id,
      kind: rule.kind,
      title: rule.title,
      finding,
      action: finding ? recommendedAction(finding) : null,
      decision: decisions[rule.id] ?? null,
    };
  });
}

export interface UnmappedClauseView {
  readonly clauseId: ClauseId;
  readonly label: string;
}

export type CoverageView =
  | { readonly kind: "pending" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "available";
      readonly covered: number;
      readonly total: number;
      /** 0–100; an empty Document is fully covered. */
      readonly percent: number;
      /** "38 of 41 clauses mapped". */
      readonly summary: string;
      /** In Document order. */
      readonly unmapped: readonly UnmappedClauseView[];
    };

/**
 * The coverage bar's state. Null when there is nothing to show: the run ended
 * (failed or cancelled) before Coverage arrived, so the mapping's outcome is
 * unknown rather than failed.
 */
export function coverageView(
  coverage: Coverage | null,
  clauses: readonly Clause[],
  phase: ReviewPhase,
): CoverageView | null {
  if (coverage === null) return phase === REVIEW_PHASE.RUNNING ? { kind: "pending" } : null;
  if (!coverage.available) return { kind: "unavailable" };

  const labels = new Map(clauses.map((clause) => [clause.id, clause.label]));
  const { covered, total } = coverage;
  const format = (n: number) => n.toLocaleString(UI_NUMBER_LOCALE);
  return {
    kind: "available",
    covered,
    total,
    percent: total === 0 ? 100 : (covered / total) * 100,
    summary: `${format(covered)} of ${format(total)} ${total === 1 ? "clause" : "clauses"} mapped`,
    unmapped: coverage.unmappedClauseIds.map((clauseId) => ({ clauseId, label: labels.get(clauseId) ?? clauseId })),
  };
}
