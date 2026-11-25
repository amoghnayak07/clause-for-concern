import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { FINDING_STATUS } from "@/common/constants";
import { CitationRepairOutputSchema, DetectorOutputSchema, MapClausesOutputSchema, VerifierOutputSchema } from "./schemas";

const schemas = {
  detector: DetectorOutputSchema,
  citationRepair: CitationRepairOutputSchema,
  verifier: VerifierOutputSchema,
  mapClauses: MapClausesOutputSchema,
};

function propertyNames(node: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((child) => propertyNames(child, names));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && value && typeof value === "object") Object.keys(value).forEach((k) => names.add(k));
      propertyNames(value, names);
    }
  }
  return names;
}

describe.each(Object.entries(schemas))("%s output schema", (_name, schema) => {
  const format = zodOutputFormat(schema);

  it("converts to a structured-output JSON schema", () => {
    expect(format.type).toBe("json_schema");
    expect(format.schema).toMatchObject({ type: "object" });
  });

  it("never names a field 'reasoning'", () => {
    for (const name of propertyNames(format.schema)) expect(name.toLowerCase()).not.toContain("reasoning");
  });

  it("never lets the model report ERROR", () => {
    expect(JSON.stringify(format.schema)).not.toContain(`"${FINDING_STATUS.ERROR}"`);
  });
});

describe("DetectorOutputSchema", () => {
  it("accepts a RISK_FOUND with a REPLACE redline", () => {
    const output = {
      status: "RISK_FOUND",
      confidence: "HIGH",
      citations: [{ clauseId: "c-004", quote: "governed by the laws of New York" }],
      redline: { kind: "REPLACE", clauseId: "c-004", targetQuote: "New York", text: "Delaware" },
      explanation: "Governing law is New York.",
    };
    expect(DetectorOutputSchema.parse(output)).toEqual(output);
  });
});
