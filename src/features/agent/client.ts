import Anthropic from "@anthropic-ai/sdk";
import { CALL_RETRIES, CALL_TIMEOUT_MS } from "@/common/constants";
import type { AppConfig } from "@/config";
import type { ModelClient } from "./callModel";

/**
 * The real Anthropic client. Transient failures (timeouts, 408/409/429/5xx,
 * connection errors) are retried by the SDK itself; `callModel` only retries
 * bad output.
 */
export function createModelClient(config: Pick<AppConfig, "anthropicApiKey">): ModelClient {
  const anthropic = new Anthropic({
    apiKey: config.anthropicApiKey,
    maxRetries: CALL_RETRIES,
    timeout: CALL_TIMEOUT_MS,
  });
  return { create: (params, options) => anthropic.messages.create(params, options) };
}
