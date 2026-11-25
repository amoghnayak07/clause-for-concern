import { createTheme } from "@mui/material/styles";
import {
  ACTION_COLORS,
  STATUS_COLORS,
  UNMAPPED_CLAUSE_COLOR,
  type FindingStatus,
  type RecommendedAction,
} from "@/common/constants";

declare module "@mui/material/styles" {
  interface Palette {
    review: {
      action: Record<RecommendedAction, string>;
      status: Record<FindingStatus, string>;
      unmapped: string;
    };
  }
  interface PaletteOptions {
    review?: {
      action: Record<RecommendedAction, string>;
      status: Record<FindingStatus, string>;
      unmapped: string;
    };
  }
}

export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: "light",
    primary: { main: "#1F3A5F" },
    secondary: { main: "#6B4E9B" },
    background: { default: "#F6F7F9", paper: "#FFFFFF" },
    review: {
      action: { ...ACTION_COLORS },
      status: { ...STATUS_COLORS },
      unmapped: UNMAPPED_CLAUSE_COLOR,
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    button: { textTransform: "none" },
  },
  components: {
    MuiButtonBase: { defaultProps: { disableRipple: true } },
  },
});
