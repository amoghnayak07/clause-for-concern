import type { RuleId } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import type { Finding } from "@/features/review/finding";
import type { ModelClient, ModelResponse } from "./callModel";
import { buildRuleReviewGraph } from "./graph";
import { MAP_CLAUSES_SYSTEM, VERIFIER_SYSTEM } from "./prompts";
import {
  createReviewDocument,
  initialRuleState,
  type ReviewDocument,
  type RuleReviewContext,
  type RuleReviewState,
} from "./state";

/** Test helpers for the per-rule steps. Not used by app code. */

export const SAMPLE_NDA = [
  "MUTUAL NONDISCLOSURE AGREEMENT",
  "",
  "1. Confidential Information. Each party may disclose Confidential Information to the other party.",
  "2. Exclusions. Confidential Information does not include information that:",
  "(a) is or becomes publicly available through no fault of the Recipient;",
  "(b) was already known to the Recipient.",
  "3. Term. The obligations of confidentiality shall survive for five (5) years after termination.",
  "4. Governing Law. This Agreement shall be governed by the laws of the State of New York.",
  "5. Non-Solicitation. Neither party shall solicit the employees of the other party.",
].join("\n");

export function sampleDocument(text = SAMPLE_NDA): ReviewDocument {
  return createReviewDocument(text, segmentDocument(text));
}

export function reply(output: unknown, overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 100, output_tokens_details: { thinking_tokens: 40 } },
    ...overrides,
  };
}

/** Replays scripted responses (or throws scripted errors) and records requests. */
export function fakeClient(script: Array<ModelResponse | Error>) {
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

/** Flattens a request's user content to one string for assertions. */
export function promptText(request: Parameters<ModelClient["create"]>): string {
  const content = request[0].messages[0]?.content ?? "";
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
}

/** Routes each request by pass and Rule, so concurrent calls can be answered out of order. */
export interface RoutedRequest {
  readonly pass: "DETECT" | "REPAIR" | "VERIFY" | "MAP_CLAUSES";
  /** Null for MAP_CLAUSES. */
  readonly ruleId: RuleId | null;
}

export function routedClient(answer: (request: RoutedRequest) => ModelResponse | Error) {
  const seen: RoutedRequest[] = [];
  const client: ModelClient = {
    async create(params) {
      const text = promptText([params]);
      const ruleId = (/<rule id="([A-Z_]+)"/.exec(text)?.[1] ?? null) as RuleId | null;
      const pass: RoutedRequest["pass"] =
        params.system === MAP_CLAUSES_SYSTEM
          ? "MAP_CLAUSES"
          : params.system === VERIFIER_SYSTEM
            ? "VERIFY"
            : text.includes("<failed item=")
              ? "REPAIR"
              : "DETECT";
      const request = { pass, ruleId: pass === "MAP_CLAUSES" ? null : ruleId };
      seen.push(request);
      const next = answer(request);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, seen };
}

/** Runs one Rule through the real per-rule subgraph. */
export async function runRule(
  ruleId: RuleId,
  context: RuleReviewContext,
): Promise<{ finding: Finding; state: RuleReviewState }> {
  const { document } = context;
  const output = await buildRuleReviewGraph().invoke(
    { ...initialRuleState(ruleId), text: document.text, clauses: document.clauses, finding: null },
    { context: { client: context.client, model: context.model }, signal: context.signal },
  );
  if (!output.finding) throw new Error("Subgraph emitted no Finding.");
  return { finding: output.finding, state: output };
}
