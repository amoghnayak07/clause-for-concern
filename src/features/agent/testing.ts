import type { RuleId } from "@/common/constants";
import { segmentDocument } from "@/features/document/segment";
import type { Finding } from "@/features/review/finding";
import type { ModelClient, ModelResponse } from "./callModel";
import { detectRule } from "./detector";
import { emitFinding } from "./emit";
import {
  createReviewDocument,
  initialRuleState,
  type ReviewDocument,
  type RuleReviewContext,
  type RuleReviewState,
  type RuleReviewUpdate,
} from "./state";
import { verifyFinding } from "./verifier";
import { AFTER_VERIFY_CITATIONS, routeAfterVerifyCitations, verifyCitations } from "./verifyCitations";

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

/**
 * Runs the per-rule steps in graph order (detect → verifyCitations → repair
 * loop → verifyFinding → emit), mirroring the subgraph wiring.
 */
export async function runRule(
  ruleId: RuleId,
  context: RuleReviewContext,
): Promise<{ finding: Finding; state: RuleReviewState }> {
  let state = initialRuleState(ruleId);
  const apply = (update: RuleReviewUpdate) => (state = { ...state, ...update });

  apply(await detectRule(state, context));
  for (;;) {
    apply(verifyCitations(state, context));
    const next = routeAfterVerifyCitations(state);
    if (next === AFTER_VERIFY_CITATIONS.REPAIR) {
      apply(await detectRule(state, context));
      continue;
    }
    if (next === AFTER_VERIFY_CITATIONS.VERIFY_FINDING) apply(await verifyFinding(state, context));
    break;
  }
  return { finding: emitFinding(state, context), state };
}
