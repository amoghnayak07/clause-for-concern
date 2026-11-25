import { z } from "zod";
import {
  BLOCKED_REASON,
  CONFIDENCE,
  ERROR_KIND,
  FINDING_SOURCE,
  FINDING_STATUS,
  PLAYBOOK,
  REDLINE_KIND,
  RULE_ID,
  RULE_KIND,
} from "@/common/constants";
import type { BlockedCitation, Citation } from "@/features/citations/types";

/**
 * Domain Finding schema. Findings are built by our code (never parsed straight
 * from model output) and checked here so impossible states can't reach the UI
 * or the eval. See DESIGN "Types" for the invariants.
 */

const offset = z.int().nonnegative();

export const CitationSchema = z
  .object({ clauseId: z.string().min(1), start: offset, end: offset })
  .refine((c) => c.end > c.start, { error: "end must be after start" }) satisfies z.ZodType<Citation>;

export const BlockedCitationSchema = z.object({
  clauseId: z.string().min(1).nullable(),
  reason: z.enum(BLOCKED_REASON),
}) satisfies z.ZodType<BlockedCitation>;

export const RedlineSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal(REDLINE_KIND.REPLACE),
      clauseId: z.string().min(1),
      start: offset,
      end: offset,
      replacement: z.string(),
    })
    .refine((r) => r.end > r.start, { error: "end must be after start" }),
  z.object({
    kind: z.literal(REDLINE_KIND.INSERT),
    afterClauseId: z.string().min(1).nullable(),
    text: z.string().min(1),
  }),
]);
export type Redline = z.infer<typeof RedlineSchema>;

export const FindingErrorSchema = z.object({
  kind: z.enum(ERROR_KIND),
  message: z.string(),
});
export type FindingError = z.infer<typeof FindingErrorSchema>;

const ruleKindById = new Map(PLAYBOOK.map((rule) => [rule.id, rule.kind]));

export const FindingSchema = z
  .object({
    ruleId: z.enum(RULE_ID),
    ruleKind: z.enum(RULE_KIND),
    status: z.enum(FINDING_STATUS),
    confidence: z.enum(CONFIDENCE),
    source: z.enum(FINDING_SOURCE),
    citations: z.array(CitationSchema),
    blockedCitations: z.array(BlockedCitationSchema),
    redline: RedlineSchema.nullable(),
    explanation: z.string(),
    verifierNote: z.string().nullable(),
    error: FindingErrorSchema.nullable(),
    attempts: z.int().nonnegative(),
  })
  .superRefine((f, ctx) => {
    const fail = (message: string, path: string) => ctx.addIssue({ code: "custom", message, path: [path] });

    if (ruleKindById.get(f.ruleId) !== f.ruleKind) {
      fail(`ruleKind must match the Playbook (${ruleKindById.get(f.ruleId)})`, "ruleKind");
    }
    if ((f.status === FINDING_STATUS.ERROR) !== (f.error !== null)) {
      fail("error must be set exactly when status is ERROR", "error");
    }
    if (f.status === FINDING_STATUS.NOT_FOUND && f.ruleKind !== RULE_KIND.REQUIRED) {
      fail("NOT_FOUND is only valid on REQUIRED Rules", "status");
    }
    if (
      f.status === FINDING_STATUS.COMPLIANT &&
      f.ruleKind === RULE_KIND.PROHIBITED &&
      (f.citations.length > 0 || f.blockedCitations.length > 0)
    ) {
      fail("COMPLIANT on a PROHIBITED Rule must not cite anything", "citations");
    }
    if (f.status === FINDING_STATUS.COMPLIANT && f.redline !== null) {
      fail("COMPLIANT Findings have no Redline", "redline");
    }
    if (f.redline?.kind === REDLINE_KIND.REPLACE) {
      const target = f.redline.clauseId;
      if (!f.citations.some((c) => c.clauseId === target)) {
        fail("REPLACE Redline must target a cited Clause", "redline");
      }
    }
    if (f.source === FINDING_SOURCE.TRIGGER_TERM && f.confidence !== CONFIDENCE.LOW) {
      fail("Possible Miss Findings are always LOW confidence", "confidence");
    }
  });
export type Finding = z.infer<typeof FindingSchema>;
