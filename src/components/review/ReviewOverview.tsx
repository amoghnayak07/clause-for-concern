"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import {
  CITATION_HIGHLIGHT_ALPHA,
  DECIDED_CARD_OPACITY,
  DECISION_LABELS,
  FINDING_SOURCE,
  OVERVIEW_UI_TEXT,
  STATUS_LABELS,
  type RuleId,
} from "@/common/constants";
import { ConfidenceTick } from "@/components/common/ConfidenceTick";
import type { ClauseId } from "@/features/document/types";
import type { CoverageView, RuleStatusRow } from "@/features/review/overview";

export interface ReviewOverviewProps {
  rows: readonly RuleStatusRow[];
  coverage: CoverageView | null;
  focusedRuleId: RuleId | null;
  onFocusFinding: (ruleId: RuleId) => void;
  onRevealClause: (clauseId: ClauseId) => void;
}

/** Rule status panel and coverage bar (DESIGN "UI"), above the Review Queue. */
export function ReviewOverview({ rows, coverage, focusedRuleId, onFocusFinding, onRevealClause }: ReviewOverviewProps) {
  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Box component="section" aria-labelledby="overview-rules-heading">
        <Typography id="overview-rules-heading" variant="overline" component="h2" color="text.secondary">
          {OVERVIEW_UI_TEXT.RULES_HEADING}
        </Typography>
        <Stack component="ul" spacing={0.25} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map((row) => (
            <RuleRow
              key={row.ruleId}
              row={row}
              focused={row.ruleId === focusedRuleId}
              onFocus={() => onFocusFinding(row.ruleId)}
            />
          ))}
        </Stack>
      </Box>
      {coverage && <CoverageBar view={coverage} onRevealClause={onRevealClause} />}
    </Stack>
  );
}

function RuleRow({ row, focused, onFocus }: { row: RuleStatusRow; focused: boolean; onFocus: () => void }) {
  const theme = useTheme();
  const { finding, action, decision } = row;

  if (!finding || !action) {
    return (
      <Stack component="li" direction="row" spacing={1} sx={{ alignItems: "center", px: 1, py: 0.5 }}>
        <Box sx={{ width: 18, flexShrink: 0 }} />
        <Typography variant="body2" sx={{ flexGrow: 1 }}>
          {row.title}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {OVERVIEW_UI_TEXT.RULE_PENDING}
        </Typography>
      </Stack>
    );
  }

  const color = theme.palette.review.action[action];
  const statusColor = theme.palette.review.status[finding.status];
  return (
    <Box component="li">
      <ButtonBase
        onClick={onFocus}
        aria-current={focused || undefined}
        aria-label={`${row.title}: ${STATUS_LABELS[finding.status]}${decision ? `, ${DECISION_LABELS[decision.kind]}` : ""}`}
        sx={{
          width: "100%",
          justifyContent: "flex-start",
          gap: 1,
          px: 1,
          py: 0.5,
          borderRadius: 1,
          textAlign: "left",
          ...(decision && !focused && { opacity: DECIDED_CARD_OPACITY }),
          ...(focused && { bgcolor: alpha(color, CITATION_HIGHLIGHT_ALPHA) }),
          "&:hover": { bgcolor: alpha(color, CITATION_HIGHLIGHT_ALPHA) },
          "&:focus-visible": { outline: `2px solid ${color}`, outlineOffset: 1 },
        }}
      >
        <ConfidenceTick
          confidence={finding.confidence}
          color={color}
          possibleMiss={finding.source === FINDING_SOURCE.TRIGGER_TERM}
        />
        <Typography variant="body2" component="span" sx={{ flexGrow: 1 }}>
          {row.title}
        </Typography>
        {decision && (
          <Typography variant="caption" component="span" color="text.secondary">
            {DECISION_LABELS[decision.kind]}
          </Typography>
        )}
        <Typography variant="caption" component="span" sx={{ color: statusColor, fontWeight: 600, whiteSpace: "nowrap" }}>
          {STATUS_LABELS[finding.status]}
        </Typography>
      </ButtonBase>
    </Box>
  );
}

function CoverageBar({ view, onRevealClause }: { view: CoverageView; onRevealClause: (clauseId: ClauseId) => void }) {
  const theme = useTheme();
  return (
    <Box component="section" aria-labelledby="overview-coverage-heading">
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
        <Typography
          id="overview-coverage-heading"
          variant="overline"
          component="h2"
          color="text.secondary"
          sx={{ flexGrow: 1 }}
        >
          {OVERVIEW_UI_TEXT.COVERAGE_HEADING}
        </Typography>
        <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
          {view.kind === "available"
            ? view.summary
            : view.kind === "pending"
              ? OVERVIEW_UI_TEXT.COVERAGE_PENDING
              : OVERVIEW_UI_TEXT.COVERAGE_UNAVAILABLE}
        </Typography>
      </Stack>
      {view.kind === "pending" && <LinearProgress aria-label={OVERVIEW_UI_TEXT.COVERAGE_PENDING} />}
      {view.kind === "available" && (
        <>
          <LinearProgress
            variant="determinate"
            value={view.percent}
            aria-label={view.summary}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: alpha(theme.palette.review.unmapped, 0.35),
              "& .MuiLinearProgress-bar": { bgcolor: theme.palette.review.action.NONE },
            }}
          />
          {view.unmapped.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" component="h3" color="text.secondary">
                {OVERVIEW_UI_TEXT.UNMAPPED_HEADING}
              </Typography>
              <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5 }}>
                {view.unmapped.map(({ clauseId, label }) => (
                  <Chip
                    key={clauseId}
                    size="small"
                    variant="outlined"
                    label={label}
                    onClick={() => onRevealClause(clauseId)}
                    sx={{
                      borderStyle: "dashed",
                      borderColor: theme.palette.review.unmapped,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  />
                ))}
              </Stack>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
