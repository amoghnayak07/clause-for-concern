import { APIUserAbortError } from "@anthropic-ai/sdk";
import { NDJSON_CONTENT_TYPE, REVIEW_FAILED_MESSAGE, STREAM_EVENT } from "@/common/constants";
import { getConfig } from "@/config";
import { createModelClient } from "@/features/agent/client";
import { streamReview, type ReviewRunContext } from "@/features/agent/graph";
import {
  encodeReviewEvent,
  ReviewRequestSchema,
  type ReviewErrorBody,
  type ReviewEvent,
} from "@/features/review/stream";

/**
 * `POST /api/review` (DESIGN "Streaming"): validates `{ text }`, runs the
 * review graph and streams its events as NDJSON (contract in
 * `@/features/review/stream`).
 *
 * No segment config: Cache Components implies the Node.js runtime and forbids
 * `runtime`/`dynamic` exports, and POST handlers are never cached or
 * prerendered. `Cache-Control: no-store` keeps proxies from caching either.
 */

const STREAM_HEADERS = {
  "Content-Type": `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
  "Cache-Control": "no-store, no-transform",
  // Stop reverse proxies (nginx) from buffering the stream.
  "X-Accel-Buffering": "no",
} as const;

function errorResponse(status: number, error: string): Response {
  return Response.json({ error } satisfies ReviewErrorBody, { status, headers: { "Cache-Control": "no-store" } });
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Graph chunks, then `done`; or `error` on failure; nothing more once aborted. */
async function* reviewEvents(
  text: string,
  context: ReviewRunContext,
  signal: AbortSignal,
): AsyncGenerator<ReviewEvent> {
  try {
    for await (const chunk of streamReview(text, context, signal)) yield chunk;
  } catch (error) {
    if (isAbort(error, signal)) return;
    console.error("Review run failed:", error);
    yield { event: STREAM_EVENT.ERROR, message: REVIEW_FAILED_MESSAGE };
    return;
  }
  if (!signal.aborted) yield { event: STREAM_EVENT.DONE };
}

/** Pull-based so a slow client applies backpressure; cancel ends the generator. */
function toNdjsonStream(events: AsyncGenerator<ReviewEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await events.next();
      if (cancelled) return;
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(encodeReviewEvent(next.value)));
    },
    async cancel() {
      cancelled = true;
      await events.return(undefined);
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Request body must be JSON.");
  }
  const parsed = ReviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, parsed.error.issues.map((issue) => issue.message).join("; "));
  }

  let context: ReviewRunContext;
  try {
    const config = getConfig();
    context = { client: createModelClient(config), model: config.reviewModel };
  } catch (error) {
    console.error("Review route misconfigured:", error);
    return errorResponse(500, "The review service is not configured.");
  }

  const events = reviewEvents(parsed.data.text, context, request.signal);
  return new Response(toNdjsonStream(events), { headers: STREAM_HEADERS });
}
