import { CLAUSE_LABEL_PREFIX, NDA_MIN_CHARS, NDA_SIGNAL_TERMS } from "@/common/constants";
import { segmentDocument } from "./segment";

/**
 * Cheap pre-review check that the input is plausibly an NDA, so pasted chat,
 * code or a prompt-injection attempt gets a warning before it costs a review.
 * Advisory only: the reviewer can always continue.
 */

export type NdaWarning = "SHORT" | "NO_STRUCTURE";

/** Why the text doesn't look like an NDA; empty when it does. */
export function ndaWarnings(text: string): NdaWarning[] {
  const warnings: NdaWarning[] = [];
  const trimmed = text.trim();
  if (trimmed.length < NDA_MIN_CHARS) warnings.push("SHORT");

  const lower = trimmed.normalize("NFKC").toLowerCase();
  const hasTerm = NDA_SIGNAL_TERMS.some((term) => lower.includes(term));
  const numbered = segmentDocument(text).some((clause) => clause.label.startsWith(CLAUSE_LABEL_PREFIX.NUMBERED));
  if (!hasTerm && !numbered) warnings.push("NO_STRUCTURE");
  return warnings;
}
