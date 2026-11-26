import { getContrastRatio } from "@mui/material/styles";
import { describe, expect, it } from "vitest";
import { ACTION_COLORS, BRAND_COLORS, STATUS_COLORS, UNMAPPED_CLAUSE_COLOR } from "@/common/constants";

/** WCAG 2.2 AA: 1.4.3 for text, 1.4.11 for non-text marks. */
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const SURFACES = { paper: BRAND_COLORS.PAPER, background: BRAND_COLORS.BACKGROUND };

// Each of these colours is used as text somewhere (chips, redline headings, status labels, Agent's Reasoning heading).
const TEXT_COLORS = {
  ...Object.fromEntries(Object.entries(ACTION_COLORS).map(([key, value]) => [`action.${key}`, value])),
  ...Object.fromEntries(Object.entries(STATUS_COLORS).map(([key, value]) => [`status.${key}`, value])),
  primary: BRAND_COLORS.PRIMARY,
  secondary: BRAND_COLORS.SECONDARY,
};

describe("theme colour contrast", () => {
  for (const [surfaceName, surface] of Object.entries(SURFACES)) {
    for (const [name, color] of Object.entries(TEXT_COLORS)) {
      it(`${name} is readable as text on ${surfaceName}`, () => {
        expect(getContrastRatio(color, surface)).toBeGreaterThanOrEqual(TEXT_MIN);
      });
    }

    it(`unmapped Clause marks are visible on ${surfaceName}`, () => {
      expect(getContrastRatio(UNMAPPED_CLAUSE_COLOR, surface)).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    });
  }
});
