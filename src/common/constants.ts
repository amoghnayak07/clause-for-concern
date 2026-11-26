/**
 * Single source of truth for every fixed value in the app: playbook, status
 * values, colours, keyboard shortcuts, retry counts, thresholds and limits.
 *
 * Environment-specific values (API key, model name) do NOT belong here; they
 * come only from `@/config`.
 */

type ValueOf<T> = T[keyof T];

/** Product name: page title and the workspace heading. */
export const APP_NAME = "Clause for Concern";

/* ------------------------------------------------------------------------ */
/* Playbook                                                                  */
/* ------------------------------------------------------------------------ */

export const RULE_KIND = {
  REQUIRED: "REQUIRED",
  PROHIBITED: "PROHIBITED",
} as const;
export type RuleKind = ValueOf<typeof RULE_KIND>;

export const RULE_ID = {
  MUTUAL: "MUTUAL",
  GOVERNING_LAW: "GOVERNING_LAW",
  CONFIDENTIALITY_TERM: "CONFIDENTIALITY_TERM",
  NO_NON_SOLICIT: "NO_NON_SOLICIT",
  NO_RESIDUALS: "NO_RESIDUALS",
  CONFIDENTIALITY_CARVE_OUTS: "CONFIDENTIALITY_CARVE_OUTS",
} as const;
export type RuleId = ValueOf<typeof RULE_ID>;

export interface PlaybookRule {
  readonly id: RuleId;
  readonly kind: RuleKind;
  /** Short human title for UI. */
  readonly title: string;
  /** Precise pass/fail definition; shown to the model and the reviewer. */
  readonly definition: string;
  /**
   * Trigger Terms: case-insensitive phrases whose presence contradicts a model
   * claim that no relevant Clause exists (see GLOSSARY "Possible Miss").
   */
  readonly triggerTerms: readonly string[];
}

export const PLAYBOOK: readonly PlaybookRule[] = [
  {
    id: RULE_ID.MUTUAL,
    kind: RULE_KIND.REQUIRED,
    title: "Mutual obligations",
    definition:
      "Both parties are bound as Disclosing Party and as Receiving Party, on symmetric terms. " +
      "A one-way NDA is RISK_FOUND. A nominally mutual NDA where one party's obligations are narrower " +
      "or heavier (e.g. only one side has return/destroy or audit duties) is RISK_FOUND.",
    triggerTerms: ["mutual", "each party", "either party", "disclosing party", "receiving party"],
  },
  {
    id: RULE_ID.GOVERNING_LAW,
    kind: RULE_KIND.REQUIRED,
    title: "Governing law: Delaware or California",
    definition:
      "The governing law is Delaware or California. Venue, forum and jurisdiction of courts are ignored " +
      "(Delaware law with exclusive New York courts is COMPLIANT). Any other governing law is RISK_FOUND. " +
      "No governing-law clause at all is NOT_FOUND.",
    triggerTerms: ["governing law", "governed by", "laws of the state", "construed in accordance", "choice of law"],
  },
  {
    id: RULE_ID.CONFIDENTIALITY_TERM,
    kind: RULE_KIND.REQUIRED,
    title: "Confidentiality term ≤ 2 years",
    definition:
      "Applies to how long confidentiality obligations survive, not the term of the agreement itself. " +
      "Survival of 2 years or less is COMPLIANT; an additional indefinite period limited to trade secrets " +
      "(for as long as they remain trade secrets) is still COMPLIANT. Longer than 2 years, perpetual, or " +
      "'until the information becomes public' is RISK_FOUND. No stated duration is NOT_FOUND.",
    triggerTerms: ["surviv", "year", "perpetu", "indefinite", "in perpetuity", "period of", "expir"],
  },
  {
    id: RULE_ID.NO_NON_SOLICIT,
    kind: RULE_KIND.PROHIBITED,
    title: "No non-solicit",
    definition:
      "The document must not restrict soliciting, hiring or recruiting either party's employees, " +
      "contractors, customers or suppliers. This includes soft forms such as 'shall not use Confidential " +
      "Information to solicit'. Any such restriction is RISK_FOUND. Absence is COMPLIANT.",
    triggerTerms: ["solicit", "hire", "hiring", "employ", "recruit", "poach", "induce"],
  },
  {
    id: RULE_ID.NO_RESIDUALS,
    kind: RULE_KIND.PROHIBITED,
    title: "No residuals clause",
    definition:
      "The document must not permit use of information retained in the unaided memory of personnel " +
      "(a 'residuals' clause), wherever it appears, including inside definitions. Any such right is " +
      "RISK_FOUND. Absence is COMPLIANT.",
    triggerTerms: ["residual", "unaided memory", "retained in memory", "retained in the memory", "general skills", "know-how"],
  },
  {
    id: RULE_ID.CONFIDENTIALITY_CARVE_OUTS,
    kind: RULE_KIND.REQUIRED,
    title: "Standard confidentiality carve-outs",
    definition:
      "All five standard exclusions must be present: (1) publicly available through no fault of the " +
      "recipient; (2) already known to the recipient; (3) independently developed; (4) received from a " +
      "third party without a duty of confidence; (5) disclosure compelled by law, with notice to the " +
      "discloser. Some but not all present is RISK_FOUND and the explanation must name the missing ones. " +
      "None present is NOT_FOUND.",
    triggerTerms: [
      "publicly available",
      "public domain",
      "generally available",
      "already known",
      "independently developed",
      "third party",
      "required by law",
      "court order",
      "subpoena",
    ],
  },
] as const;

/* ------------------------------------------------------------------------ */
/* Clauses                                                                   */
/* ------------------------------------------------------------------------ */

export const CLAUSE_ID_PREFIX = "c-";
export const CLAUSE_ID_PAD_LENGTH = 3;

/**
 * Clause label prefixes: numbered Clauses read "§3.2(a)", unnumbered
 * blank-line paragraphs read "P1", "P2", ...
 */
export const CLAUSE_LABEL_PREFIX = {
  NUMBERED: "§",
  PARAGRAPH: "P",
} as const;

/* ------------------------------------------------------------------------ */
/* Findings                                                                  */
/* ------------------------------------------------------------------------ */

export const FINDING_STATUS = {
  RISK_FOUND: "RISK_FOUND",
  COMPLIANT: "COMPLIANT",
  NOT_FOUND: "NOT_FOUND",
  ERROR: "ERROR",
} as const;
export type FindingStatus = ValueOf<typeof FINDING_STATUS>;

export const CONFIDENCE = {
  HIGH: "HIGH",
  LOW: "LOW",
} as const;
export type Confidence = ValueOf<typeof CONFIDENCE>;

export const FINDING_SOURCE = {
  MODEL: "MODEL",
  TRIGGER_TERM: "TRIGGER_TERM",
} as const;
export type FindingSource = ValueOf<typeof FINDING_SOURCE>;

export const BLOCKED_REASON = {
  UNKNOWN_CLAUSE: "UNKNOWN_CLAUSE",
  NOT_IN_CLAUSE: "NOT_IN_CLAUSE",
  FOUND_IN_OTHER_CLAUSE: "FOUND_IN_OTHER_CLAUSE",
  TOO_SHORT: "TOO_SHORT",
} as const;
export type BlockedReason = ValueOf<typeof BLOCKED_REASON>;

export const REDLINE_KIND = {
  REPLACE: "REPLACE",
  INSERT: "INSERT",
} as const;
export type RedlineKind = ValueOf<typeof REDLINE_KIND>;

export const ERROR_KIND = {
  SCHEMA: "SCHEMA",
  API: "API",
  TIMEOUT: "TIMEOUT",
  REFUSAL: "REFUSAL",
  INTERNAL: "INTERNAL",
} as const;
export type ErrorKind = ValueOf<typeof ERROR_KIND>;

/** Derived from a Finding, never stored. */
export const RECOMMENDED_ACTION = {
  ESCALATE: "ESCALATE",
  FIX: "FIX",
  NONE: "NONE",
} as const;
export type RecommendedAction = ValueOf<typeof RECOMMENDED_ACTION>;

/** Derived from a Finding, never stored. */
export const CITATION_STATE = {
  /** Every proposed Citation verified. */
  VERIFIED: "VERIFIED",
  /** Some verified, some blocked. */
  PARTIAL: "PARTIAL",
  /** Citation Blocked Finding: Citations were proposed and all were blocked. */
  BLOCKED: "BLOCKED",
  /** Nothing was cited (e.g. NOT_FOUND, PROHIBITED COMPLIANT, Possible Miss, ERROR). */
  NONE: "NONE",
} as const;
export type CitationState = ValueOf<typeof CITATION_STATE>;

/** Queue order: lower sorts first. */
export const ACTION_SORT_ORDER: Readonly<Record<RecommendedAction, number>> = {
  ESCALATE: 0,
  FIX: 1,
  NONE: 2,
};

/* ------------------------------------------------------------------------ */
/* Decisions                                                                 */
/* ------------------------------------------------------------------------ */

export const DECISION_KIND = {
  APPROVE: "APPROVE",
  EDIT: "EDIT",
  ESCALATE: "ESCALATE",
  DISMISS: "DISMISS",
} as const;
export type DecisionKind = ValueOf<typeof DECISION_KIND>;

/* ------------------------------------------------------------------------ */
/* Colours (read by the MUI theme)                                           */
/* ------------------------------------------------------------------------ */

/**
 * App chrome. Every colour in this section must stay at or above WCAG AA on
 * both surfaces (`theme.contrast.test.ts`). Review colours are used as text, so
 * they need 4.5:1, not just the 3:1 allowed for non-text marks.
 */
export const BRAND_COLORS = {
  PRIMARY: "#1F3A5F",
  SECONDARY: "#6B4E9B",
  BACKGROUND: "#F6F7F9",
  PAPER: "#FFFFFF",
} as const;

export const ACTION_COLORS: Readonly<Record<RecommendedAction, string>> = {
  ESCALATE: "#C62828",
  // Amber 700: the brighter amber 500 was 2.1:1 on white, too faint for redline headings and minimap ticks.
  FIX: "#B45309",
  NONE: "#2E7D32",
};

export const STATUS_COLORS: Readonly<Record<FindingStatus, string>> = {
  RISK_FOUND: "#C62828",
  NOT_FOUND: "#AD1457",
  COMPLIANT: "#2E7D32",
  ERROR: "#455A64",
};

// Grey 600: grey 500 was 2.7:1, below the 3:1 non-text minimum for dashed outlines and ticks.
export const UNMAPPED_CLAUSE_COLOR = "#757575";
export const CITATION_HIGHLIGHT_ALPHA = 0.18;
/** Highlight strength for the focused Finding's Citations. */
export const FOCUSED_CITATION_HIGHLIGHT_ALPHA = 0.4;
export const DECIDED_TICK_OPACITY = 0.35;

/* ------------------------------------------------------------------------ */
/* Viewer                                                                    */
/* ------------------------------------------------------------------------ */

/** DOM id prefixes so other features (queue, minimap, coverage) can scroll to elements. */
export const CLAUSE_DOM_ID_PREFIX = "clause-";
export const FINDING_DOM_ID_PREFIX = "finding-";

export const STATUS_LABELS: Readonly<Record<FindingStatus, string>> = {
  RISK_FOUND: "Risk found",
  COMPLIANT: "Compliant",
  NOT_FOUND: "Not found",
  ERROR: "Error",
};

export const ACTION_LABELS: Readonly<Record<RecommendedAction, string>> = {
  ESCALATE: "Escalate",
  FIX: "Fix",
  NONE: "No action",
};

export const CONFIDENCE_LABELS: Readonly<Record<Confidence, string>> = {
  HIGH: "High confidence",
  LOW: "Low confidence",
};

export const POSSIBLE_MISS_LABEL = "Possible Miss";

export const BLOCKED_REASON_LABELS: Readonly<Record<BlockedReason, string>> = {
  UNKNOWN_CLAUSE: "The cited clause does not exist in the document.",
  NOT_IN_CLAUSE: "The quote was not found in the cited clause.",
  FOUND_IN_OTHER_CLAUSE: "The quote appears in a different clause.",
  TOO_SHORT: "The quote was too short to verify.",
};

/** UI copy for model free text (GLOSSARY "Agent's Reasoning"). */
export const AGENT_REASONING_LABEL = "Agent's Reasoning";
export const VERIFIER_NOTE_LABEL = "Verifier note";

/* ------------------------------------------------------------------------ */
/* Keyboard triage                                                           */
/* ------------------------------------------------------------------------ */

export const KEYBOARD_SHORTCUTS = {
  NEXT: "k",
  PREVIOUS: "j",
  APPROVE: "a",
  EDIT: "e",
  ESCALATE: "x",
  DISMISS: "d",
} as const;
export type ShortcutAction = keyof typeof KEYBOARD_SHORTCUTS;

/** On-screen hint, in display order. */
export const SHORTCUT_HINTS: readonly { readonly action: ShortcutAction; readonly label: string }[] = [
  { action: "NEXT", label: "next" },
  { action: "PREVIOUS", label: "previous" },
  { action: "APPROVE", label: "approve" },
  { action: "EDIT", label: "edit redline" },
  { action: "ESCALATE", label: "escalate" },
  { action: "DISMISS", label: "dismiss" },
];

export const DECISION_LABELS: Readonly<Record<DecisionKind, string>> = {
  APPROVE: "Approved",
  EDIT: "Edited",
  ESCALATE: "Escalated",
  DISMISS: "Dismissed",
};

/** Decided, unfocused cards fade so the remaining work stands out. */
export const DECIDED_CARD_OPACITY = 0.6;

export const QUEUE_UI_TEXT = {
  HEADING: "Review queue",
  EDIT_LABEL: "Redline text",
  EDIT_HELP: "Enter to save, Shift+Enter for a new line, Esc to cancel.",
  DIFF_LABEL: "Clause after your edit",
  ESCALATE_LABEL: "Why escalate? (required)",
  DISMISS_LABEL: "Why dismiss? (optional)",
  REASON_HELP: "Enter to save, Esc to cancel.",
  SAVE: "Save",
  CANCEL: "Cancel",
  ALL_DECIDED: "All findings decided",
} as const;

/** Export (DESIGN "Export"): Revised Document and Review Summary downloads. */
export const EXPORT_FILES = {
  REVISED: { NAME: "nda-revised.txt", TYPE: "text/plain;charset=utf-8" },
  SUMMARY: { NAME: "nda-review-summary.md", TYPE: "text/markdown;charset=utf-8" },
} as const;

export const EXPORT_TEXT = {
  /** Separates an inserted Clause from its neighbour in the Revised Document. */
  PARAGRAPH_BREAK: "\n\n",
  /** Tooltip prefix on accepted text shown in the viewer. */
  TRACKED_CHANGE: "Accepted redline",
  DOWNLOAD_REVISED: "Download revised NDA",
  DOWNLOAD_SUMMARY: "Download review summary",
  /** Shown beside the buttons while some Findings are undecided. */
  UNDECIDED_WARNING: "Undecided findings are exported unchanged.",
  SUMMARY_HEADING: "NDA review summary",
  ESCALATIONS_HEADING: "Escalations",
  NO_ESCALATIONS: "None.",
  FINDINGS_HEADING: "Findings",
  UNDECIDED: "Undecided",
  APPLIED: "applied",
  APPLIED_EDITED: "applied as edited",
  NOT_APPLIED: "not applied",
  SKIPPED_OVERLAP: "not applied: overlaps the accepted redline for",
  SKIPPED_UNKNOWN_CLAUSE: "not applied: the target clause is not in the document",
} as const;

/** Copy for the Rule status panel and coverage bar. */
export const OVERVIEW_UI_TEXT = {
  RULES_HEADING: "Rules",
  RULE_PENDING: "Checking…",
  COVERAGE_HEADING: "Coverage",
  COVERAGE_PENDING: "Mapping clauses…",
  COVERAGE_UNAVAILABLE: "Coverage unavailable: clause mapping failed.",
  UNMAPPED_HEADING: "Unmapped clauses (not checked against any rule)",
} as const;

/** Minimap strip beside the Document (DESIGN "UI"). */
export const MINIMAP = {
  WIDTH_PX: 14,
  TICK_HEIGHT_PX: 4,
  /** Gap between the pinned cluster and the Document track. */
  PINNED_GAP_PX: 6,
} as const;

export const MINIMAP_UI_TEXT = {
  LABEL: "Minimap",
  NOT_IN_DOCUMENT: "Not in document",
  UNMAPPED: "Unmapped clause",
  BLOCKED: "blocked citation",
} as const;

/* ------------------------------------------------------------------------ */
/* Citation verification                                                     */
/* ------------------------------------------------------------------------ */

/** Minimum normalized quote length (or the whole Clause if shorter). */
export const MIN_QUOTE_CHARS = 20;
/** Quoted runs in model free text at least this long are verified. */
export const MIN_SANITIZED_QUOTE_CHARS = 20;
export const UNVERIFIED_QUOTE_PLACEHOLDER = "[unverified quote removed]";

/* ------------------------------------------------------------------------ */
/* Model calls                                                               */
/* ------------------------------------------------------------------------ */

/** Transient retries (timeouts, 408/409/429/5xx), handled by the Anthropic SDK. */
export const CALL_RETRIES = 1;
export const CALL_TIMEOUT_MS = 60_000;
/** Retries for invalid structured output, max_tokens stops and refusals. */
export const SCHEMA_RETRIES = 1;
/** Repair retries when a Citation fails verification. */
export const CITATION_RETRIES = 1;

export const EFFORT = {
  DETECTOR: "high",
  VERIFIER: "medium",
  MAP_CLAUSES: "low",
} as const;
export type Effort = ValueOf<typeof EFFORT>;

export const MAX_TOKENS = {
  DETECTOR: 16_000,
  VERIFIER: 8_000,
  MAP_CLAUSES: 4_000,
} as const;

/** Prompt guidance; the UI also clamps. */
export const EXPLANATION_MAX_SENTENCES = 2;
export const EXPLANATION_CLAMP_LINES = 3;

/* ------------------------------------------------------------------------ */
/* Graph                                                                     */
/* ------------------------------------------------------------------------ */

export const MAX_CONCURRENCY = 4;

/* ------------------------------------------------------------------------ */
/* Streaming                                                                 */
/* ------------------------------------------------------------------------ */

export const STREAM_EVENT = {
  CLAUSES: "clauses",
  FINDING: "finding",
  COVERAGE: "coverage",
  DONE: "done",
  /** Run failed after streaming started; carries a generic message only. */
  ERROR: "error",
} as const;
export type StreamEvent = ValueOf<typeof STREAM_EVENT>;

export const REVIEW_API_PATH = "/api/review";
export const NDJSON_CONTENT_TYPE = "application/x-ndjson";
/** Longest Document `POST /api/review` accepts, in UTF-16 code units (~50 pages). */
export const MAX_DOCUMENT_CHARS = 200_000;
/** Shown to the client when a run fails; details are logged server-side. */
export const REVIEW_FAILED_MESSAGE = "The review failed. Please try again.";

/** Client-side lifecycle of one review. Cancelling returns to IDLE. */
export const REVIEW_PHASE = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;
export type ReviewPhase = ValueOf<typeof REVIEW_PHASE>;

/**
 * Fixed locale for numbers in the UI. Server and browser must format
 * identically or hydration fails (e.g. en-IN renders 200000 as "2,00,000").
 */
export const UI_NUMBER_LOCALE = "en-US";

/** Copy for the review input and run status. */
export const REVIEW_UI_TEXT = {
  INPUT_LABEL: "NDA text",
  INPUT_PLACEHOLDER: "Paste the NDA here.",
  SUBMIT: "Review",
  LOAD_SAMPLE: "Load sample NDA",
  CANCEL: "Cancel",
  NEW_REVIEW: "New review",
  SEGMENTING: "Splitting the document into clauses…",
  RUNNING: "Reviewing",
  DONE: "Review complete",
  TOO_LONG: "The document is too long.",
  UNEXPECTED_ERROR: "Something went wrong while reading the review. Please try again.",
} as const;

/* ------------------------------------------------------------------------ */
/* Upload                                                                    */
/* ------------------------------------------------------------------------ */

/** File types the input accepts; text is extracted in the browser and lands in the input. */
export const UPLOAD_KIND = {
  DOCX: "DOCX",
  TXT: "TXT",
} as const;
export type UploadKind = ValueOf<typeof UPLOAD_KIND>;

/** Lower-case file extension → kind. `.doc` and PDF are deliberately absent. */
export const UPLOAD_EXTENSIONS: Readonly<Record<string, UploadKind>> = {
  ".docx": UPLOAD_KIND.DOCX,
  ".txt": UPLOAD_KIND.TXT,
};

/** `accept` attribute for the file picker (extensions plus MIME types). */
export const UPLOAD_ACCEPT = [
  ".docx",
  ".txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
].join(",");

/** Largest file read at all, before extraction. Text length is then capped by `MAX_DOCUMENT_CHARS`. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Copy for the file upload control. */
export const UPLOAD_UI_TEXT = {
  BUTTON: "Upload .docx or .txt",
  READING: "Reading file…",
  UNSUPPORTED: "Only .docx and .txt files are supported.",
  TOO_LARGE: `The file is larger than ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  EMPTY: "No text was found in the file.",
  FAILED: "The file couldn't be read. Check that it is a valid .docx or .txt file.",
} as const;

/* ------------------------------------------------------------------------ */
/* Review metrics                                                            */
/* ------------------------------------------------------------------------ */

/** Each decision's measured time is capped so idle time doesn't skew the average. */
export const IDLE_CAP_SECONDS = 60;

/** Tooltip on the avg-seconds counter explaining what is measured. */
export const DECISION_PACE_HELP = `Focus to decision, editing included; each capped at ${IDLE_CAP_SECONDS} s; latest decision per finding.`;

/* ------------------------------------------------------------------------ */
/* Eval                                                                      */
/* ------------------------------------------------------------------------ */

/** Labeled Documents, relative to the working directory (see `data/README.md`). */
export const EVAL_DATA_DIR = "data";
export const EVAL_DOCUMENT_SUFFIX = ".txt";
export const EVAL_LABELS_SUFFIX = ".labels.json";
/** Anchor Quotes must be at least this long (raw characters). */
export const MIN_ANCHOR_CHARS = 20;

export interface ModelPricing {
  /** USD per million input tokens. */
  readonly inputPerMTok: number;
  /** USD per million output tokens; thinking tokens bill as output. */
  readonly outputPerMTok: number;
}

/**
 * Standard (uncached, global) API prices by model ID, for the eval's cost
 * column. Haiku 5.5 uses its ≤100k-token-prompt tier, which every NDA fits.
 * Models not listed get no cost estimate.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-fable-5-2": { inputPerMTok: 8, outputPerMTok: 40 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5 },
};
