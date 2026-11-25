import type { Clause, ClauseId } from "@/features/document/types";
import type { Finding } from "./finding";

/**
 * Coverage (GLOSSARY): the share of Clauses either tagged by `mapClauses`
 * (mapped to a Rule, or judged irrelevant to every Rule) or cited by any
 * Finding. When `mapClauses` failed, Coverage is unavailable rather than
 * computed from citations alone, which would overstate the gap.
 */
export type Coverage =
  | {
      readonly available: true;
      readonly covered: number;
      readonly total: number;
      /** Unmapped Clauses, in Document order. */
      readonly unmappedClauseIds: readonly ClauseId[];
    }
  | { readonly available: false; readonly total: number };

export function computeCoverage(
  clauses: readonly Clause[],
  taggedClauseIds: readonly ClauseId[] | null,
  findings: readonly Finding[],
): Coverage {
  if (taggedClauseIds === null) return { available: false, total: clauses.length };

  const covered = new Set<ClauseId>(taggedClauseIds);
  for (const finding of findings) for (const citation of finding.citations) covered.add(citation.clauseId);

  const unmappedClauseIds = clauses.filter((clause) => !covered.has(clause.id)).map((clause) => clause.id);
  return {
    available: true,
    covered: clauses.length - unmappedClauseIds.length,
    total: clauses.length,
    unmappedClauseIds,
  };
}
