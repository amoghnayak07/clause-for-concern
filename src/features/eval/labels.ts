import { z } from "zod";
import {
  FINDING_STATUS,
  MIN_ANCHOR_CHARS,
  PLAYBOOK,
  RULE_KIND,
  type RuleId,
  type RuleKind,
} from "@/common/constants";

/**
 * Label files (`data/README.md` "Label file format"). Every label is checked
 * against its Document before any model call, so a bad anchor fails loudly
 * instead of skewing results.
 */

const ExpectedStatusSchema = z.enum([FINDING_STATUS.RISK_FOUND, FINDING_STATUS.COMPLIANT, FINDING_STATUS.NOT_FOUND]);
export type ExpectedStatus = z.infer<typeof ExpectedStatusSchema>;

const LabelSchema = z.object({
  expected: ExpectedStatusSchema,
  anchor: z.string().nullable(),
});
export type Label = z.infer<typeof LabelSchema>;

const labelsShape = Object.fromEntries(PLAYBOOK.map((rule) => [rule.id, LabelSchema])) as Record<
  RuleId,
  typeof LabelSchema
>;

const LabelFileSchema = z.object({
  document: z.string().min(1),
  // Strict: an unknown Rule ID is a typo, not something to ignore.
  labels: z.strictObject(labelsShape),
  notes: z.string().optional(),
});

export type Labels = Readonly<Record<RuleId, Label>>;

/** A Document paired with the expected Status for each Rule (GLOSSARY "Labeled Document"). */
export interface LabeledDocument {
  /** Document file name, e.g. `02-one-way-ny.txt`. */
  readonly name: string;
  readonly text: string;
  readonly labels: Labels;
}

export type LabelValidation =
  | { readonly ok: true; readonly document: LabeledDocument }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Is evidence expected in the text? No for NOT_FOUND, or COMPLIANT on a PROHIBITED Rule. */
export function expectsAnchor(kind: RuleKind, expected: ExpectedStatus): boolean {
  if (expected === FINDING_STATUS.NOT_FOUND) return false;
  return !(expected === FINDING_STATUS.COMPLIANT && kind === RULE_KIND.PROHIBITED);
}

/**
 * Validates a parsed label file against its Document: all six Rule IDs, legal
 * statuses per Rule kind, and anchors that are exact substrings (20+ chars)
 * exactly when evidence should exist. Collects every problem, not just the first.
 */
export function validateLabels(name: string, text: string, json: unknown): LabelValidation {
  const parsed = LabelFileSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    };
  }

  const problems: string[] = [];
  const { document, labels } = parsed.data;
  if (document !== name) problems.push(`document: names "${document}", expected "${name}"`);

  for (const rule of PLAYBOOK) {
    const { expected, anchor } = labels[rule.id];
    const where = `labels.${rule.id}`;

    if (expected === FINDING_STATUS.NOT_FOUND && rule.kind === RULE_KIND.PROHIBITED) {
      problems.push(`${where}: NOT_FOUND is only valid on REQUIRED Rules (absence of a PROHIBITED Rule is COMPLIANT)`);
      continue;
    }

    const wantsAnchor = expectsAnchor(rule.kind, expected);
    if (!wantsAnchor) {
      if (anchor !== null) problems.push(`${where}: anchor must be null for ${expected} on a ${rule.kind} Rule`);
      continue;
    }
    if (anchor === null) {
      problems.push(`${where}: anchor is required for ${expected} on a ${rule.kind} Rule`);
    } else if (anchor.length < MIN_ANCHOR_CHARS) {
      problems.push(`${where}: anchor is ${anchor.length} chars, minimum is ${MIN_ANCHOR_CHARS}`);
    } else if (!text.includes(anchor)) {
      problems.push(`${where}: anchor is not an exact substring of the document: "${anchor}"`);
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, document: { name, text, labels } };
}
