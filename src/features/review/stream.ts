import { z } from "zod";
import { MAX_DOCUMENT_CHARS, NDJSON_CONTENT_TYPE, REVIEW_API_PATH, STREAM_EVENT } from "@/common/constants";
// Type-only: erased at build time, so the graph never reaches the browser bundle.
import type { ReviewStreamChunk } from "@/features/agent/graph";
import type { Clause } from "@/features/document/types";
import type { Coverage } from "./coverage";
import { FindingSchema } from "./finding";

/**
 * Wire contract of `POST /api/review` (DESIGN "Streaming"), shared by the
 * route and the browser. Pure and isomorphic: no React, no Node APIs.
 *
 * Request: JSON `{ "text": string }`. Errors before streaming starts are a
 * non-2xx JSON `{ "error": string }`. Otherwise the body is NDJSON, one event
 * per line: `clauses` → `finding` (one per Rule) → `coverage` → `done`, or
 * `error` in place of whatever is left if the run fails. A client abort ends
 * the stream with no terminal event.
 */

/* ------------------------------------------------------------------------ */
/* Request                                                                   */
/* ------------------------------------------------------------------------ */

export const ReviewRequestSchema = z.object({
  text: z
    .string({ error: "text must be a string" })
    .max(MAX_DOCUMENT_CHARS, { error: `text must be at most ${MAX_DOCUMENT_CHARS} characters` })
    .refine((text) => text.trim().length > 0, { error: "text must not be empty" }),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

/** Body of every non-2xx response. */
export interface ReviewErrorBody {
  readonly error: string;
}

/* ------------------------------------------------------------------------ */
/* Events                                                                    */
/* ------------------------------------------------------------------------ */

/** The graph's stream chunks plus the route's own terminal events. */
export type ReviewEvent =
  | ReviewStreamChunk
  | { readonly event: typeof STREAM_EVENT.DONE }
  | { readonly event: typeof STREAM_EVENT.ERROR; readonly message: string };

const offset = z.int().nonnegative();

const ClauseSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  parentId: z.string().min(1).nullable(),
  depth: offset,
  start: offset,
  end: offset,
}) satisfies z.ZodType<Clause>;

const CoverageSchema = z.discriminatedUnion("available", [
  z.object({
    available: z.literal(true),
    covered: offset,
    total: offset,
    unmappedClauseIds: z.array(z.string().min(1)),
  }),
  z.object({ available: z.literal(false), total: offset }),
]) satisfies z.ZodType<Coverage>;

const ReviewEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal(STREAM_EVENT.CLAUSES), clauses: z.array(ClauseSchema) }),
  z.object({ event: z.literal(STREAM_EVENT.FINDING), finding: FindingSchema }),
  z.object({ event: z.literal(STREAM_EVENT.COVERAGE), coverage: CoverageSchema }),
  z.object({ event: z.literal(STREAM_EVENT.DONE) }),
  z.object({ event: z.literal(STREAM_EVENT.ERROR), message: z.string() }),
]) satisfies z.ZodType<ReviewEvent>;

const isTerminal = (event: ReviewEvent) => event.event === STREAM_EVENT.DONE || event.event === STREAM_EVENT.ERROR;

/** One NDJSON line, newline included. `JSON.stringify` never emits a raw newline. */
export function encodeReviewEvent(event: ReviewEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/* ------------------------------------------------------------------------ */
/* Decoding                                                                  */
/* ------------------------------------------------------------------------ */

/** The response broke the wire contract (bad line, or ended without `done`/`error`). */
export class ReviewStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewStreamError";
  }
}

/** The route refused the request (non-2xx); `message` is the server's. */
export class ReviewRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ReviewRequestError";
  }
}

function parseLine(line: string): ReviewEvent | null {
  if (line.trim() === "") return null;
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new ReviewStreamError(`Malformed review event (not JSON): ${line.slice(0, 80)}`);
  }
  const result = ReviewEventSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`);
    throw new ReviewStreamError(`Malformed review event: ${problems.join("; ")}`);
  }
  return result.data;
}

/**
 * Decodes an NDJSON review body. Lines and multi-byte characters may be split
 * across chunks; a final line without a newline is still read. Stops after
 * `done` or `error`. Throws `ReviewStreamError` on a malformed line or if the
 * body ends without a terminal event; read errors (e.g. `AbortError`) pass
 * through. Exiting early cancels the body.
 */
export async function* readReviewEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ReviewEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let drained = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const event = parseLine(line);
        if (!event) continue;
        yield event;
        if (isTerminal(event)) return;
      }
      if (done) {
        drained = true;
        break;
      }
    }
    throw new ReviewStreamError("Review stream ended before the review finished.");
  } finally {
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as Partial<ReviewErrorBody>;
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not our JSON error body; fall through.
  }
  return `Review request failed (HTTP ${response.status}).`;
}

/**
 * POSTs the Document to the review route and yields its events. Throws
 * `ReviewRequestError` on a non-2xx response; abort with `signal`.
 */
export async function* startReview(text: string, signal?: AbortSignal): AsyncGenerator<ReviewEvent> {
  const response = await fetch(REVIEW_API_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: NDJSON_CONTENT_TYPE },
    body: JSON.stringify({ text } satisfies ReviewRequest),
    signal,
  });
  if (!response.ok) throw new ReviewRequestError(await errorMessage(response), response.status);
  if (!response.body) throw new ReviewStreamError("Review response has no body.");
  yield* readReviewEvents(response.body);
}
