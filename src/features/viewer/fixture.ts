import {
  BLOCKED_REASON,
  CONFIDENCE,
  ERROR_KIND,
  FINDING_SOURCE,
  FINDING_STATUS,
  REDLINE_KIND,
  RULE_ID,
  RULE_KIND,
} from "@/common/constants";
import type { Citation } from "@/features/citations/types";
import { segmentDocument } from "@/features/document/segment";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";

/**
 * Demo review: `DEMO_TEXT` backs the input's "Load sample NDA" button; the
 * Clauses and hand-written Findings exercise the viewer in tests. Clauses come from the real splitter and every offset is computed from
 * substrings of the text, so the fixture can't drift from the Document.
 */

export const DEMO_TEXT = [
  "MUTUAL NONDISCLOSURE AGREEMENT",
  "",
  'This Mutual Nondisclosure Agreement is entered into by Acme Robotics, Inc. and Northwind Analytics LLC (each a "party").',
  "",
  "1. Confidential Information. Each party may disclose Confidential Information to the other party in connection with evaluating a potential business relationship.",
  "",
  "2. Exclusions. Confidential Information does not include information that:",
  "(a) is or becomes publicly available through no fault of the receiving party;",
  "(b) was already known to the receiving party without restriction; or",
  "(c) is received from a third party without a duty of confidentiality.",
  "",
  "3. Obligations. Each party shall hold the other party's Confidential Information in strict confidence for a period of five (5) years after termination of this Agreement and shall use it only for the purpose described above.",
  "",
  "4. Non-Solicitation. During the term of this Agreement and for twelve (12) months thereafter, neither party shall solicit for employment any employee of the other party with whom it had contact under this Agreement.",
  "",
  "5. Return of Materials. Upon written request, the receiving party shall promptly return or destroy all Confidential Information of the disclosing party.",
  "",
  "6. Term. This Agreement takes effect on the date of the last signature and continues for one (1) year unless terminated earlier by either party on thirty (30) days' written notice.",
  "",
].join("\n");

export const DEMO_CLAUSES: readonly Clause[] = segmentDocument(DEMO_TEXT);

/** The Clause containing the first occurrence of `snippet`. */
function clauseContaining(snippet: string): Clause {
  const start = DEMO_TEXT.indexOf(snippet);
  const clause = DEMO_CLAUSES.find((c) => c.start <= start && start + snippet.length <= c.end);
  if (start === -1 || !clause) throw new Error(`demo fixture: no Clause contains "${snippet}"`);
  return clause;
}

function clauseIdOf(snippet: string): ClauseId {
  return clauseContaining(snippet).id;
}

/** A Citation at the first occurrence of `quote`, as the quote verifier would produce. */
function cite(quote: string): Citation {
  const clause = clauseContaining(quote);
  const start = DEMO_TEXT.indexOf(quote);
  return { clauseId: clause.id, start, end: start + quote.length };
}

const survival = cite("in strict confidence for a period of five (5) years after termination of this Agreement");
const fiveYears = cite("five (5) years");

export const DEMO_FINDINGS: readonly Finding[] = [
  {
    ruleId: RULE_ID.MUTUAL,
    ruleKind: RULE_KIND.REQUIRED,
    status: FINDING_STATUS.COMPLIANT,
    confidence: CONFIDENCE.HIGH,
    source: FINDING_SOURCE.MODEL,
    citations: [
      cite("Each party may disclose Confidential Information to the other party"),
      // Overlaps the CONFIDENTIALITY_TERM Citation on "in strict confidence".
      cite("Each party shall hold the other party's Confidential Information in strict confidence"),
    ],
    blockedCitations: [],
    redline: null,
    explanation:
      "Both parties disclose and receive, and the confidentiality obligation in §3 binds each party equally.",
    verifierNote: null,
    error: null,
    attempts: 1,
  },
  {
    ruleId: RULE_ID.GOVERNING_LAW,
    ruleKind: RULE_KIND.REQUIRED,
    status: FINDING_STATUS.NOT_FOUND,
    confidence: CONFIDENCE.HIGH,
    source: FINDING_SOURCE.MODEL,
    citations: [],
    blockedCitations: [],
    redline: {
      kind: REDLINE_KIND.INSERT,
      afterClauseId: clauseIdOf("6. Term."),
      text: "7. Governing Law. This Agreement is governed by the laws of the State of Delaware, without regard to its conflict-of-laws rules.",
    },
    explanation: "The agreement has no governing-law clause.",
    verifierNote: null,
    error: null,
    attempts: 1,
  },
  {
    ruleId: RULE_ID.CONFIDENTIALITY_TERM,
    ruleKind: RULE_KIND.REQUIRED,
    status: FINDING_STATUS.RISK_FOUND,
    confidence: CONFIDENCE.HIGH,
    source: FINDING_SOURCE.MODEL,
    citations: [survival],
    blockedCitations: [],
    redline: { kind: REDLINE_KIND.REPLACE, ...fiveYears, replacement: "two (2) years" },
    explanation: "Confidentiality survives five years after termination, longer than the two-year maximum.",
    verifierNote: null,
    error: null,
    attempts: 1,
  },
  {
    ruleId: RULE_ID.NO_NON_SOLICIT,
    ruleKind: RULE_KIND.PROHIBITED,
    status: FINDING_STATUS.RISK_FOUND,
    confidence: CONFIDENCE.LOW,
    source: FINDING_SOURCE.MODEL,
    citations: [cite("neither party shall solicit for employment any employee of the other party")],
    // A second proposed Citation pointed at a Clause ID that doesn't exist.
    blockedCitations: [{ clauseId: null, reason: BLOCKED_REASON.UNKNOWN_CLAUSE }],
    redline: null,
    explanation:
      "§4 restricts soliciting the other party's employees for twelve months, which the playbook prohibits.",
    verifierNote:
      "Lowered confidence: the restriction is limited to employees met under the agreement; a reviewer should decide whether to strike it.",
    error: null,
    attempts: 2,
  },
  {
    ruleId: RULE_ID.NO_RESIDUALS,
    ruleKind: RULE_KIND.PROHIBITED,
    status: FINDING_STATUS.ERROR,
    confidence: CONFIDENCE.LOW,
    source: FINDING_SOURCE.MODEL,
    citations: [],
    blockedCitations: [],
    redline: null,
    explanation: "",
    verifierNote: null,
    error: { kind: ERROR_KIND.TIMEOUT, message: "The model did not respond within 60 seconds." },
    attempts: 1,
  },
  {
    ruleId: RULE_ID.CONFIDENTIALITY_CARVE_OUTS,
    ruleKind: RULE_KIND.REQUIRED,
    status: FINDING_STATUS.RISK_FOUND,
    confidence: CONFIDENCE.HIGH,
    source: FINDING_SOURCE.MODEL,
    citations: [],
    // Citation Blocked Finding: the only proposed Citation failed verification after its retry.
    blockedCitations: [{ clauseId: clauseIdOf("(c) is received from a third party"), reason: BLOCKED_REASON.NOT_IN_CLAUSE }],
    redline: null,
    explanation:
      "The exclusions cover public, already-known and third-party information but omit independently developed information and disclosures compelled by law.",
    verifierNote: null,
    error: null,
    attempts: 2,
  },
];
