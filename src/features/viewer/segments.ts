import {
  ACTION_SORT_ORDER,
  CLAUSE_DOM_ID_PREFIX,
  FINDING_DOM_ID_PREFIX,
  PLAYBOOK,
  REDLINE_KIND,
  type RecommendedAction,
  type RuleId,
} from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import { recommendedAction } from "@/features/review/derive";
import type { Splice } from "@/features/review/export";
import type { Finding } from "@/features/review/finding";

/**
 * Pure render model for the Document viewer (DESIGN "UI", ADR 0002).
 *
 * The original Document text is cut into blocks (Clauses, plus the gaps
 * between them) and each block into runs whose highlights come only from
 * verified Citation offsets. Model quote text never reaches this code.
 */

/** One verified Citation covering a run, traced back to its Finding. */
export interface Highlight {
  readonly ruleId: RuleId;
  readonly action: RecommendedAction;
  /** Index into the Finding's `citations`. */
  readonly citationIndex: number;
}

export interface TextRun {
  readonly start: number;
  readonly end: number;
  /** Covering Citations, most severe action first. Empty for plain text. */
  readonly highlights: readonly Highlight[];
  /** Citations that begin at this run's start (scroll anchors). */
  readonly anchors: readonly Highlight[];
  /** The Accepted Redline replacing this run, shown struck through. */
  readonly struckBy: RuleId | null;
  /** Accepted Redline text that lands at this run's end, in Revised Document order. */
  readonly insertsAfter: readonly Insertion[];
}

/** Text an Accepted Redline adds to the Document (a REPLACE's replacement or an INSERT). */
export interface Insertion {
  readonly ruleId: RuleId;
  readonly text: string;
}

export interface ViewerBlock {
  /** Null for text between Clauses (usually whitespace). */
  readonly clause: Clause | null;
  readonly start: number;
  readonly end: number;
  readonly runs: readonly TextRun[];
}

interface PlacedCitation extends Highlight {
  readonly start: number;
  readonly end: number;
}

const playbookOrder = new Map(PLAYBOOK.map((rule, index) => [rule.id, index]));

/** Most severe action first, then Playbook order, then Citation order. */
export function compareHighlights(a: Highlight, b: Highlight): number {
  return (
    ACTION_SORT_ORDER[a.action] - ACTION_SORT_ORDER[b.action] ||
    (playbookOrder.get(a.ruleId) ?? 0) - (playbookOrder.get(b.ruleId) ?? 0) ||
    a.citationIndex - b.citationIndex
  );
}

/**
 * `splices` are the Accepted Redlines (`planRevision`), drawn as tracked
 * changes: the original span stays (struck through) so Citation offsets and
 * highlights are untouched, and the new text follows it.
 */
export function buildViewerBlocks(
  text: string,
  clauses: readonly Clause[],
  findings: readonly Finding[],
  splices: readonly Splice[] = [],
): ViewerBlock[] {
  const citations = placeCitations(text, findings);
  const edits = splices.filter((s) => s.start >= 0 && s.end <= text.length && s.end >= s.start);
  return blockSpans(text, clauses).map(({ clause, start, end }) => ({
    clause,
    start,
    end,
    runs: buildRuns(start, end, citations, edits),
  }));
}

/** Accepted Redline text placed before the first character (an INSERT at the start of the Document). */
export function leadingInsertions(splices: readonly Splice[]): Insertion[] {
  return insertionsAt(0, splices);
}

/** Text landing at `offset`: a REPLACE ending there first, then INSERTs in queue order (as in `reviseDocument`). */
function insertionsAt(offset: number, splices: readonly Splice[]): Insertion[] {
  return splices
    .filter((s) => s.end === offset)
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.order - b.order)
    .filter((s) => s.text !== "")
    .map(({ ruleId, text }) => ({ ruleId, text }));
}

function placeCitations(text: string, findings: readonly Finding[]): PlacedCitation[] {
  const placed: PlacedCitation[] = [];
  for (const finding of findings) {
    const action = recommendedAction(finding);
    finding.citations.forEach((citation, citationIndex) => {
      // Defensive: a Citation outside the Document can't be drawn.
      if (citation.start < 0 || citation.end > text.length || citation.end <= citation.start) return;
      placed.push({ ruleId: finding.ruleId, action, citationIndex, start: citation.start, end: citation.end });
    });
  }
  return placed;
}

function blockSpans(text: string, clauses: readonly Clause[]): Array<Omit<ViewerBlock, "runs">> {
  const sorted = [...clauses].sort((a, b) => a.start - b.start);
  const spans: Array<Omit<ViewerBlock, "runs">> = [];
  let cursor = 0;
  for (const clause of sorted) {
    // Defensive: skip Clauses that overlap an earlier one or fall outside the text.
    if (clause.start < cursor || clause.end > text.length || clause.end < clause.start) continue;
    if (clause.start > cursor) spans.push({ clause: null, start: cursor, end: clause.start });
    spans.push({ clause, start: clause.start, end: clause.end });
    cursor = clause.end;
  }
  if (cursor < text.length) spans.push({ clause: null, start: cursor, end: text.length });
  return spans;
}

function buildRuns(
  start: number,
  end: number,
  citations: readonly PlacedCitation[],
  edits: readonly Splice[],
): TextRun[] {
  if (end <= start) return [];
  const boundaries = new Set([start, end]);
  for (const c of [...citations, ...edits]) {
    if (c.start > start && c.start < end) boundaries.add(c.start);
    if (c.end > start && c.end < end) boundaries.add(c.end);
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const runs: TextRun[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const runStart = points[i];
    const runEnd = points[i + 1];
    const covering = citations.filter((c) => c.start <= runStart && c.end >= runEnd);
    runs.push({
      start: runStart,
      end: runEnd,
      highlights: covering.map(toHighlight).sort(compareHighlights),
      anchors: covering.filter((c) => c.start === runStart).map(toHighlight).sort(compareHighlights),
      struckBy: edits.find((s) => s.start <= runStart && s.end >= runEnd)?.ruleId ?? null,
      insertsAfter: insertionsAt(runEnd, edits),
    });
  }
  return runs;
}

function toHighlight({ ruleId, action, citationIndex }: PlacedCitation): Highlight {
  return { ruleId, action, citationIndex };
}

/**
 * The Finding a click on a highlighted run should focus: the most severe one,
 * or, if one of the run's Findings is already focused, the next one (so
 * repeated clicks cycle through overlapping Findings).
 */
export function nextFocusRuleId(highlights: readonly Highlight[], focusedRuleId: RuleId | null | undefined): RuleId | null {
  const ruleIds = [...new Set(highlights.map((h) => h.ruleId))];
  if (ruleIds.length === 0) return null;
  const current = focusedRuleId ? ruleIds.indexOf(focusedRuleId) : -1;
  return ruleIds[(current + 1) % ruleIds.length];
}

/** The highlight that decides a run's colour: the focused Finding's, else the most severe. */
export function displayHighlight(run: TextRun, focusedRuleId: RuleId | null | undefined): Highlight | null {
  return run.highlights.find((h) => h.ruleId === focusedRuleId) ?? run.highlights[0] ?? null;
}

export type ScrollTarget =
  | { readonly kind: "citation"; readonly ruleId: RuleId; readonly citationIndex: number }
  | { readonly kind: "clause"; readonly clauseId: ClauseId };

/**
 * Where to scroll when a Finding is focused: its earliest verified Citation;
 * otherwise a Clause it points at (blocked Citation with a real Clause, or a
 * Redline's anchor); otherwise nothing (positionless Finding).
 */
export function scrollTarget(finding: Finding, clauses: readonly Clause[]): ScrollTarget | null {
  let firstIndex = -1;
  for (let i = 0; i < finding.citations.length; i++) {
    if (firstIndex === -1 || finding.citations[i].start < finding.citations[firstIndex].start) firstIndex = i;
  }
  if (firstIndex !== -1) return { kind: "citation", ruleId: finding.ruleId, citationIndex: firstIndex };

  const known = new Set(clauses.map((c) => c.id));
  const candidates: Array<ClauseId | null> = [
    ...finding.blockedCitations.map((b) => b.clauseId),
    finding.redline?.kind === REDLINE_KIND.REPLACE ? finding.redline.clauseId : null,
    finding.redline?.kind === REDLINE_KIND.INSERT ? finding.redline.afterClauseId : null,
  ];
  const clauseId = candidates.find((id): id is ClauseId => id !== null && known.has(id));
  return clauseId ? { kind: "clause", clauseId } : null;
}

export function clauseDomId(clauseId: ClauseId): string {
  return `${CLAUSE_DOM_ID_PREFIX}${clauseId}`;
}

export function findingDomId(ruleId: RuleId): string {
  return `${FINDING_DOM_ID_PREFIX}${ruleId}`;
}

/** Token used in a run's `data-citation-anchors` list (match with `~=`). */
export function citationKey(ruleId: RuleId, citationIndex: number): string {
  return `${ruleId}:${citationIndex}`;
}
