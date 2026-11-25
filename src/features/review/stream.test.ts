import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_CHARS, REVIEW_API_PATH, STREAM_EVENT } from "@/common/constants";
import {
  encodeReviewEvent,
  readReviewEvents,
  ReviewRequestError,
  ReviewRequestSchema,
  ReviewStreamError,
  startReview,
  type ReviewEvent,
} from "./stream";
import { chunkedBody, collect, sampleEvents, sampleFinding } from "./testing";

const encoder = new TextEncoder();
const encodeAll = (events: readonly ReviewEvent[]) => encoder.encode(events.map(encodeReviewEvent).join(""));
const bodyOf = (text: string, sizes?: number[]) => chunkedBody(encoder.encode(text), sizes);

describe("encodeReviewEvent", () => {
  it("writes exactly one line, even when a value contains newlines", () => {
    const line = encodeReviewEvent({
      event: STREAM_EVENT.FINDING,
      finding: { ...sampleFinding, explanation: "one\ntwo\r\nthree" },
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toMatch(/[\r\n]/);
  });
});

describe("readReviewEvents", () => {
  it("round-trips every event", async () => {
    expect(await collect(readReviewEvents(chunkedBody(encodeAll(sampleEvents))))).toEqual(sampleEvents);
  });

  it("handles lines and multi-byte characters split across chunks", async () => {
    const bytes = encodeAll(sampleEvents);
    // One byte per chunk splits every line and every multi-byte code point.
    const events = await collect(readReviewEvents(chunkedBody(bytes, Array.from(bytes, () => 1))));
    expect(events).toEqual(sampleEvents);
  });

  it("reads a final line with no trailing newline", async () => {
    const text = sampleEvents.map(encodeReviewEvent).join("").trimEnd();
    expect(await collect(readReviewEvents(bodyOf(text, [7, 30])))).toEqual(sampleEvents);
  });

  it("skips blank lines", async () => {
    const text = `\n${encodeReviewEvent({ event: STREAM_EVENT.DONE })}\n`;
    expect(await collect(readReviewEvents(bodyOf(`\n${text}`)))).toEqual([{ event: STREAM_EVENT.DONE }]);
  });

  it("yields an error event and stops", async () => {
    const error: ReviewEvent = { event: STREAM_EVENT.ERROR, message: "boom" };
    const text = encodeReviewEvent(sampleEvents[0]) + encodeReviewEvent(error) + "not json\n";
    expect(await collect(readReviewEvents(bodyOf(text)))).toEqual([sampleEvents[0], error]);
  });

  it("ignores and cancels anything after done", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeReviewEvent({ event: STREAM_EVENT.DONE }) + "garbage\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(await collect(readReviewEvents(body))).toEqual([{ event: STREAM_EVENT.DONE }]);
    expect(cancelled).toBe(true);
  });

  it.each([
    ["a line that is not JSON", "{oops\n"],
    ["an unknown event", `${JSON.stringify({ event: "progress" })}\n`],
    ["a missing event field", `${JSON.stringify({ clauses: [] })}\n`],
    ["an event with a bad payload", `${JSON.stringify({ event: STREAM_EVENT.CLAUSES, clauses: [{ id: 1 }] })}\n`],
    [
      "a Finding that breaks a domain invariant",
      `${JSON.stringify({ event: STREAM_EVENT.FINDING, finding: { ...sampleFinding, status: "ERROR" } })}\n`,
    ],
  ])("throws ReviewStreamError on %s", async (_name, text) => {
    await expect(collect(readReviewEvents(bodyOf(text)))).rejects.toBeInstanceOf(ReviewStreamError);
  });

  it("yields events before a malformed line, then throws", async () => {
    const seen: ReviewEvent[] = [];
    const read = async () => {
      for await (const event of readReviewEvents(bodyOf(`${encodeReviewEvent(sampleEvents[0])}{oops\n`))) seen.push(event);
    };
    await expect(read()).rejects.toBeInstanceOf(ReviewStreamError);
    expect(seen).toEqual([sampleEvents[0]]);
  });

  it("throws when the body ends without done or error", async () => {
    const text = sampleEvents.slice(0, 2).map(encodeReviewEvent).join("");
    await expect(collect(readReviewEvents(bodyOf(text)))).rejects.toThrow(/ended before the review finished/);
  });

  it("cancels the body when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(encodeReviewEvent(sampleEvents[0])));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const event of readReviewEvents(body)) {
      expect(event.event).toBe(STREAM_EVENT.CLAUSES);
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("ReviewRequestSchema", () => {
  it.each([
    ["a missing text", {}],
    ["a non-string text", { text: 42 }],
    ["an empty text", { text: "" }],
    ["a whitespace-only text", { text: " \n\t " }],
    ["an oversized text", { text: "x".repeat(MAX_DOCUMENT_CHARS + 1) }],
  ])("rejects %s", (_name, body) => {
    expect(ReviewRequestSchema.safeParse(body).success).toBe(false);
  });

  it("keeps the text untouched", () => {
    expect(ReviewRequestSchema.parse({ text: "  1. Mutual.\n" })).toEqual({ text: "  1. Mutual.\n" });
  });
});

describe("startReview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the text and yields the decoded events", async () => {
    const fetchMock = vi.fn(async () => new Response(chunkedBody(encodeAll(sampleEvents), [5])));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    expect(await collect(startReview("NDA text", signal))).toEqual(sampleEvents);
    expect(fetchMock).toHaveBeenCalledWith(
      REVIEW_API_PATH,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "NDA text" }), signal }),
    );
  });

  it("throws the server's message on a non-2xx response", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "text must not be empty" }, { status: 400 }));
    const error = await collect(startReview("")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReviewRequestError);
    expect(error).toMatchObject({ message: "text must not be empty", status: 400 });
  });

  it("falls back to a generic message when the error body isn't ours", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(collect(startReview("x"))).rejects.toThrow("Review request failed (HTTP 502).");
  });
});
