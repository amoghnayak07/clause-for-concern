import { ACTION_SORT_ORDER, PLAYBOOK, type RecommendedAction, type RuleId } from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Coverage } from "@/features/review/coverage";
import { recommendedAction } from "@/features/review/derive";
import type { Finding } from "@/features/review/finding";
import type { QueueState } from "@/features/review/queue";

/**
 * Pure model for the minimap (DESIGN "UI"). Ticks name a Clause; the
 * component places each at that Clause's measured position in the viewer.
 */

export type MinimapTick =
  /** A verified Citation. */
  | {
      readonly kind: "citation";
      readonly ruleId: RuleId;
      readonly clauseId: ClauseId;
      readonly action: RecommendedAction;
      readonly decided: boolean;
    }
  /** A Blocked Citation that names a real Clause: drawn dashed. */
  | {
      readonly kind: "blocked";
      readonly ruleId: RuleId;
      readonly clauseId: ClauseId;
      readonly action: RecommendedAction;
      readonly decided: boolean;
    }
  | { readonly kind: "unmapped"; readonly clauseId: ClauseId };

/** A Finding with nothing to draw in the Document: pinned "not in document" cluster. */
export interface PinnedMark {
  readonly ruleId: RuleId;
  readonly action: RecommendedAction;
  readonly decided: boolean;
}

export interface MinimapModel {
  /** Paint order: Unmapped Clauses first, then least to most severe, so severe ticks sit on top. */
  readonly ticks: readonly MinimapTick[];
  /** Most severe first, then Playbook order. */
  readonly pinned: readonly PinnedMark[];
}

const playbookOrder = new Map(PLAYBOOK.map((rule, index) => [rule.id, index]));

/**
 * Citations of the same Clause by the same Finding share a measured position,
 * so they collapse into one tick. A Finding with neither a verified Citation
 * nor a Blocked Citation on a real Clause is pinned (e.g. NOT_FOUND, ERROR,
 * PROHIBITED COMPLIANT, a Possible Miss).
 */
export function minimapModel(
  findings: readonly Finding[],
  clauses: readonly Clause[],
  coverage: Coverage | null,
  decisions: QueueState["decisions"],
): MinimapModel {
  const known = new Set(clauses.map((clause) => clause.id));
  const findingTicks: Array<Exclude<MinimapTick, { kind: "unmapped" }>> = [];
  const pinned: PinnedMark[] = [];

  for (const finding of findings) {
    const action = recommendedAction(finding);
    const decided = Boolean(decisions[finding.ruleId]);
    const base = { ruleId: finding.ruleId, action, decided };
    const seen = new Set<string>();
    const add = (kind: "citation" | "blocked", clauseId: ClauseId) => {
      const key = `${kind}:${clauseId}`;
      if (!known.has(clauseId) || seen.has(key)) return;
      seen.add(key);
      findingTicks.push({ kind, clauseId, ...base });
    };
    for (const citation of finding.citations) add("citation", citation.clauseId);
    for (const blocked of finding.blockedCitations) if (blocked.clauseId !== null) add("blocked", blocked.clauseId);
    if (seen.size === 0) pinned.push(base);
  }

  findingTicks.sort((a, b) => severity(b) - severity(a));
  pinned.sort((a, b) => severity(a) - severity(b));

  const unmapped: MinimapTick[] =
    coverage?.available === true
      ? coverage.unmappedClauseIds
          .filter((clauseId) => known.has(clauseId))
          .map((clauseId) => ({ kind: "unmapped", clauseId }))
      : [];

  return { ticks: [...unmapped, ...findingTicks], pinned };
}

/** Lower is more severe: action first, then Playbook order. */
function severity(mark: { action: RecommendedAction; ruleId: RuleId }): number {
  return ACTION_SORT_ORDER[mark.action] * PLAYBOOK.length + (playbookOrder.get(mark.ruleId) ?? 0);
}

/** Clause IDs the component needs to measure. */
export function measuredClauseIds(model: MinimapModel): ClauseId[] {
  return [...new Set(model.ticks.map((tick) => tick.clauseId))];
}
