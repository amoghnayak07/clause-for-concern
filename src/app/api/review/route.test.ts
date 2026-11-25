import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_DOCUMENT_CHARS, NDJSON_CONTENT_TYPE, REVIEW_FAILED_MESSAGE, STREAM_EVENT } from "@/common/constants";
import type { ReviewRunContext, ReviewStreamChunk } from "@/features/agent/graph";
import { sampleEvents } from "@/features/review/testing";

const mocks = vi.hoisted(() => ({
  streamReview: vi.fn<(text: string, context: ReviewRunContext, signal?: AbortSignal) => AsyncGenerator<ReviewStreamChunk>>(),
  getConfig: vi.fn(() => ({ anthropicApiKey: "test-key", reviewModel: "test-model" })),
}));

vi.mock("@/features/agent/graph", () => ({ streamReview: mocks.streamReview }));
vi.mock("@/config", () => ({ getConfig: mocks.getConfig }));

const { POST } = await import("./route");

const chunks = sampleEvents.filter((e): e is ReviewStreamChunk => e.event !== STREAM_EVENT.DONE);

function post(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal,
  });
}

async function lines(response: Response): Promise<unknown[]> {
  const text = await response.text();
  expect(text.endsWith("\n")).toBe(true);
  return text.trimEnd().split("\n").map((line) => JSON.parse(line) as unknown);
}

function abortError(): Error {
  return new DOMException("This operation was aborted", "AbortError");
}

beforeEach(() => {
  mocks.streamReview.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/review", () => {
  it("streams clauses → findings → coverage → done as NDJSON", async () => {
    mocks.streamReview.mockImplementation(async function* () {
      yield* chunks;
    });

    const response = await POST(post({ text: "1. Mutual." }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(NDJSON_CONTENT_TYPE);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await lines(response)).toEqual(sampleEvents);
    expect(mocks.streamReview).toHaveBeenCalledWith(
      "1. Mutual.",
      expect.objectContaining({ model: "test-model", client: expect.objectContaining({ create: expect.any(Function) }) }),
      expect.any(AbortSignal),
    );
  });

  it("ends with a generic error event when the run fails mid-stream", async () => {
    mocks.streamReview.mockImplementation(async function* () {
      yield chunks[0];
      throw new Error("secret upstream detail");
    });

    const response = await POST(post({ text: "1. Mutual." }));
    const events = await lines(response);

    expect(events).toEqual([chunks[0], { event: STREAM_EVENT.ERROR, message: REVIEW_FAILED_MESSAGE }]);
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(console.error).toHaveBeenCalled();
  });

  it("closes silently when the client aborts", async () => {
    const controller = new AbortController();
    mocks.streamReview.mockImplementation(async function* (_text, _context, signal) {
      yield chunks[0];
      await new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(abortError());
        signal?.addEventListener("abort", () => reject(abortError()));
      });
      yield chunks[1];
    });

    const response = await POST(post({ text: "1. Mutual." }, controller.signal));
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const first = await reader.read();
    controller.abort();
    let rest = "";
    for (let next = await reader.read(); !next.done; next = await reader.read()) rest += next.value;

    expect(JSON.parse(first.value!)).toEqual(chunks[0]);
    expect(rest).toBe("");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("stops the run when the response stream is cancelled", async () => {
    let finished = false;
    mocks.streamReview.mockImplementation(async function* () {
      try {
        yield* chunks;
      } finally {
        finished = true;
      }
    });

    const response = await POST(post({ text: "1. Mutual." }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    expect(finished).toBe(true);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a missing text", {}],
    ["an empty text", { text: "   " }],
    ["an oversized text", { text: "x".repeat(MAX_DOCUMENT_CHARS + 1) }],
  ])("returns 400 for %s without starting a run", async (_name, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(mocks.streamReview).not.toHaveBeenCalled();
  });

  it("returns 500 without details when the config is invalid", async () => {
    mocks.getConfig.mockImplementationOnce(() => {
      throw new Error("ANTHROPIC_API_KEY is missing");
    });

    const response = await POST(post({ text: "1. Mutual." }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("ANTHROPIC_API_KEY");
    expect(mocks.streamReview).not.toHaveBeenCalled();
  });
});
