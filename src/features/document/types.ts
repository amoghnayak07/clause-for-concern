/** Positional, deterministic Clause ID such as "c-001". */
export type ClauseId = string;

/**
 * A segment of the Document. `start`/`end` are offsets into the untouched
 * Document text (end exclusive), trimmed of surrounding whitespace.
 *
 * A Parent Clause's span covers only its own intro text, up to its first child.
 */
export interface Clause {
  readonly id: ClauseId;
  /** Human label, e.g. "A3.2(a)" for numbered Clauses or "P2" for paragraphs. */
  readonly label: string;
  readonly parentId: ClauseId | null;
  /** 0 for top-level Clauses. */
  readonly depth: number;
  readonly start: number;
  readonly end: number;
}
