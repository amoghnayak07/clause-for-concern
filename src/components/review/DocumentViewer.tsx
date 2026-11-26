"use client";

import { Fragment, useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import { CITATION_HIGHLIGHT_ALPHA, FOCUSED_CITATION_HIGHLIGHT_ALPHA, type RuleId } from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import { recommendedAction } from "@/features/review/derive";
import type { Finding } from "@/features/review/finding";
import { ruleTitle } from "@/features/viewer/card";
import {
  buildViewerBlocks,
  citationKey,
  clauseDomId,
  displayHighlight,
  nextFocusRuleId,
  scrollTarget,
  type TextRun,
} from "@/features/viewer/segments";

export interface DocumentViewerProps {
  /** The untouched Document text; everything shown is sliced from it. */
  text: string;
  clauses: readonly Clause[];
  findings: readonly Finding[];
  focusedRuleId?: RuleId | null;
  /** Called with the Finding a clicked highlight belongs to. */
  onFocusFinding?: (ruleId: RuleId) => void;
  /** A Clause to scroll to and outline (e.g. an Unmapped Clause picked in the coverage bar). */
  revealedClause?: ClauseReveal | null;
}

export interface ClauseReveal {
  readonly clauseId: ClauseId;
  /** Changes on every request, so revealing the same Clause again scrolls again. */
  readonly requestId: number;
}

/**
 * Renders the original Document with Citation highlights (verified offsets
 * only). Each Clause is a span with id `clauseDomId(clause.id)` so other
 * features can scroll to it.
 */
export function DocumentViewer({
  text,
  clauses,
  findings,
  focusedRuleId = null,
  onFocusFinding,
  revealedClause = null,
}: DocumentViewerProps) {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => buildViewerBlocks(text, clauses, findings), [text, clauses, findings]);

  const focusedFinding = focusedRuleId ? findings.find((f) => f.ruleId === focusedRuleId) : undefined;
  const target = focusedFinding ? scrollTarget(focusedFinding, clauses) : null;
  const emphasisedClauseId = target?.kind === "clause" ? target.clauseId : null;
  const targetKey =
    target === null ? null : target.kind === "citation" ? citationKey(target.ruleId, target.citationIndex) : target.clauseId;
  const targetKind = target?.kind ?? null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || targetKey === null) return;
    const element =
      targetKind === "citation"
        ? container.querySelector(`[data-citation-anchors~="${targetKey}"]`)
        : container.ownerDocument.getElementById(clauseDomId(targetKey));
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetKey, targetKind]);

  const revealedClauseId = revealedClause?.clauseId ?? null;
  const revealRequestId = revealedClause?.requestId ?? null;
  useEffect(() => {
    if (revealedClauseId === null) return;
    containerRef.current?.ownerDocument
      .getElementById(clauseDomId(revealedClauseId))
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [revealedClauseId, revealRequestId]);

  const clauseOutline = (clauseId: ClauseId) => {
    if (clauseId === revealedClauseId) return theme.palette.review.unmapped;
    if (clauseId === emphasisedClauseId && focusedFinding) return theme.palette.review.action[recommendedAction(focusedFinding)];
    return null;
  };

  const focus = (run: TextRun) => {
    const ruleId = nextFocusRuleId(run.highlights, focusedRuleId);
    if (ruleId && onFocusFinding) onFocusFinding(ruleId);
  };

  const renderRun = (run: TextRun): ReactNode => {
    const slice = text.slice(run.start, run.end);
    const shown = displayHighlight(run, focusedRuleId);
    if (!shown) return <Fragment key={run.start}>{slice}</Fragment>;

    const color = theme.palette.review.action[shown.action];
    const focused = shown.ruleId === focusedRuleId;
    const ruleIds = [...new Set(run.highlights.map((h) => h.ruleId))];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      focus(run);
    };
    return (
      <Box
        key={run.start}
        component="mark"
        role="button"
        tabIndex={0}
        title={ruleIds.map(ruleTitle).join(", ")}
        aria-label={`Citation for ${ruleIds.map(ruleTitle).join(", ")}`}
        data-rule-ids={ruleIds.join(" ")}
        data-citation-anchors={run.anchors.map((h) => citationKey(h.ruleId, h.citationIndex)).join(" ") || undefined}
        onClick={() => focus(run)}
        onKeyDown={onKeyDown}
        sx={{
          color: "inherit",
          cursor: "pointer",
          borderRadius: 0.5,
          backgroundColor: alpha(color, focused ? FOCUSED_CITATION_HIGHLIGHT_ALPHA : CITATION_HIGHLIGHT_ALPHA),
          boxShadow: `inset 0 -2px 0 ${alpha(color, focused ? 1 : FOCUSED_CITATION_HIGHLIGHT_ALPHA)}`,
          // Overlapping Citations from several Findings get a dotted top edge.
          ...(ruleIds.length > 1 && { borderTop: `2px dotted ${color}` }),
          "&:hover, &:focus-visible": {
            backgroundColor: alpha(color, FOCUSED_CITATION_HIGHLIGHT_ALPHA),
            outline: "none",
          },
        }}
      >
        {slice}
      </Box>
    );
  };

  return (
    <Box
      ref={containerRef}
      component="article"
      aria-label="Document"
      sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", typography: "body1", lineHeight: 1.75 }}
    >
      {blocks.map((block) => {
        if (!block.clause) return <Fragment key={block.start}>{block.runs.map(renderRun)}</Fragment>;
        const outline = clauseOutline(block.clause.id);
        return (
          <Box
            key={block.start}
            component="span"
            id={clauseDomId(block.clause.id)}
            data-clause-id={block.clause.id}
            data-clause-label={block.clause.label}
            sx={outline ? { outline: `2px dashed ${outline}`, outlineOffset: 2, borderRadius: 0.5 } : undefined}
          >
            {block.runs.map(renderRun)}
          </Box>
        );
      })}
    </Box>
  );
}
