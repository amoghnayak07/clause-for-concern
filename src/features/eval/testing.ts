import { SAMPLE_NDA } from "@/features/agent/testing";

/** Test fixtures for the eval. Not used by app code. */

/** A label file that is valid for `SAMPLE_NDA`. */
export function sampleLabelFile(document = "sample.txt") {
  return {
    document,
    labels: {
      MUTUAL: { expected: "COMPLIANT", anchor: "Each party may disclose Confidential Information" },
      GOVERNING_LAW: { expected: "RISK_FOUND", anchor: "governed by the laws of the State of New York" },
      CONFIDENTIALITY_TERM: { expected: "RISK_FOUND", anchor: "shall survive for five (5) years" },
      NO_NON_SOLICIT: { expected: "RISK_FOUND", anchor: "Neither party shall solicit the employees" },
      NO_RESIDUALS: { expected: "COMPLIANT", anchor: null },
      CONFIDENTIALITY_CARVE_OUTS: { expected: "RISK_FOUND", anchor: "is or becomes publicly available" },
    },
    notes: "Fixture.",
  };
}

export { SAMPLE_NDA };
