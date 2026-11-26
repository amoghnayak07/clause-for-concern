import { APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_REASON,
  CITATION_RETRIES,
  EFFORT,
  ERROR_KIND,
  RULE_ID,
  UNVERIFIED_QUOTE_PLACEHOLDER,
} from "@/common/constants";
import { recommendedAction } from "@/features/review/derive";
import { VERIFIER_UNAVAILABLE_NOTE } from "./verifier";
import { fakeClient, promptText, reply, runRule, sampleDocument, SAMPLE_NDA } from "./testing";
import type { RuleReviewContext } from "./state";

const document = sampleDocument();
const context = (client: RuleReviewContext["client"], doc = document): RuleReviewContext => ({
  client,
  model: "test-model",
  document: doc,
});
const slice = (start: number, end: number, text = SAMPLE_NDA) => text.slice(start, end);

const LAW_QUOTE = "This Agreement shall be governed by the laws of the State of New York.";
const LAW_TARGET = "the laws of the State of New York";
const TERM_QUOTE = "shall survive for five (5) years after termination";

const governingLawRisk = (overrides: Record<string, unknown> = {}) => ({
  status: "RISK_FOUND",
  confidence: "HIGH",
  citations: [{ clauseId: "c-007", quote: LAW_QUOTE }],
  redline: { kind: "REPLACE", clauseId: "c-007", targetQuote: LAW_TARGET, text: "the laws of the State of Delaware" },
  explanation: "Governing law is New York, which is not Delaware or California.",
  ...overrides,
});
const verdict = (status: string, overrides: Record<string, unknown> = {}) => ({
  status,
  confidence: "HIGH",
  newCitations: [],
  note: "The cited clause supports the finding.",
  ...overrides,
});

describe("sample document", () => {
  it("segments into the Clause IDs these tests rely on", () => {
    expect(document.clauses.map((c) => `${c.id}:${c.label}`)).toEqual([
      "c-001:P1",
      "c-002:§1",
      "c-003:§2",
      "c-004:§2(a)",
      "c-005:§2(b)",
      "c-006:§3",
      "c-007:§4",
      "c-008:§5",
    ]);
  });
});

describe("per-rule review", () => {
  it("verifies citations and the Redline target, then keeps an agreeing verifier's Finding", async () => {
    const { client, requests } = fakeClient([reply(governingLawRisk()), reply(verdict("RISK_FOUND"))]);
    const { finding, state } = await runRule(RULE_ID.GOVERNING_LAW, context(client));

    expect(finding).toMatchObject({ status: "RISK_FOUND", confidence: "HIGH", source: "MODEL", attempts: 1, error: null });
    expect(finding.citations).toHaveLength(1);
    expect(slice(finding.citations[0].start, finding.citations[0].end)).toBe(LAW_QUOTE);
    expect(finding.redline).toMatchObject({ kind: "REPLACE", clauseId: "c-007", replacement: "the laws of the State of Delaware" });
    if (finding.redline?.kind === "REPLACE") expect(slice(finding.redline.start, finding.redline.end)).toBe(LAW_TARGET);
    expect(finding.verifierNote).toBe("The cited clause supports the finding.");
    expect(recommendedAction(finding)).toBe("FIX");

    expect(requests).toHaveLength(2);
    expect(requests[0][0].output_config?.effort).toBe(EFFORT.DETECTOR);
    expect(requests[1][0].output_config?.effort).toBe(EFFORT.VERIFIER);
    expect(state.firstPassCitations).toEqual({ proposed: 1, verified: 1 });
    expect(state.usage.DETECT.input).toBe(1000);
    expect(state.usage.VERIFY.input).toBe(1000);
    expect(state.usage.REPAIR.input).toBe(0);
  });

  it("puts the Document first and the Rule after, as <clause> elements", async () => {
    const { client, requests } = fakeClient([reply(governingLawRisk()), reply(verdict("RISK_FOUND"))]);
    await runRule(RULE_ID.GOVERNING_LAW, context(client));
    const content = requests[0][0].messages[0].content;
    expect(Array.isArray(content) && content[0].type === "text" && content[0].text).toMatch(/^<document>\n<clause id="c-001" label="P1">/);
    expect(promptText(requests[0])).toContain('<clause id="c-004" label="§2(a)" parent="c-003">');
    expect(promptText(requests[0])).toContain('<rule id="GOVERNING_LAW"');
  });

  it("repairs a failed quote with only the cited Clause as context", async () => {
    const bad = "governed by the laws of New York State";
    const { client, requests } = fakeClient([
      reply(governingLawRisk({ citations: [{ clauseId: "c-007", quote: bad }] })),
      reply({ repairs: [{ item: 1, clauseId: "c-007", quote: LAW_QUOTE }], redlineTarget: null }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding, state } = await runRule(RULE_ID.GOVERNING_LAW, context(client));

    expect(finding.attempts).toBe(2);
    expect(finding.citations.map((c) => slice(c.start, c.end))).toEqual([LAW_QUOTE]);
    expect(finding.blockedCitations).toEqual([]);
    expect(state.firstPassCitations).toEqual({ proposed: 1, verified: 0 });

    const repairPrompt = promptText(requests[1]);
    expect(repairPrompt).toContain(bad);
    expect(repairPrompt).toContain("the text does not appear in that Clause");
    expect(repairPrompt).toContain('<clause id="c-007"');
    expect(repairPrompt).not.toContain('<clause id="c-002"');
    expect(repairPrompt).not.toContain("<document>");
  });

  it("re-asks only failed quotes and keeps verified ones", async () => {
    const { client, requests } = fakeClient([
      reply(
        governingLawRisk({
          citations: [
            { clauseId: "c-007", quote: LAW_QUOTE },
            { clauseId: "c-006", quote: "governed by the laws of the State of New York" },
          ],
        }),
      ),
      reply({ repairs: [{ item: 1, clauseId: "c-007", quote: "governed by the laws of the State of New York" }], redlineTarget: null }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));

    const repairPrompt = promptText(requests[1]);
    expect(repairPrompt).toContain("appears in a different Clause");
    expect(repairPrompt).not.toContain(`<quote>${LAW_QUOTE}</quote>`);
    expect(finding.citations).toHaveLength(2);
    expect(finding.blockedCitations).toEqual([]);
  });

  it(`blocks a quote that still fails after ${CITATION_RETRIES} repair, without keeping its text`, async () => {
    const bad = "governed by the laws of New York State";
    const { client, requests } = fakeClient([
      reply(governingLawRisk({ citations: [{ clauseId: "c-007", quote: bad }] })),
      reply({ repairs: [{ item: 1, clauseId: "c-007", quote: "governed by New York law entirely" }], redlineTarget: null }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));

    expect(requests).toHaveLength(3);
    expect(finding.attempts).toBe(1 + CITATION_RETRIES);
    expect(finding.citations).toEqual([]);
    expect(finding.blockedCitations).toEqual([{ clauseId: "c-007", reason: BLOCKED_REASON.NOT_IN_CLAUSE }]);
    expect(JSON.stringify(finding)).not.toContain("New York law entirely");
    // The Redline target verified but its Clause isn't cited, so it can't stand.
    expect(finding.redline).toBeNull();
    expect(recommendedAction(finding)).toBe("ESCALATE");
  });

  it("sends the whole Document to repair when a Clause ID was unknown", async () => {
    const { client, requests } = fakeClient([
      reply(governingLawRisk({ citations: [{ clauseId: "c-999", quote: LAW_QUOTE }] })),
      reply({ repairs: [{ item: 1, clauseId: "c-007", quote: LAW_QUOTE }], redlineTarget: null }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(promptText(requests[1])).toContain("<document>");
    expect(finding.citations).toHaveLength(1);
  });

  it("repairs a Redline target within the same budget", async () => {
    const { client } = fakeClient([
      reply(governingLawRisk({ redline: { kind: "REPLACE", clauseId: "c-007", targetQuote: "laws of NY state", text: "x" } })),
      reply({ repairs: [], redlineTarget: { targetQuote: LAW_TARGET, text: "the laws of the State of Delaware" } }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding.attempts).toBe(2);
    expect(finding.blockedCitations).toEqual([]);
    expect(finding.redline).toMatchObject({ kind: "REPLACE", replacement: "the laws of the State of Delaware" });
  });

  it("drops a Redline whose target never verifies, leaving RISK_FOUND to escalate", async () => {
    const { client } = fakeClient([
      reply(governingLawRisk({ redline: { kind: "REPLACE", clauseId: "c-007", targetQuote: "laws of NY state", text: "x" } })),
      reply({ repairs: [], redlineTarget: null }),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding.redline).toBeNull();
    expect(finding.blockedCitations).toEqual([]);
    expect(recommendedAction(finding)).toBe("ESCALATE");
  });

  it("raises a Possible Miss when the model finds nothing but a Trigger Term occurs", async () => {
    const { client, requests } = fakeClient([
      reply({ status: "COMPLIANT", confidence: "HIGH", citations: [], redline: null, explanation: "No non-solicit." }),
      reply(verdict("COMPLIANT", { note: "§5 restricts soliciting employees." })),
    ]);
    const { finding } = await runRule(RULE_ID.NO_NON_SOLICIT, context(client));

    expect(finding).toMatchObject({ status: "RISK_FOUND", confidence: "LOW", source: "TRIGGER_TERM", citations: [] });
    expect(finding.explanation).toContain('§5 ("solicit")');
    expect(finding.verifierNote).toBe("§5 restricts soliciting employees.");
    expect(recommendedAction(finding)).toBe("ESCALATE");
    const verifierPrompt = promptText(requests[1]);
    expect(verifierPrompt).toContain("<excerpt>");
    expect(verifierPrompt).toContain('<clause id="c-008"');
    expect(verifierPrompt).toContain("Trigger Terms occur");
  });

  it("keeps a clean PROHIBITED COMPLIANT and shows the verifier the whole Document", async () => {
    const { client, requests } = fakeClient([
      reply({ status: "NOT_FOUND", confidence: "HIGH", citations: [{ clauseId: "c-002", quote: "Each party may disclose" }], redline: null, explanation: "None." }),
      reply(verdict("COMPLIANT", { note: "No residuals right." })),
    ]);
    const { finding } = await runRule(RULE_ID.NO_RESIDUALS, context(client));
    expect(finding).toMatchObject({ status: "COMPLIANT", confidence: "HIGH", source: "MODEL", citations: [], blockedCitations: [] });
    expect(promptText(requests[1])).toContain("<document>");
  });

  it("lets the verifier upgrade COMPLIANT to RISK_FOUND with verified new citations", async () => {
    const { client } = fakeClient([
      reply({ status: "COMPLIANT", confidence: "HIGH", citations: [{ clauseId: "c-006", quote: "The obligations of confidentiality" }], redline: null, explanation: "Two years." }),
      reply(verdict("RISK_FOUND", { newCitations: [{ clauseId: "c-006", quote: TERM_QUOTE }, { clauseId: "c-006", quote: "survive for ten years" }], note: "Survival is five years." })),
    ]);
    const { finding } = await runRule(RULE_ID.CONFIDENTIALITY_TERM, context(client));

    expect(finding).toMatchObject({ status: "RISK_FOUND", confidence: "LOW", explanation: "Survival is five years." });
    expect(finding.verifierNote).toContain("Upgraded from COMPLIANT");
    expect(finding.citations.map((c) => slice(c.start, c.end))).toEqual(["The obligations of confidentiality", TERM_QUOTE]);
    expect(finding.blockedCitations).toEqual([{ clauseId: "c-006", reason: BLOCKED_REASON.NOT_IN_CLAUSE }]);
    expect(finding.attempts).toBe(1);
  });

  it("never relaxes: a verifier saying COMPLIANT only lowers confidence", async () => {
    const { client } = fakeClient([reply(governingLawRisk()), reply(verdict("COMPLIANT", { note: "Looks fine." }))]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding).toMatchObject({ status: "RISK_FOUND", confidence: "LOW", verifierNote: "Looks fine." });
    expect(finding.redline).not.toBeNull();
  });

  it("keeps the detector Finding at LOW confidence when the verifier is unavailable", async () => {
    const { client } = fakeClient([reply(governingLawRisk()), new APIError(500, undefined, "boom", undefined)]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding).toMatchObject({ status: "RISK_FOUND", confidence: "LOW", verifierNote: VERIFIER_UNAVAILABLE_NOTE });
    expect(finding.citations).toHaveLength(1);
  });

  it("emits an ERROR Finding when the detector fails, skipping the verifier", async () => {
    const { client, requests } = fakeClient([new APIError(500, undefined, "boom", undefined)]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding).toMatchObject({ status: "ERROR", error: { kind: ERROR_KIND.API }, attempts: 1 });
    expect(requests).toHaveLength(1);
  });

  it("rethrows user aborts so the run ends silently", async () => {
    const { client } = fakeClient([new APIUserAbortError()]);
    await expect(runRule(RULE_ID.GOVERNING_LAW, context(client))).rejects.toBeInstanceOf(APIUserAbortError);
  });

  it("replaces unverified quotes in free text", async () => {
    const { client } = fakeClient([
      reply(governingLawRisk({ explanation: 'It says "governed by the laws of the State of New York" and "the laws of Ruritania shall apply".' })),
      reply(verdict("RISK_FOUND")),
    ]);
    const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client));
    expect(finding.explanation).toBe(
      `It says "governed by the laws of the State of New York" and ${UNVERIFIED_QUOTE_PLACEHOLDER}.`,
    );
  });

  describe("NOT_FOUND with an INSERT Redline", () => {
    const text = "1. Confidential Information. Each party may disclose information.\n2. Return. Each party returns materials.";
    const doc = sampleDocument(text);
    const notFound = (afterClauseId: string | null) => ({
      status: "NOT_FOUND",
      confidence: "HIGH",
      citations: [],
      redline: { kind: "INSERT", clauseId: afterClauseId, targetQuote: null, text: "This Agreement is governed by Delaware law." },
      explanation: "No governing law clause.",
    });

    it("keeps an INSERT after a real Clause", async () => {
      const { client } = fakeClient([reply(notFound("c-002")), reply(verdict("NOT_FOUND"))]);
      const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client, doc));
      expect(finding).toMatchObject({ status: "NOT_FOUND", redline: { kind: "INSERT", afterClauseId: "c-002" } });
      expect(recommendedAction(finding)).toBe("ESCALATE");
    });

    it("drops an INSERT after an unknown Clause", async () => {
      const { client } = fakeClient([reply(notFound("c-042")), reply(verdict("NOT_FOUND"))]);
      const { finding } = await runRule(RULE_ID.GOVERNING_LAW, context(client, doc));
      expect(finding.redline).toBeNull();
    });
  });
});
