import { describe, expect, it } from "vitest";
import { validateLabels } from "./labels";
import { SAMPLE_NDA, sampleLabelFile } from "./testing";

type LabelFile = ReturnType<typeof sampleLabelFile>;
type RuleKey = keyof LabelFile["labels"];

function withLabel(rule: RuleKey, label: { expected: string; anchor: string | null }) {
  const file = sampleLabelFile();
  return { ...file, labels: { ...file.labels, [rule]: label } };
}

const problemsOf = (json: unknown, name = "sample.txt") => {
  const result = validateLabels(name, SAMPLE_NDA, json);
  return result.ok ? [] : result.problems;
};

describe("validateLabels", () => {
  it("accepts a valid label file", () => {
    const result = validateLabels("sample.txt", SAMPLE_NDA, sampleLabelFile());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.name).toBe("sample.txt");
      expect(result.document.labels.GOVERNING_LAW.expected).toBe("RISK_FOUND");
    }
  });

  it("requires all six Rule IDs and rejects unknown ones", () => {
    const file = sampleLabelFile();
    const rest: Partial<LabelFile["labels"]> = { ...file.labels };
    delete rest.NO_RESIDUALS;
    expect(problemsOf({ ...file, labels: rest })).toEqual([expect.stringContaining("labels.NO_RESIDUALS")]);
    expect(problemsOf({ ...file, labels: { ...file.labels, NON_COMPETE: file.labels.NO_RESIDUALS } })).toEqual([
      expect.stringMatching(/NON_COMPETE/),
    ]);
  });

  it("rejects statuses that are not labels (ERROR) and malformed files", () => {
    expect(problemsOf(withLabel("MUTUAL", { expected: "ERROR", anchor: null }))).toEqual([
      expect.stringContaining("labels.MUTUAL.expected"),
    ]);
    expect(problemsOf(null)).not.toHaveLength(0);
  });

  it("requires the document field to match the file name", () => {
    expect(problemsOf(sampleLabelFile(), "other.txt")).toEqual([expect.stringContaining('names "sample.txt"')]);
  });

  it("rejects NOT_FOUND on a PROHIBITED Rule", () => {
    expect(problemsOf(withLabel("NO_RESIDUALS", { expected: "NOT_FOUND", anchor: null }))).toEqual([
      expect.stringContaining("NOT_FOUND is only valid on REQUIRED"),
    ]);
  });

  it("requires a null anchor exactly when no clause can be pointed to", () => {
    expect(problemsOf(withLabel("GOVERNING_LAW", { expected: "NOT_FOUND", anchor: "governed by the laws of the State" }))).toEqual([
      expect.stringContaining("anchor must be null"),
    ]);
    expect(problemsOf(withLabel("NO_RESIDUALS", { expected: "COMPLIANT", anchor: "Neither party shall solicit the employees" }))).toEqual([
      expect.stringContaining("anchor must be null"),
    ]);
    expect(problemsOf(withLabel("MUTUAL", { expected: "COMPLIANT", anchor: null }))).toEqual([
      expect.stringContaining("anchor is required"),
    ]);
    expect(problemsOf(withLabel("NO_NON_SOLICIT", { expected: "RISK_FOUND", anchor: null }))).toEqual([
      expect.stringContaining("anchor is required"),
    ]);
  });

  it("requires anchors to be exact substrings of at least 20 characters", () => {
    expect(problemsOf(withLabel("GOVERNING_LAW", { expected: "RISK_FOUND", anchor: "New York." }))).toEqual([
      expect.stringContaining("minimum is 20"),
    ]);
    // Case and whitespace matter: anchors are copied straight out of the .txt.
    expect(problemsOf(withLabel("GOVERNING_LAW", { expected: "RISK_FOUND", anchor: "governed by the laws of the state of New York" }))).toEqual([
      expect.stringContaining("not an exact substring"),
    ]);
  });

  it("reports every problem, not just the first", () => {
    const file = sampleLabelFile("wrong.txt");
    const labels = {
      ...file.labels,
      MUTUAL: { expected: "COMPLIANT", anchor: null },
      NO_RESIDUALS: { expected: "NOT_FOUND", anchor: null },
    };
    expect(problemsOf({ ...file, labels })).toHaveLength(3);
  });
});
