"use client";

import type { KeyboardEvent, ReactNode } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import {
  ACTION_LABELS,
  AGENT_REASONING_LABEL,
  BLOCKED_REASON_LABELS,
  CITATION_HIGHLIGHT_ALPHA,
  DECIDED_CARD_OPACITY,
  DECISION_LABELS,
  EXPLANATION_CLAMP_LINES,
  FINDING_SOURCE,
  POSSIBLE_MISS_LABEL,
  REDLINE_KIND,
  STATUS_LABELS,
  VERIFIER_NOTE_LABEL,
} from "@/common/constants";
import { ConfidenceTick } from "@/components/common/ConfidenceTick";
import type { Clause } from "@/features/document/types";
import { recommendedAction } from "@/features/review/derive";
import type { Finding } from "@/features/review/finding";
import type { Decision } from "@/features/review/queue";
import {
  blockedCitationHeadline,
  blockedCitationViews,
  citedClauseLabels,
  redlineHeadline,
  redlineView,
  ruleTitle,
  type BlockedCitationView,
  type RedlineView,
} from "@/features/viewer/card";
import { findingDomId } from "@/features/viewer/segments";

export interface FindingCardProps {
  finding: Finding;
  clauses: readonly Clause[];
  /** The Document text; blocked-citation and Redline context is sliced from it. */
  text: string;
  focused?: boolean;
  onFocus?: () => void;
  /** The reviewer's latest Decision on this Finding. */
  decision?: Decision;
  /** Inline Decision editor, shown at the bottom of the card. */
  children?: ReactNode;
}

export function FindingCard({ finding, clauses, text, focused = false, onFocus, decision, children }: FindingCardProps) {
  const theme = useTheme();
  const action = recommendedAction(finding);
  const actionColor = theme.palette.review.action[action];
  const labels = citedClauseLabels(finding, clauses);
  const blocked = blockedCitationViews(finding, clauses, text);
  const redline = redlineView(finding, clauses, text);
  const title = ruleTitle(finding.ruleId);
  const possibleMiss = finding.source === FINDING_SOURCE.TRIGGER_TERM;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onFocus?.();
  };

  return (
    <Paper
      id={findingDomId(finding.ruleId)}
      component="article"
      variant="outlined"
      tabIndex={0}
      aria-label={`${title}: ${STATUS_LABELS[finding.status]}${decision ? `, ${DECISION_LABELS[decision.kind]}` : ""}`}
      aria-current={focused || undefined}
      data-rule-id={finding.ruleId}
      onClick={onFocus}
      onKeyDown={onKeyDown}
      sx={{
        p: 2,
        cursor: onFocus ? "pointer" : undefined,
        borderLeft: `4px solid ${actionColor}`,
        ...(decision && !focused && { opacity: DECIDED_CARD_OPACITY }),
        ...(focused && { borderColor: actionColor, boxShadow: `0 0 0 1px ${actionColor}` }),
        "&:focus-visible": { outline: `2px solid ${actionColor}`, outlineOffset: 2 },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <ConfidenceTick confidence={finding.confidence} color={actionColor} possibleMiss={possibleMiss} />
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, flexGrow: 1, lineHeight: 1.3 }}>
          {title}
        </Typography>
        {decision && <Chip size="small" variant="outlined" label={DECISION_LABELS[decision.kind]} />}
        <Chip
          size="small"
          label={ACTION_LABELS[action]}
          sx={{ bgcolor: actionColor, color: theme.palette.getContrastText(actionColor), fontWeight: 600 }}
        />
      </Stack>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}>
        <Chip
          size="small"
          variant="outlined"
          label={STATUS_LABELS[finding.status]}
          sx={{ borderColor: theme.palette.review.status[finding.status], color: theme.palette.review.status[finding.status] }}
        />
        {possibleMiss && <Chip size="small" variant="outlined" label={POSSIBLE_MISS_LABEL} />}
        {labels.map((label) => (
          <Chip key={label} size="small" label={label} sx={{ fontVariantNumeric: "tabular-nums" }} />
        ))}
      </Stack>

      {finding.error && (
        <Box
          role="alert"
          sx={{ mb: 1, p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.review.status.ERROR, CITATION_HIGHLIGHT_ALPHA) }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Could not check this rule ({finding.error.kind})
          </Typography>
          <Typography variant="body2">{finding.error.message}</Typography>
        </Box>
      )}

      {blocked.map((view, index) => (
        <BlockedCitation key={index} view={view} color={theme.palette.review.action.ESCALATE} />
      ))}

      {redline && <RedlinePreview view={redline} color={actionColor} />}

      {finding.explanation && (
        <AgentText label={AGENT_REASONING_LABEL} clamp={!focused}>
          {finding.explanation}
        </AgentText>
      )}
      {finding.verifierNote && (
        <AgentText label={VERIFIER_NOTE_LABEL} clamp={!focused}>
          {finding.verifierNote}
        </AgentText>
      )}

      {decision && <DecisionSummary decision={decision} />}
      {children}
    </Paper>
  );
}

/** The reviewer's own words on the Finding: an escalation/dismissal reason or edited Redline. */
function DecisionSummary({ decision }: { decision: Decision }) {
  const detail = decision.reason ?? decision.editedReplacement;
  if (detail === null) return null;
  return (
    <Typography variant="body2" component="p" sx={{ mt: 1, whiteSpace: "pre-wrap" }}>
      <Box component="span" sx={{ fontWeight: 600 }}>
        {DECISION_LABELS[decision.kind]}:
      </Box>{" "}
      {detail}
    </Typography>
  );
}

/** Model free text, styled so it can't be mistaken for contract text (GLOSSARY "Agent's Reasoning"). */
function AgentText({ label, clamp, children }: { label: string; clamp: boolean; children: ReactNode }) {
  return (
    <Box
      component="section"
      aria-label={label}
      sx={{ mt: 1, pl: 1.5, borderLeft: 3, borderColor: "secondary.light", bgcolor: "action.hover", py: 0.75, pr: 1 }}
    >
      <Typography variant="overline" component="h4" sx={{ color: "secondary.main", lineHeight: 1.6 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontStyle: "italic",
          color: "text.secondary",
          ...(clamp && {
            display: "-webkit-box",
            WebkitLineClamp: EXPLANATION_CLAMP_LINES,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }),
        }}
      >
        {children}
      </Typography>
    </Box>
  );
}

/** "Agent cited AX but the quote didn't match" + the real Clause text. Never the model's quote (ADR 0002). */
function BlockedCitation({ view, color }: { view: BlockedCitationView; color: string }) {
  return (
    <Box sx={{ mb: 1, p: 1, border: `1px dashed ${color}`, borderRadius: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, color }}>
        {blockedCitationHeadline(view)}
      </Typography>
      <Typography variant="caption" component="p" color="text.secondary">
        {BLOCKED_REASON_LABELS[view.reason]}
      </Typography>
      {view.kind === "IN_DOCUMENT" && <DocumentQuote>{view.clauseText}</DocumentQuote>}
    </Box>
  );
}

function RedlinePreview({ view, color }: { view: RedlineView; color: string }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography variant="caption" component="p" sx={{ fontWeight: 600, color }}>
        {redlineHeadline(view)}
      </Typography>
      {view.kind === REDLINE_KIND.REPLACE ? (
        <Typography variant="body2" component="p" sx={{ whiteSpace: "pre-wrap" }}>
          <Box component="del" sx={{ color: "text.secondary" }}>
            {view.original}
          </Box>{" "}
          <Box component="ins" sx={{ textDecorationColor: color, fontWeight: 500 }}>
            {view.replacement}
          </Box>
        </Typography>
      ) : (
        <Typography variant="body2" component="p" sx={{ whiteSpace: "pre-wrap" }}>
          <Box component="ins" sx={{ textDecorationColor: color }}>
            {view.text}
          </Box>
        </Typography>
      )}
    </Box>
  );
}

/** Contract text sliced from the Document. */
function DocumentQuote({ children }: { children: ReactNode }) {
  return (
    <Box
      component="blockquote"
      sx={{ m: 0, mt: 0.5, pl: 1, borderLeft: 2, borderColor: "divider", whiteSpace: "pre-wrap", typography: "body2" }}
    >
      {children}
    </Box>
  );
}
