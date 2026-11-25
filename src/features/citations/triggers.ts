import type { PlaybookRule } from "@/common/constants";
import type { ClauseId } from "@/features/document/types";
import type { CitationIndex } from "./verify";

export interface TriggerTermHit {
  readonly clauseId: ClauseId;
  readonly term: string;
}

/**
 * Finds the Rule's Trigger Terms in the Document, one hit per Clause (the
 * first term listed that occurs). Case-insensitive substring match on the
 * normalized Clause text, so "solicit" also catches "solicitation". Broad on
 * purpose: a hit only raises a LOW-confidence Possible Miss.
 */
export function findTriggerTerms(index: CitationIndex, rule: Pick<PlaybookRule, "triggerTerms">): TriggerTermHit[] {
  const terms = rule.triggerTerms.map((term) => term.toLowerCase());
  const hits: TriggerTermHit[] = [];
  for (const clause of index.clauses) {
    const text = index.byClauseId.get(clause.id)?.normalized.text.toLowerCase() ?? "";
    const term = terms.find((t) => text.includes(t));
    if (term !== undefined) hits.push({ clauseId: clause.id, term });
  }
  return hits;
}
