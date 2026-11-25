import { APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { MAX_CONCURRENCY, PLAYBOOK, RULE_ID, STREAM_EVENT, type RuleId } from "@/common/constants";
import { runReview, streamReview, type ReviewRunContext, type ReviewStreamChunk } from "./graph";
import { reply, routedClient, SAMPLE_NDA, type RoutedRequest } from "./testing";

const LAW_QUOTE = "This Agreement shall be governed by the laws of the State of New York.";

const governingLawRisk = {
  status: "RISK_FOUND",
  confidence: "HIGH",
  citations: [{ clauseId: "c-007", quote: LAW_QUOTE }],
  redline: null,
  explanation: "Governing law is New York.",
};
const nothingFound = { status: "NOT_FOUND", confidence: "HIGH", citations: [], redline: null, explanation: "None." };
const verdict = (status: string) => ({ status, confidence: "HIGH", newCitations: [], note: "Agreed." });

/** c-001..c-006 tagged (c-001 as irrelevant), an unknown ID, c-007 left to the GOVERNING_LAW citation, c-008 unmapped. */
const clauseMap = {
  clauses: [
    { clauseId: "c-001", ruleIds: [] },
    { clauseId: "c-002", ruleIds: ["MUTUAL"] },
    { clauseId: "c-003", ruleIds: ["CONFIDENTIALITY_CARVE_OUTS"] },
    { clauseId: "c-004", ruleIds: ["CONFIDENTIALITY_CARVE_OUTS"] },
    { clauseId: "c-005", ruleIds: ["CONFIDENTIALITY_CARVE_OUTS"] },
    { clauseId: "c-006", ruleIds: ["CONFIDENTIALITY_TERM"] },
    { clauseId: "c-999", ruleIds: ["MUTUAL"] },
  ],
};

type Override = (request: RoutedRequest) => ReturnType<typeof reply> | Error | undefined;

/** Answers every pass for every Rule; `override` replaces specific answers. */
function scriptedClient(override: Override = () => undefined) {
  let inFlight = 0;
  let maxInFlight = 0;
  const routed = routedClient((request) => {
    const custom = override(request);
    if (custom) return custom;
    if (request.pass === "MAP_CLAUSES") return reply(clauseMap);
    const isLaw = request.ruleId === RULE_ID.GOVERNING_LAW;
    if (request.pass === "VERIFY") return reply(verdict(isLaw ? "RISK_FOUND" : "NOT_FOUND"));
    return reply(isLaw ? governingLawRisk : nothingFound);
  });
  const client: ReviewRunContext["client"] = {
    async create(...args) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setImmediate(resolve));
        return await routed.client.create(...args);
      } finally {
        inFlight--;
      }
    },
  };
  return { client, seen: routed.seen, maxInFlight: () => maxInFlight };
}

const context = (client: ReviewRunContext["client"]): ReviewRunContext => ({ client, model: "test-model" });
const playbookOrder = PLAYBOOK.map((rule) => rule.id);

describe("review graph", () => {
  it("reviews every Rule once, in Playbook order, and computes Coverage", async () => {
    const { client, seen, maxInFlight } = scriptedClient();
    const result = await runReview(SAMPLE_NDA, context(client));

    expect(result.clauses).toHaveLength(8);
    expect(result.findings.map((f) => f.ruleId)).toEqual(playbookOrder);
    const law = result.findings.find((f) => f.ruleId === RULE_ID.GOVERNING_LAW);
    expect(law).toMatchObject({ status: "RISK_FOUND", citations: [{ clauseId: "c-007" }] });

    expect(result.coverage).toEqual({ available: true, covered: 7, total: 8, unmappedClauseIds: ["c-008"] });
    expect(result.usage.rules.map((r) => r.ruleId)).toEqual(playbookOrder);
    expect(result.usage.rules.every((r) => r.usage.DETECT.input === 1000)).toBe(true);
    expect(result.usage.mapClauses.input).toBe(1000);

    expect(seen.filter((r) => r.pass === "MAP_CLAUSES")).toHaveLength(1);
    for (const ruleId of playbookOrder) {
      expect(seen.filter((r) => r.pass === "DETECT" && r.ruleId === ruleId)).toHaveLength(1);
    }
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(maxInFlight()).toBeLessThanOrEqual(MAX_CONCURRENCY);
  });

  it("streams clauses first, one finding per Rule, then coverage", async () => {
    const { client } = scriptedClient();
    const chunks: ReviewStreamChunk[] = [];
    for await (const chunk of streamReview(SAMPLE_NDA, context(client))) chunks.push(chunk);

    expect(chunks[0]).toMatchObject({ event: STREAM_EVENT.CLAUSES });
    expect(chunks.at(-1)).toMatchObject({ event: STREAM_EVENT.COVERAGE, coverage: { available: true } });
    const findings = chunks.flatMap((c) => (c.event === STREAM_EVENT.FINDING ? [c.finding.ruleId] : []));
    expect([...findings].sort()).toEqual([...playbookOrder].sort());
    expect(chunks).toHaveLength(2 + playbookOrder.length);
  });

  it("turns one Rule's failure into an ERROR Finding without failing the run", async () => {
    const failing: RuleId = RULE_ID.MUTUAL;
    const { client } = scriptedClient((r) =>
      r.pass === "DETECT" && r.ruleId === failing ? new APIError(500, undefined, "boom", undefined) : undefined,
    );
    const result = await runReview(SAMPLE_NDA, context(client));

    expect(result.findings).toHaveLength(playbookOrder.length);
    expect(result.findings.find((f) => f.ruleId === failing)).toMatchObject({ status: "ERROR", error: { kind: "API" } });
    expect(result.findings.filter((f) => f.status === "ERROR")).toHaveLength(1);
  });

  it("reports Coverage as unavailable when mapClauses fails", async () => {
    const { client } = scriptedClient((r) =>
      r.pass === "MAP_CLAUSES" ? new APIError(500, undefined, "boom", undefined) : undefined,
    );
    const result = await runReview(SAMPLE_NDA, context(client));
    expect(result.coverage).toEqual({ available: false, total: 8 });
    expect(result.findings).toHaveLength(playbookOrder.length);
  });

  it("ends the run when the request is aborted", async () => {
    const controller = new AbortController();
    const { client, seen } = scriptedClient((r) => {
      if (r.pass === "DETECT") controller.abort();
      return undefined;
    });
    await expect(runReview(SAMPLE_NDA, context(client), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(seen.filter((r) => r.pass === "VERIFY")).toHaveLength(0);
  });
});
