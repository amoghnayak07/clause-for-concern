import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./index";

describe("parseConfig", () => {
  it("returns typed config when every key is present", () => {
    expect(
      parseConfig({ ANTHROPIC_API_KEY: "sk-test", REVIEW_MODEL: "claude-opus-5-5" }),
    ).toEqual({ anthropicApiKey: "sk-test", reviewModel: "claude-opus-5-5" });
  });

  it("names every missing key in one error", () => {
    expect(() => parseConfig({})).toThrowError(ConfigError);
    try {
      parseConfig({});
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("ANTHROPIC_API_KEY is missing");
      expect(message).toContain("REVIEW_MODEL is missing");
      expect(message).toContain(".env.example");
    }
  });

  it("rejects blank values", () => {
    expect(() => parseConfig({ ANTHROPIC_API_KEY: "  ", REVIEW_MODEL: "claude-opus-5-5" })).toThrowError(
      /ANTHROPIC_API_KEY is empty/,
    );
  });
});
