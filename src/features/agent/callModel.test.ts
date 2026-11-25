import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EFFORT, ERROR_KIND, SCHEMA_RETRIES } from "@/common/constants";
import { callModel, type ModelClient, type ModelResponse } from "./callModel";

const Schema = z.object({ answer: z.number() });

function response(text: string, overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    content: [{ type: "thinking" }, { type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } },
    ...overrides,
  };
}

/** Replays scripted responses (or throws scripted errors) and records requests. */
function fakeClient(script: Array<ModelResponse | Error>) {
  const requests: Parameters<ModelClient["create"]>[] = [];
  const client: ModelClient = {
    async create(...args) {
      requests.push(args);
      const next = script.shift();
      if (!next) throw new Error("fake client: no more scripted responses");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, requests };
}

const call = (client: ModelClient, signal?: AbortSignal) =>
  callModel({ client, model: "test-model", schema: Schema, content: "What is 2+2?", effort: EFFORT.DETECTOR, maxTokens: 1000, signal });

describe("callModel", () => {
  it("returns parsed output and usage from a single good response", async () => {
    const { client, requests } = fakeClient([response('{"answer":4}')]);
    const result = await call(client);
    expect(result).toEqual({ ok: true, output: { answer: 4 }, calls: 1, usage: { input: 100, output: 20, thinking: 5 } });
    expect(requests).toHaveLength(1);
  });

  it("sends a single-turn request with effort, token limit and a JSON schema format", async () => {
    const controller = new AbortController();
    const { client, requests } = fakeClient([response('{"answer":4}')]);
    await call(client, controller.signal);
    const [params, options] = requests[0]!;
    expect(params.model).toBe("test-model");
    expect(params.max_tokens).toBe(1000);
    expect(params.messages).toEqual([{ role: "user", content: "What is 2+2?" }]);
    expect(params.output_config?.effort).toBe(EFFORT.DETECTOR);
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(params).not.toHaveProperty("temperature");
    expect(options?.signal).toBe(controller.signal);
  });

  it.each([
    ["invalid JSON", response("{answer: 4")],
    ["a schema mismatch", response('{"answer":"four"}')],
    ["a max_tokens stop", response('{"ans', { stop_reason: "max_tokens" })],
    ["a refusal", response("", { stop_reason: "refusal" })],
  ])("retries after %s and succeeds", async (_label, bad) => {
    const { client } = fakeClient([bad, response('{"answer":4}')]);
    const result = await call(client);
    expect(result.ok).toBe(true);
    expect(result.calls).toBe(2);
    expect(result.usage).toEqual({ input: 200, output: 40, thinking: 10 });
  });

  it.each([
    ["invalid JSON", response("nope"), ERROR_KIND.SCHEMA],
    ["a refusal", response("", { stop_reason: "refusal" }), ERROR_KIND.REFUSAL],
  ])("gives up after SCHEMA_RETRIES on repeated %s", async (_label, bad, kind) => {
    const { client } = fakeClient(Array.from({ length: SCHEMA_RETRIES + 1 }, () => bad));
    const result = await call(client);
    expect(result.ok).toBe(false);
    expect(result.calls).toBe(SCHEMA_RETRIES + 1);
    if (!result.ok) expect(result.error.kind).toBe(kind);
  });

  it("does not leak model output text into the error message", async () => {
    const { client } = fakeClient([response('{"answer":"SECRET QUOTE"}'), response('{"answer":"SECRET QUOTE"}')]);
    const result = await call(client);
    expect(!result.ok && result.error.message).not.toContain("SECRET QUOTE");
  });

  it("reports API errors without a schema retry (the SDK already retried)", async () => {
    const { client, requests } = fakeClient([new APIError(529, undefined, "overloaded", undefined)]);
    const result = await call(client);
    expect(result).toMatchObject({ ok: false, calls: 1, error: { kind: ERROR_KIND.API } });
    expect(requests).toHaveLength(1);
  });

  it("reports timeouts as TIMEOUT", async () => {
    const { client } = fakeClient([new APIConnectionTimeoutError()]);
    expect(await call(client)).toMatchObject({ ok: false, error: { kind: ERROR_KIND.TIMEOUT } });
  });

  it("reports unexpected errors as INTERNAL", async () => {
    const { client } = fakeClient([new TypeError("bad")]);
    expect(await call(client)).toMatchObject({ ok: false, error: { kind: ERROR_KIND.INTERNAL, message: "bad" } });
  });

  it("rethrows user aborts so the run ends silently", async () => {
    const { client } = fakeClient([new APIUserAbortError()]);
    await expect(call(client)).rejects.toBeInstanceOf(APIUserAbortError);
  });
});
