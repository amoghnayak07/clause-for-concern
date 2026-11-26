"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useMemo, useRef, useState } from "react";
import {
  DECISION_PACE_HELP,
  KEYBOARD_SHORTCUTS,
  QUEUE_UI_TEXT,
  REVIEW_PHASE,
  SHORTCUT_HINTS,
  type ReviewPhase,
  type RuleId,
} from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Coverage } from "@/features/review/coverage";
import type { Finding } from "@/features/review/finding";
import { coverageView, ruleStatusRows } from "@/features/review/overview";
import { averageDecisionSummary } from "@/features/review/timing";
import { minimapModel } from "@/features/viewer/minimap";
import { DocumentViewer, type ClauseReveal } from "./DocumentViewer";
import { ExportBar } from "./ExportBar";
import { FindingList } from "./FindingList";
import { Minimap } from "./Minimap";
import { ReviewOverview } from "./ReviewOverview";
import { useReviewQueue } from "./useReviewQueue";

export interface ReviewWorkspaceProps {
  text: string;
  clauses: readonly Clause[];
  findings: readonly Finding[];
  /** Null until the stream's `coverage` event. */
  coverage?: Coverage | null;
  phase?: ReviewPhase;
}

/**
 * Two-pane review: the Document and its minimap on the left; the Rule status panel, coverage
 * bar and Review Queue on the right. Purely prop-driven so a streaming source
 * can feed it Findings as they arrive.
 */
export function ReviewWorkspace({
  text,
  clauses,
  findings,
  coverage = null,
  phase = REVIEW_PHASE.DONE,
}: ReviewWorkspaceProps) {
  const { ordered, state, focus, setDraft, cancel, submit } = useReviewQueue(findings, clauses);
  const decided = ordered.filter((finding) => state.decisions[finding.ruleId]).length;
  const pace = useMemo(() => averageDecisionSummary(state.decisions), [state.decisions]);
  const rows = useMemo(() => ruleStatusRows(findings, state.decisions), [findings, state.decisions]);
  const coverageBar = useMemo(() => coverageView(coverage, clauses, phase), [coverage, clauses, phase]);
  const minimap = useMemo(
    () => minimapModel(findings, clauses, coverage, state.decisions),
    [findings, clauses, coverage, state.decisions],
  );
  const viewerRef = useRef<HTMLDivElement>(null);

  // A revealed Clause stays outlined until focus moves to another Finding.
  const [reveal, setReveal] = useState<(ClauseReveal & { focusedRuleId: RuleId | null }) | null>(null);
  const revealedClause = reveal && reveal.focusedRuleId === state.focusedRuleId ? reveal : null;
  const revealClause = (clauseId: ClauseId) =>
    setReveal((previous) => ({
      clauseId,
      requestId: (previous?.requestId ?? 0) + 1,
      focusedRuleId: state.focusedRuleId,
    }));

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "minmax(0, 3fr) minmax(320px, 2fr)" },
        gap: 2,
        p: 2,
        height: { md: "100%" },
        boxSizing: "border-box",
      }}
    >
      <Box sx={{ display: "flex", gap: 1, minHeight: 0, minWidth: 0 }}>
        <Paper
          ref={viewerRef}
          variant="outlined"
          sx={{ flex: 1, minWidth: 0, p: { xs: 2, md: 4 }, overflowY: "auto", minHeight: 0 }}
        >
          <DocumentViewer
            text={text}
            clauses={clauses}
            findings={findings}
            focusedRuleId={state.focusedRuleId}
            onFocusFinding={focus}
            revealedClause={revealedClause}
          />
        </Paper>
        <Minimap
          model={minimap}
          clauses={clauses}
          findings={findings}
          scrollRef={viewerRef}
          focusedRuleId={state.focusedRuleId}
          onFocusFinding={focus}
          onRevealClause={revealClause}
        />
      </Box>
      <Box component="aside" sx={{ overflowY: "auto", minHeight: 0, pr: 0.5 }}>
        <ReviewOverview
          rows={rows}
          coverage={coverageBar}
          focusedRuleId={state.focusedRuleId}
          onFocusFinding={focus}
          onRevealClause={revealClause}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.5 }}>
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            {QUEUE_UI_TEXT.HEADING}
          </Typography>
          {ordered.length > 0 && (
            <Typography variant="body2" color="text.secondary" role="status" aria-live="polite">
              {decided === ordered.length ? QUEUE_UI_TEXT.ALL_DECIDED : `${decided} of ${ordered.length} decided`}
            </Typography>
          )}
        </Stack>
        {pace && (
          <Typography
            variant="caption"
            component="p"
            color="text.secondary"
            title={DECISION_PACE_HELP}
            sx={{ mb: 0.5, fontVariantNumeric: "tabular-nums" }}
          >
            {pace}
          </Typography>
        )}
        <ShortcutHint />
        {ordered.length > 0 && (
          <ExportBar
            text={text}
            clauses={clauses}
            findings={ordered}
            decisions={state.decisions}
            disabled={phase === REVIEW_PHASE.RUNNING}
          />
        )}
        <FindingList
          findings={ordered}
          clauses={clauses}
          text={text}
          focusedRuleId={state.focusedRuleId}
          onFocusFinding={focus}
          decisions={state.decisions}
          mode={state.mode}
          onDraft={setDraft}
          onSubmit={submit}
          onCancel={cancel}
        />
      </Box>
    </Box>
  );
}

function ShortcutHint() {
  return (
    <Typography variant="caption" component="p" color="text.secondary" sx={{ mb: 1.5 }}>
      {SHORTCUT_HINTS.map(({ action, label }, index) => (
        <Box component="span" key={action} sx={{ whiteSpace: "nowrap" }}>
          {index > 0 && " · "}
          <Box
            component="kbd"
            sx={{ px: 0.5, border: 1, borderColor: "divider", borderRadius: 0.5, fontFamily: "monospace" }}
          >
            {KEYBOARD_SHORTCUTS[action].toUpperCase()}
          </Box>{" "}
          {label}
        </Box>
      ))}
    </Typography>
  );
}
