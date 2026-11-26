import {
  DECISION_KIND,
  DECISION_LABELS,
  EXPORT_TEXT,
  REDLINE_KIND,
  STATUS_LABELS,
  type RuleId,
} from "@/common/constants";
import type { Clause } from "@/features/document/types";
import { redlineHeadline, redlineView, ruleTitle } from "@/features/viewer/card";
import type { Finding, Redline } from "./finding";
import type { Decision, QueueState } from "./queue";

/**
 * Export (DESIGN "Export"): the Revised Document with every Accepted Redline
 * applied, and a Review Summary of each Finding's Decision. Pure; the browser
 * download lives in the component.
 */

/** A Redline the reviewer accepted: the agent's own (APPROVE) or rewritten (EDIT). */
export interface AcceptedRedline {
  readonly ruleId: RuleId;
  readonly redline: Redline;
  /** The text written into the Document. */
  readonly text: string;
}

export type SkipReason = "OVERLAP" | "UNKNOWN_CLAUSE";

export interface RevisedDocument {
  readonly text: string;
  readonly applied: readonly RuleId[];
  /** Accepted Redlines that could not be applied, with the Rule they clashed with when relevant. */
  readonly skipped: readonly { readonly ruleId: RuleId; readonly reason: SkipReason; readonly conflictsWith: RuleId | null }[];
}

/** Accepted Redlines in queue order. APPROVE/EDIT on a Finding without a Redline changes nothing. */
export function acceptedRedlines(
  findings: readonly Finding[],
  decisions: QueueState["decisions"],
): AcceptedRedline[] {
  const accepted: AcceptedRedline[] = [];
  for (const finding of findings) {
    const decision = decisions[finding.ruleId];
    const redline = finding.redline;
    if (!decision || !redline) continue;
    if (decision.kind === DECISION_KIND.APPROVE) {
      accepted.push({ ruleId: finding.ruleId, redline, text: redline.kind === REDLINE_KIND.REPLACE ? redline.replacement : redline.text });
    } else if (decision.kind === DECISION_KIND.EDIT && decision.editedReplacement !== null) {
      accepted.push({ ruleId: finding.ruleId, redline, text: decision.editedReplacement });
    }
  }
  return accepted;
}

interface Splice {
  readonly ruleId: RuleId;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** Tie-break for splices at the same offset: earlier in the queue lands first. */
  readonly order: number;
}

/**
 * Applies Accepted Redlines to the untouched Document text. REPLACE splices at
 * its verified span; INSERT adds a new paragraph after its Clause (or at the
 * start). A REPLACE overlapping one earlier in the queue is skipped rather than
 * guessed at, and reported.
 */
export function reviseDocument(
  text: string,
  clauses: readonly Clause[],
  accepted: readonly AcceptedRedline[],
): RevisedDocument {
  const byId = new Map(clauses.map((clause) => [clause.id, clause]));
  const splices: Splice[] = [];
  const skipped: RevisedDocument["skipped"][number][] = [];

  accepted.forEach(({ ruleId, redline, text: written }, order) => {
    if (redline.kind === REDLINE_KIND.REPLACE) {
      const clash = splices.find((s) => s.start < s.end && s.start < redline.end && redline.start < s.end);
      if (clash) {
        skipped.push({ ruleId, reason: "OVERLAP", conflictsWith: clash.ruleId });
        return;
      }
      splices.push({ ruleId, start: redline.start, end: redline.end, text: written, order });
      return;
    }
    if (redline.afterClauseId === null) {
      splices.push({ ruleId, start: 0, end: 0, text: `${written}${EXPORT_TEXT.PARAGRAPH_BREAK}`, order });
      return;
    }
    const after = byId.get(redline.afterClauseId);
    if (!after) {
      skipped.push({ ruleId, reason: "UNKNOWN_CLAUSE", conflictsWith: null });
      return;
    }
    splices.push({ ruleId, start: after.end, end: after.end, text: `${EXPORT_TEXT.PARAGRAPH_BREAK}${written}`, order });
  });

  // Splice from the end so earlier offsets stay valid. At one offset a REPLACE
  // goes first (an INSERT there then lands in front of it, not inside it), and
  // among INSERTs the later queue item goes first so the earlier ends up in front.
  const ordered = [...splices].sort((a, b) => b.start - a.start || b.end - a.end || b.order - a.order);
  let revised = text;
  for (const splice of ordered) revised = revised.slice(0, splice.start) + splice.text + revised.slice(splice.end);

  const appliedIds = new Set(splices.map((s) => s.ruleId));
  return { text: revised, applied: accepted.map((a) => a.ruleId).filter((id) => appliedIds.has(id)), skipped };
}

/** Markdown Review Summary: escalations first, then every Finding in queue order. */
export function reviewSummary(
  findings: readonly Finding[],
  clauses: readonly Clause[],
  text: string,
  decisions: QueueState["decisions"],
  revised: RevisedDocument,
): string {
  const decided = findings.filter((finding) => decisions[finding.ruleId]).length;
  const escalated = findings.filter((finding) => decisions[finding.ruleId]?.kind === DECISION_KIND.ESCALATE);
  const lines: string[] = [`# ${EXPORT_TEXT.SUMMARY_HEADING}`, "", `${decided} of ${findings.length} findings decided.`, ""];

  lines.push(`## ${EXPORT_TEXT.ESCALATIONS_HEADING}`, "");
  if (escalated.length === 0) lines.push(EXPORT_TEXT.NO_ESCALATIONS);
  for (const finding of escalated) lines.push(`- **${ruleTitle(finding.ruleId)}**: ${decisions[finding.ruleId]?.reason ?? ""}`);
  lines.push("", `## ${EXPORT_TEXT.FINDINGS_HEADING}`);

  for (const finding of findings) {
    const decision = decisions[finding.ruleId];
    lines.push("", `### ${ruleTitle(finding.ruleId)}`, "");
    lines.push(`- Status: ${STATUS_LABELS[finding.status]}`);
    lines.push(`- Decision: ${decision ? DECISION_LABELS[decision.kind] : EXPORT_TEXT.UNDECIDED}`);
    if (decision?.reason) lines.push(`- Reason: ${decision.reason}`);
    const redline = redlineLine(finding, clauses, text, decision, revised);
    if (redline) lines.push(`- Redline: ${redline}`);
  }
  return `${lines.join("\n")}\n`;
}

function redlineLine(
  finding: Finding,
  clauses: readonly Clause[],
  text: string,
  decision: Decision | undefined,
  revised: RevisedDocument,
): string | null {
  const view = redlineView(finding, clauses, text);
  if (!view) return null;
  const headline = redlineHeadline(view);
  if (revised.applied.includes(finding.ruleId)) {
    return `${headline}, ${decision?.kind === DECISION_KIND.EDIT ? EXPORT_TEXT.APPLIED_EDITED : EXPORT_TEXT.APPLIED}`;
  }
  const skip = revised.skipped.find((s) => s.ruleId === finding.ruleId);
  if (skip?.reason === "OVERLAP" && skip.conflictsWith) {
    return `${headline}, ${EXPORT_TEXT.SKIPPED_OVERLAP} ${ruleTitle(skip.conflictsWith)}`;
  }
  if (skip) return `${headline}, ${EXPORT_TEXT.SKIPPED_UNKNOWN_CLAUSE}`;
  return `${headline}, ${EXPORT_TEXT.NOT_APPLIED}`;
}
