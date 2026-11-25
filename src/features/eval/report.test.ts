import { describe, expect, it } from "vitest";
import { formatRatio, formatUsd, table } from "./report";

describe("report formatting", () => {
  it("aligns table columns", () => {
    expect(table(["Rule", "Recall"], [["MUTUAL", "50%"], ["NO_RESIDUALS", "100%"]])).toBe(
      ["Rule          Recall", "------------  ------", "MUTUAL           50%", "NO_RESIDUALS    100%"].join("\n"),
    );
  });

  it("formats ratios with counts, and a dash when undefined", () => {
    expect(formatRatio({ hit: 2, total: 3 })).toBe("67% (2/3)");
    expect(formatRatio({ hit: 0, total: 0 })).toBe("-");
  });

  it("formats cost, or n/a without pricing", () => {
    expect(formatUsd(0.0039)).toBe("$0.0039");
    expect(formatUsd(null)).toBe("n/a");
  });
});
