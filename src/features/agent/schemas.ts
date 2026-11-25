import { z } from "zod";
import { CONFIDENCE, FINDING_STATUS, REDLINE_KIND, RULE_ID } from "@/common/constants";

/**
 * Model-output schemas: what the model is asked to return via structured
 * outputs. Deliberately plain (objects, enums, nullables, no refinements) so
 * they convert cleanly to the API's JSON Schema subset. Our code turns these
 * into domain Findings (`@/features/review/finding`) after verification.
 *
 * Never name a field "reasoning": it triggers a `reasoning_extraction` refusal.
 */

/** ERROR is ours, never the model's. */
const ModelStatus = z.enum([FINDING_STATUS.RISK_FOUND, FINDING_STATUS.COMPLIANT, FINDING_STATUS.NOT_FOUND]);
const ModelConfidence = z.enum(CONFIDENCE);

const ProposedCitationOutput = z.object({
  clauseId: z.string().describe("ID of the cited Clause, e.g. c-007."),
  quote: z.string().describe("Exact contiguous text copied from that Clause. No ellipses."),
});

const RedlineOutput = z.object({
  kind: z.enum(REDLINE_KIND),
  clauseId: z
    .string()
    .nullable()
    .describe("REPLACE: the cited Clause to edit. INSERT: the Clause to insert after, or null for the start."),
  targetQuote: z
    .string()
    .nullable()
    .describe("REPLACE: exact contiguous text in that Clause to replace. INSERT: null."),
  text: z.string().describe("REPLACE: the replacement text. INSERT: the new Clause text."),
});

export const DetectorOutputSchema = z.object({
  status: ModelStatus,
  confidence: ModelConfidence,
  citations: z.array(ProposedCitationOutput),
  redline: RedlineOutput.nullable(),
  explanation: z.string(),
});
export type DetectorOutput = z.infer<typeof DetectorOutputSchema>;

/**
 * Repair pass: only the failed quotes are re-asked. Status, confidence and
 * verified Citations from the first pass are kept by our code.
 */
export const CitationRepairOutputSchema = z.object({
  repairs: z
    .array(
      z.object({
        item: z.int().describe("Number of the failed quote being replaced, as listed in the request."),
        clauseId: z.string().describe("ID of the Clause that actually contains the text."),
        quote: z.string().describe("Exact contiguous text copied from that Clause. No ellipses."),
      }),
    )
    .describe("One entry per failed quote you can fix. Omit any you cannot support with exact text."),
  redlineTarget: z
    .object({
      targetQuote: z.string().describe("Exact contiguous text in the Redline's Clause to replace."),
      text: z.string().describe("The replacement text for that target."),
    })
    .nullable()
    .describe("Only when the Redline target is listed as failed; otherwise null."),
});
export type CitationRepairOutput = z.infer<typeof CitationRepairOutputSchema>;

export const VerifierOutputSchema = z.object({
  status: ModelStatus,
  confidence: ModelConfidence,
  newCitations: z.array(ProposedCitationOutput),
  note: z.string(),
});
export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

export const MapClausesOutputSchema = z.object({
  clauses: z.array(
    z.object({
      clauseId: z.string(),
      ruleIds: z.array(z.enum(RULE_ID)).describe("Rules this Clause bears on; empty if relevant to none."),
    }),
  ),
});
export type MapClausesOutput = z.infer<typeof MapClausesOutputSchema>;
