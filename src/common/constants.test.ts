import { describe, expect, it } from "vitest";
import { KEYBOARD_SHORTCUTS, PLAYBOOK, RULE_ID, RULE_KIND } from "./constants";

describe("playbook", () => {
  it("has exactly one entry per rule ID", () => {
    expect(PLAYBOOK.map((rule) => rule.id).sort()).toEqual(Object.values(RULE_ID).sort());
  });

  it("gives every rule at least one lowercase trigger term", () => {
    for (const rule of PLAYBOOK) {
      expect(rule.triggerTerms.length).toBeGreaterThan(0);
      for (const term of rule.triggerTerms) expect(term).toBe(term.toLowerCase());
    }
  });

  it("marks only the absence-is-good rules as PROHIBITED", () => {
    const prohibited = PLAYBOOK.filter((rule) => rule.kind === RULE_KIND.PROHIBITED).map((rule) => rule.id);
    expect(prohibited.sort()).toEqual([RULE_ID.NO_NON_SOLICIT, RULE_ID.NO_RESIDUALS].sort());
  });
});

describe("keyboard shortcuts", () => {
  it("are unique single keys", () => {
    const keys = Object.values(KEYBOARD_SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toHaveLength(1);
  });
});
