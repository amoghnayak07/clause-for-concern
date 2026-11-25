import { APIUserAbortError } from "@anthropic-ai/sdk";
import { EFFORT, ERROR_KIND, MAX_TOKENS, PLAYBOOK, type RuleId } from "@/common/constants";
import type { ClauseId } from "@/features/document/types";
import type { FindingError } from "@/features/review/finding";
import { callModel, ZERO_USAGE, type TokenUsage } from "./callModel";
import { MAP_CLAUSES_SYSTEM, mapClausesContent } from "./prompts";
import { MapClausesOutputSchema, type MapClausesOutput } from "./schemas";
import type { RuleReviewContext } from "./state";

/** A Clause the mapper tagged; empty `ruleIds` means "judged irrelevant to every Rule". */
export interface ClauseMapping {
  readonly clauseId: ClauseId;
  readonly ruleIds: readonly RuleId[];
}

export type MapClausesResult =
  | { readonly ok: true; readonly mappings: readonly ClauseMapping[]; readonly usage: TokenUsage }
  | { readonly ok: false; readonly error: FindingError; readonly usage: TokenUsage };

/**
 * `mapClauses` step (effort low). Tags each Clause with the Rules it bears on,
 * for Coverage only: it never changes a Finding. Unknown Clause IDs are
 * dropped and duplicates merged. Never throws, except to end an aborted run.
 */
export async function mapClauses(context: RuleReviewContext): Promise<MapClausesResult> {
  try {
    const result = await callModel({
      client: context.client,
      model: context.model,
      schema: MapClausesOutputSchema,
      system: MAP_CLAUSES_SYSTEM,
      content: mapClausesContent(context.document, PLAYBOOK),
      effort: EFFORT.MAP_CLAUSES,
      maxTokens: MAX_TOKENS.MAP_CLAUSES,
      signal: context.signal,
    });
    if (!result.ok) return { ok: false, error: result.error, usage: result.usage };
    return { ok: true, mappings: cleanMappings(result.output, context), usage: result.usage };
  } catch (error) {
    if (error instanceof APIUserAbortError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { kind: ERROR_KIND.INTERNAL, message }, usage: ZERO_USAGE };
  }
}

function cleanMappings(output: MapClausesOutput, context: RuleReviewContext): ClauseMapping[] {
  const known = context.document.index.byClauseId;
  const merged = new Map<ClauseId, Set<RuleId>>();
  for (const entry of output.clauses) {
    if (!known.has(entry.clauseId)) continue;
    const ruleIds = merged.get(entry.clauseId) ?? new Set<RuleId>();
    for (const ruleId of entry.ruleIds) ruleIds.add(ruleId);
    merged.set(entry.clauseId, ruleIds);
  }
  return context.document.clauses
    .filter((clause) => merged.has(clause.id))
    .map((clause) => ({ clauseId: clause.id, ruleIds: [...(merged.get(clause.id) ?? [])] }));
}
