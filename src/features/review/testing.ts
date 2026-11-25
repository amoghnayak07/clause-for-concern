import { RULE_ID, RULE_KIND, STREAM_EVENT } from "@/common/constants";
import type { Finding } from "./finding";
import type { ReviewEvent } from "./stream";

/** Test fixtures for the review stream. */

export const sampleFinding: Finding = {
  ruleId: RULE_ID.GOVERNING_LAW,
  ruleKind: RULE_KIND.REQUIRED,
  status: "RISK_FOUND",
  confidence: "HIGH",
  source: "MODEL",
  citations: [{ clauseId: "c-001", start: 0, end: 40 }],
  blockedCitations: [],
  redline: null,
  // Multi-byte characters exercise UTF-8 chunk splitting.
  explanation: "Governing law is New York — not Delaware. 日本語 ✓",
  verifierNote: null,
  error: null,
  attempts: 1,
};

export const sampleEvents: readonly ReviewEvent[] = [
  {
    event: STREAM_EVENT.CLAUSES,
    clauses: [{ id: "c-001", label: "A1", parentId: null, depth: 0, start: 0, end: 40 }],
  },
  { event: STREAM_EVENT.FINDING, finding: sampleFinding },
  { event: STREAM_EVENT.COVERAGE, coverage: { available: true, covered: 1, total: 1, unmappedClauseIds: [] } },
  { event: STREAM_EVENT.DONE },
];

/** A body that delivers `bytes` in the given chunk sizes (the last chunk takes the rest). */
export function chunkedBody(bytes: Uint8Array, sizes: readonly number[] = []): ReadableStream<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let at = 0;
  for (const size of sizes) {
    chunks.push(bytes.slice(at, at + size));
    at += size;
  }
  if (at < bytes.length) chunks.push(bytes.slice(at));
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
