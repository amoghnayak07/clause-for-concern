import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { CONFIDENCE, CONFIDENCE_LABELS, POSSIBLE_MISS_LABEL, type Confidence } from "@/common/constants";

const SIZE = 18;

/**
 * Confidence marker (DESIGN "Recommended action → colour"): a filled tick for
 * HIGH, a hollow tick in the same colour for LOW / Possible Miss.
 */
export function ConfidenceTick({
  confidence,
  color,
  possibleMiss = false,
}: {
  confidence: Confidence;
  color: string;
  possibleMiss?: boolean;
}) {
  const theme = useTheme();
  const filled = confidence === CONFIDENCE.HIGH;
  const label = possibleMiss ? `${CONFIDENCE_LABELS[confidence]} (${POSSIBLE_MISS_LABEL})` : CONFIDENCE_LABELS[confidence];
  return (
    <Tooltip title={label}>
      <svg width={SIZE} height={SIZE} viewBox="0 0 20 20" role="img" aria-label={label} style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="8.5" fill={filled ? color : "none"} stroke={color} strokeWidth="1.5" />
        <path
          d="M6 10.5l2.6 2.6L14 7.6"
          fill="none"
          stroke={filled ? theme.palette.common.white : color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Tooltip>
  );
}
