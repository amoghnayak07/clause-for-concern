import { APIConnectionTimeoutError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { MessageCreateParamsNonStreaming, TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import type { z } from "zod";
import { ERROR_KIND, SCHEMA_RETRIES, type Effort } from "@/common/constants";
import type { FindingError } from "@/features/review/finding";

/**
 * The one way the app talks to the model: a single-turn request with a
 * structured-output schema, validated with Zod.
 *
 * Retry layers (DESIGN "Retry layers"): transient HTTP failures are retried
 * inside the SDK; this helper retries invalid output, `max_tokens` /
 * context-window stops and refusals up to `SCHEMA_RETRIES` times. It never
 * throws, except `APIUserAbortError`, which must end the run silently.
 */

/** The subset of a Messages API response we read. The real `Message` satisfies it. */
export interface ModelResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly stop_reason: string | null;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly output_tokens_details?: { readonly thinking_tokens: number } | null;
  };
}

/** Seam over the Anthropic SDK so model calls can be faked in tests. */
export interface ModelClient {
  create(params: MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<ModelResponse>;
}

export interface TokenUsage {
  readonly input: number;
  /** Includes thinking tokens, as billed. */
  readonly output: number;
  readonly thinking: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, output: 0, thinking: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, thinking: a.thinking + b.thinking };
}

export interface ModelCallRequest<S extends z.ZodType> {
  readonly client: ModelClient;
  readonly model: string;
  readonly schema: S;
  readonly system?: string;
  /** The single user turn. Pass blocks to put the Document first (cache-ready). */
  readonly content: string | TextBlockParam[];
  readonly effort: Effort;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
}

interface CallMeta {
  /** Model requests made, including failed ones. */
  readonly calls: number;
  /** Summed across every request that returned a response. */
  readonly usage: TokenUsage;
}

export type ModelCallResult<T> =
  | (CallMeta & { readonly ok: true; readonly output: T })
  | (CallMeta & { readonly ok: false; readonly error: FindingError });

type AttemptOutcome<T> = { kind: "ok"; output: T } | { kind: "retryable"; error: FindingError };

export async function callModel<S extends z.ZodType>(request: ModelCallRequest<S>): Promise<ModelCallResult<z.infer<S>>> {
  const params: MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.maxTokens,
    ...(request.system ? { system: request.system } : {}),
    messages: [{ role: "user", content: request.content }],
    // Thinking is never stored or shown (DESIGN "Context discipline"), so skip returning it.
    thinking: { type: "adaptive", display: "omitted" },
    output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
  };

  let usage = ZERO_USAGE;
  let calls = 0;
  let lastError: FindingError = { kind: ERROR_KIND.INTERNAL, message: "Model was never called." };

  for (let attempt = 0; attempt <= SCHEMA_RETRIES; attempt++) {
    calls++;
    let response: ModelResponse;
    try {
      response = await request.client.create(params, { signal: request.signal });
    } catch (error) {
      if (error instanceof APIUserAbortError) throw error;
      return { ok: false, error: classifyThrown(error), calls, usage };
    }

    usage = addUsage(usage, usageOf(response));
    const outcome = readResponse(request.schema, response);
    if (outcome.kind === "ok") return { ok: true, output: outcome.output, calls, usage };
    lastError = outcome.error;
  }
  return { ok: false, error: lastError, calls, usage };
}

function usageOf(response: ModelResponse): TokenUsage {
  return {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    thinking: response.usage.output_tokens_details?.thinking_tokens ?? 0,
  };
}

function readResponse<S extends z.ZodType>(schema: S, response: ModelResponse): AttemptOutcome<z.infer<S>> {
  switch (response.stop_reason) {
    case "refusal":
      return { kind: "retryable", error: { kind: ERROR_KIND.REFUSAL, message: "The model declined to answer." } };
    case "max_tokens":
    case "model_context_window_exceeded":
      return {
        kind: "retryable",
        error: { kind: ERROR_KIND.SCHEMA, message: `Output was cut off (${response.stop_reason}).` },
      };
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "retryable", error: { kind: ERROR_KIND.SCHEMA, message: "Output was not valid JSON." } };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { kind: "retryable", error: { kind: ERROR_KIND.SCHEMA, message: `Output failed validation: ${issues}` } };
  }
  return { kind: "ok", output: parsed.data };
}

function classifyThrown(error: unknown): FindingError {
  if (error instanceof APIConnectionTimeoutError) {
    return { kind: ERROR_KIND.TIMEOUT, message: "The model request timed out." };
  }
  if (error instanceof APIError) {
    const status = error.status === undefined ? "" : ` (HTTP ${error.status})`;
    return { kind: ERROR_KIND.API, message: `Model API error${status}: ${error.message}` };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: ERROR_KIND.INTERNAL, message };
}
