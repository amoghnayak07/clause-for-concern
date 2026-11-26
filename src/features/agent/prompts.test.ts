import { describe, expect, it } from "vitest";
import { DETECTOR_SYSTEM, MAP_CLAUSES_SYSTEM, UNTRUSTED_DOCUMENT_NOTICE, VERIFIER_SYSTEM } from "./prompts";

describe("system prompts", () => {
  it.each([
    ["detector (and citation repair)", DETECTOR_SYSTEM],
    ["verifier", VERIFIER_SYSTEM],
    ["mapClauses", MAP_CLAUSES_SYSTEM],
  ])("%s marks the Document as untrusted data", (_, system) => {
    expect(system).toContain(UNTRUSTED_DOCUMENT_NOTICE);
  });
});
