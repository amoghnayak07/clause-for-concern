import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import {
  BLOCKED_REASON,
  EXPLANATION_MAX_SENTENCES,
  MIN_QUOTE_CHARS,
  RULE_KIND,
  type BlockedReason,
  type PlaybookRule,
} from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { CitationFailure, Claim, ReviewDocument } from "./state";

/**
 * Prompt builders. Every call is single-turn and built fresh from state
 * (DESIGN "Context discipline"): Clauses are sent once as `<clause>` elements,
 * never alongside the raw text, and the Document block comes first so it is
 * identical across Rules (cache-ready).
 */

/* ------------------------------------------------------------------------ */
/* Shared                                                                    */
/* ------------------------------------------------------------------------ */

const CITATION_RULES = [
  "Citations point at evidence. Each has a clauseId and a quote.",
  "A quote must be copied exactly from the text of that one Clause: contiguous, same wording and case, no ellipses, no paraphrase, no text from other Clauses.",
  `A quote must be at least ${MIN_QUOTE_CHARS} characters, or the whole Clause if it is shorter.`,
  "A Parent Clause holds only its own intro text; quote a child Clause for text that appears under it.",
].join("\n");

const EXPLANATION_RULES = [
  `explanation: at most ${EXPLANATION_MAX_SENTENCES} plain sentences for a reviewer, in your own words.`,
  "Refer to Clauses by label. Do not quote contract text in the explanation; put evidence in citations.",
].join("\n");

export function renderClause(document: ReviewDocument, clause: Clause): string {
  const parent = clause.parentId === null ? "" : ` parent="${clause.parentId}"`;
  const text = document.text.slice(clause.start, clause.end);
  return `<clause id="${clause.id}" label="${clause.label}"${parent}>\n${text}\n</clause>`;
}

/** The whole Document, as Clauses. Identical for every Rule. */
export function documentBlock(document: ReviewDocument): TextBlockParam {
  const clauses = document.clauses.map((clause) => renderClause(document, clause)).join("\n");
  return { type: "text", text: `<document>\n${clauses}\n</document>` };
}

/** The given Clauses plus their Parent Clauses' intro text, in Document order. */
export function excerptBlock(document: ReviewDocument, clauseIds: Iterable<ClauseId>): TextBlockParam {
  const clauses = withParents(document, clauseIds).map((clause) => renderClause(document, clause)).join("\n");
  return { type: "text", text: `<excerpt>\n${clauses}\n</excerpt>` };
}

function withParents(document: ReviewDocument, clauseIds: Iterable<ClauseId>): Clause[] {
  const byId = new Map(document.clauses.map((clause) => [clause.id, clause]));
  const wanted = new Set<ClauseId>();
  for (const id of clauseIds) {
    let clause = byId.get(id);
    while (clause && !wanted.has(clause.id)) {
      wanted.add(clause.id);
      clause = clause.parentId === null ? undefined : byId.get(clause.parentId);
    }
  }
  return document.clauses.filter((clause) => wanted.has(clause.id));
}

function ruleBlock(rule: PlaybookRule): string {
  const kindGuide =
    rule.kind === RULE_KIND.REQUIRED
      ? "REQUIRED: the Document must contain a conforming Clause. A conforming Clause is COMPLIANT, a non-conforming one is RISK_FOUND, and no relevant Clause at all is NOT_FOUND."
      : "PROHIBITED: the Document must not contain such a Clause. Any such Clause, wherever it appears (including inside definitions), is RISK_FOUND; absence is COMPLIANT. Never use NOT_FOUND.";
  return `<rule id="${rule.id}" kind="${rule.kind}" title="${rule.title}">\n${rule.definition}\n${kindGuide}\n</rule>`;
}

/* ------------------------------------------------------------------------ */
/* Detector                                                                  */
/* ------------------------------------------------------------------------ */

export const DETECTOR_SYSTEM =
  "You review NDAs against one playbook Rule at a time for a legal reviewer. " +
  "Recall matters most: when unsure whether a Clause violates the Rule, report RISK_FOUND with LOW confidence rather than COMPLIANT. " +
  "Every claim about the contract must be backed by an exact quote from it.";

export function detectorContent(document: ReviewDocument, rule: PlaybookRule): TextBlockParam[] {
  const instructions = [
    "Check the Document above against this Rule only.",
    ruleBlock(rule),
    "",
    "Return:",
    "status: RISK_FOUND, COMPLIANT or NOT_FOUND as the Rule defines them.",
    "confidence: HIGH, or LOW when the wording is ambiguous or you might have missed something.",
    "citations: every Clause that bears on the Rule. Required for RISK_FOUND, and for COMPLIANT on a REQUIRED Rule. Empty for NOT_FOUND and for COMPLIANT on a PROHIBITED Rule.",
    CITATION_RULES,
    "redline: one minimal edit that would make the Document comply, or null.",
    "- RISK_FOUND: kind REPLACE, clauseId of a cited Clause, targetQuote the exact text in it to replace (same quoting rules), text its replacement. Change as little as possible.",
    "- NOT_FOUND: kind INSERT, clauseId of the Clause to insert after (null for the start), targetQuote null, text the new Clause.",
    "- COMPLIANT: null.",
    EXPLANATION_RULES,
  ].join("\n");
  return [documentBlock(document), { type: "text", text: instructions }];
}

/* ------------------------------------------------------------------------ */
/* Citation repair                                                           */
/* ------------------------------------------------------------------------ */

const REASON_TEXT: Readonly<Record<BlockedReason, string>> = {
  UNKNOWN_CLAUSE: "there is no Clause with that ID",
  NOT_IN_CLAUSE: "the text does not appear in that Clause",
  FOUND_IN_OTHER_CLAUSE: "the text appears in a different Clause, not the one cited",
  TOO_SHORT: `the quote is shorter than ${MIN_QUOTE_CHARS} characters`,
};

/**
 * Re-asks only the failed quotes. Shows the real text of each cited Clause
 * (plus Parent intro); the full Document only if a Clause ID was unknown.
 */
export function repairContent(
  document: ReviewDocument,
  rule: PlaybookRule,
  claim: Claim,
  failures: readonly CitationFailure[],
): TextBlockParam[] {
  const needsWholeDocument = failures.some((f) => f.blocked.reason === BLOCKED_REASON.UNKNOWN_CLAUSE);
  const cited = failures.flatMap((f) => (f.blocked.clauseId === null ? [] : [f.blocked.clauseId]));
  const context = needsWholeDocument ? documentBlock(document) : excerptBlock(document, cited);

  const items = failures.map((failure, i) => {
    const what = failure.kind === "REDLINE_TARGET" ? "Redline target" : "Citation";
    return [
      `<failed item="${i + 1}" kind="${what}" clauseId="${failure.proposed.clauseId}">`,
      `<quote>${failure.proposed.quote}</quote>`,
      `<problem>${REASON_TEXT[failure.blocked.reason]}</problem>`,
      "</failed>",
    ].join("\n");
  });

  const redlineFailed = failures.some((f) => f.kind === "REDLINE_TARGET");
  const instructions = [
    "You reviewed the Document against this Rule, but some quotes you gave could not be found as written.",
    ruleBlock(rule),
    `Your finding: ${claim.status}. Your explanation: ${claim.explanation}`,
    "",
    ...items,
    "",
    "Fix only the failed items, using the real Clause text above.",
    CITATION_RULES,
    "repairs: one entry per item you can fix, with its item number, the Clause that actually contains the text, and the exact quote. Omit an item if no exact text supports it.",
    redlineFailed
      ? "redlineTarget: the exact text to replace in the Redline's Clause and its replacement, or null if you cannot find exact text."
      : "redlineTarget: null.",
  ].join("\n");

  return [context, { type: "text", text: instructions }];
}

/* ------------------------------------------------------------------------ */
/* Clause mapping (Coverage)                                                 */
/* ------------------------------------------------------------------------ */

export const MAP_CLAUSES_SYSTEM =
  "You index NDA Clauses against a fixed playbook so a reviewer can see which Clauses were considered. " +
  "You only tag Clauses; you do not judge compliance.";

/** Asks for every Clause's relevant Rule IDs (empty when it bears on none). */
export function mapClausesContent(document: ReviewDocument, rules: readonly PlaybookRule[]): TextBlockParam[] {
  const playbook = rules.map((rule) => `<rule id="${rule.id}" title="${rule.title}">\n${rule.definition}\n</rule>`);
  const instructions = [
    "These are the playbook Rules:",
    ...playbook,
    "",
    "For every Clause in the Document above, list the IDs of the Rules it bears on, in either direction (complying or violating).",
    "Use an empty list for a Clause that bears on none of them, such as a title, a recital or a signature block.",
    "clauses: one entry per Clause, using its id exactly as given. Do not skip Clauses.",
  ].join("\n");
  return [documentBlock(document), { type: "text", text: instructions }];
}

/* ------------------------------------------------------------------------ */
/* Verifier                                                                  */
/* ------------------------------------------------------------------------ */

export const VERIFIER_SYSTEM =
  "You double-check another reviewer's finding on one NDA playbook Rule. " +
  "Be independent and skeptical: look for violations they missed and for evidence that does not support their claim. " +
  "Every claim about the contract must be backed by an exact quote from it.";

export interface VerifierPromptInput {
  readonly rule: PlaybookRule;
  readonly status: string;
  readonly explanation: string;
  /** Real Document text of each verified Citation. */
  readonly citedText: readonly { label: string; text: string }[];
  /** Clauses to show; null shows the whole Document. */
  readonly contextClauseIds: readonly ClauseId[] | null;
  /** Set for a Possible Miss: the Trigger Terms that raised it. */
  readonly triggerTerms: readonly string[];
}

export function verifierContent(document: ReviewDocument, input: VerifierPromptInput): TextBlockParam[] {
  const context =
    input.contextClauseIds === null ? documentBlock(document) : excerptBlock(document, input.contextClauseIds);
  const scope =
    input.contextClauseIds === null
      ? "The whole Document is above."
      : "Only the relevant Clauses (and their Parent Clauses) are above.";

  const evidence = input.citedText.map((c) => `<cited label="${c.label}">\n${c.text}\n</cited>`);
  const finding = [
    `<finding status="${input.status}">`,
    `<explanation>${input.explanation}</explanation>`,
    ...evidence,
    "</finding>",
  ];
  const possibleMiss =
    input.triggerTerms.length > 0
      ? [
          `The detector reported no relevant Clause, but these Trigger Terms occur in the Clauses above: ${input.triggerTerms.join(", ")}.`,
          "Decide whether any of those Clauses actually falls under the Rule.",
        ]
      : [];

  const instructions = [
    `${scope} A detector checked it against this Rule:`,
    ruleBlock(input.rule),
    ...finding,
    ...possibleMiss,
    "",
    "Return:",
    "status: your own assessment (RISK_FOUND, COMPLIANT or NOT_FOUND).",
    "confidence: HIGH only if the evidence clearly supports your status; otherwise LOW.",
    "newCitations: evidence for a violation that is not already cited, else empty.",
    CITATION_RULES,
    `note: at most ${EXPLANATION_MAX_SENTENCES} sentences for the reviewer on whether the finding holds. Refer to Clauses by label; do not quote contract text.`,
  ].join("\n");

  return [context, { type: "text", text: instructions }];
}
