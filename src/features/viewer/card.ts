import { PLAYBOOK, REDLINE_KIND, type BlockedReason, type RuleId } from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";

/**
 * Pure view model for a Finding card. Every piece of contract text here is
 * sliced from the Document at known offsets (ADR 0002); the model's quotes are
 * never available to, or shown by, the card.
 */

export function ruleTitle(ruleId: RuleId): string {
  return PLAYBOOK.find((rule) => rule.id === ruleId)?.title ?? ruleId;
}

/** Labels of the Clauses cited by verified Citations, in first-cited order, without duplicates. */
export function citedClauseLabels(finding: Pick<Finding, "citations">, clauses: readonly Clause[]): string[] {
  const byId = clauseMap(clauses);
  const labels: string[] = [];
  for (const citation of finding.citations) {
    const label = byId.get(citation.clauseId)?.label ?? citation.clauseId;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

export type BlockedCitationView =
  | {
      readonly kind: "IN_DOCUMENT";
      readonly clauseId: ClauseId;
      readonly clauseLabel: string;
      /** The real Clause text, sliced from the Document. */
      readonly clauseText: string;
      readonly reason: BlockedReason;
    }
  | { readonly kind: "NOT_IN_DOCUMENT"; readonly reason: BlockedReason };

export function blockedCitationViews(
  finding: Pick<Finding, "blockedCitations">,
  clauses: readonly Clause[],
  text: string,
): BlockedCitationView[] {
  const byId = clauseMap(clauses);
  return finding.blockedCitations.map(({ clauseId, reason }) => {
    const clause = clauseId === null ? undefined : byId.get(clauseId);
    if (!clause) return { kind: "NOT_IN_DOCUMENT", reason };
    return {
      kind: "IN_DOCUMENT",
      clauseId: clause.id,
      clauseLabel: clause.label,
      clauseText: text.slice(clause.start, clause.end),
      reason,
    };
  });
}

export function blockedCitationHeadline(view: BlockedCitationView): string {
  return view.kind === "IN_DOCUMENT"
    ? `Agent cited ${view.clauseLabel} but the quote didn't match`
    : "Agent cited a clause that is not in the document";
}

export type RedlineView =
  | {
      readonly kind: typeof REDLINE_KIND.REPLACE;
      readonly clauseLabel: string;
      /** The verified span being replaced, sliced from the Document. */
      readonly original: string;
      readonly replacement: string;
    }
  | {
      readonly kind: typeof REDLINE_KIND.INSERT;
      /** Null inserts at the start of the Document. */
      readonly afterClauseLabel: string | null;
      readonly text: string;
    };

export function redlineView(
  finding: Pick<Finding, "redline">,
  clauses: readonly Clause[],
  text: string,
): RedlineView | null {
  const redline = finding.redline;
  if (!redline) return null;
  const byId = clauseMap(clauses);
  if (redline.kind === REDLINE_KIND.REPLACE) {
    return {
      kind: REDLINE_KIND.REPLACE,
      clauseLabel: byId.get(redline.clauseId)?.label ?? redline.clauseId,
      original: text.slice(redline.start, redline.end),
      replacement: redline.replacement,
    };
  }
  const after = redline.afterClauseId === null ? null : byId.get(redline.afterClauseId);
  return {
    kind: REDLINE_KIND.INSERT,
    afterClauseLabel: after ? after.label : redline.afterClauseId,
    text: redline.text,
  };
}

export function redlineHeadline(view: RedlineView): string {
  if (view.kind === REDLINE_KIND.REPLACE) return `Replace in ${view.clauseLabel}`;
  return view.afterClauseLabel === null ? "Insert at the start of the document" : `Insert after ${view.afterClauseLabel}`;
}

function clauseMap(clauses: readonly Clause[]): Map<ClauseId, Clause> {
  return new Map(clauses.map((clause) => [clause.id, clause]));
}
