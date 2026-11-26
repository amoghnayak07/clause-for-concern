import { INJECTION_CONTEXT_CHARS, INJECTION_PATTERNS } from "@/common/constants";

/**
 * Prompt-injection check (DESIGN "Input check"). Pure and deterministic so the
 * browser and `POST /api/review` give the same verdict. A match stops the
 * review before any model call; it is a guard in front of the prompt-level
 * notice and schema-bound outputs, not a replacement for them.
 */

export interface InjectionMatch {
  readonly patternId: string;
  readonly label: string;
  /** Offsets into the submitted text. */
  readonly start: number;
  readonly end: number;
  /** The matched passage with a little surrounding text, for the warning. */
  readonly excerpt: string;
}

const compiled = INJECTION_PATTERNS.map((pattern) => ({ ...pattern, regex: new RegExp(pattern.source, "gim") }));

/** Every match, in text order. Empty when the text looks clean. */
export function detectInjection(text: string): InjectionMatch[] {
  const matches: InjectionMatch[] = [];
  for (const { id, label, regex } of compiled) {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const start = match.index;
      const end = start + match[0].length;
      matches.push({ patternId: id, label, start, end, excerpt: excerptAround(text, start, end) });
    }
  }
  return matches.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function hasInjection(text: string): boolean {
  return compiled.some(({ regex }) => {
    regex.lastIndex = 0;
    return regex.test(text);
  });
}

function excerptAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - INJECTION_CONTEXT_CHARS);
  const to = Math.min(text.length, end + INJECTION_CONTEXT_CHARS);
  const body = text.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${body}${to < text.length ? "…" : ""}`;
}
