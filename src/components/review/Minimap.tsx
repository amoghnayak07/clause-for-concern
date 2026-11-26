"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { DECIDED_TICK_OPACITY, MINIMAP, MINIMAP_UI_TEXT, STATUS_LABELS, type RuleId } from "@/common/constants";
import type { Clause, ClauseId } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import { ruleTitle } from "@/features/viewer/card";
import { measuredClauseIds, type MinimapModel, type MinimapTick, type PinnedMark } from "@/features/viewer/minimap";
import { clauseDomId } from "@/features/viewer/segments";

export interface MinimapProps {
  model: MinimapModel;
  clauses: readonly Clause[];
  findings: readonly Finding[];
  /** The viewer's scroll container; ticks sit at each Clause's offset within it. */
  scrollRef: RefObject<HTMLElement | null>;
  focusedRuleId: RuleId | null;
  onFocusFinding: (ruleId: RuleId) => void;
  onRevealClause: (clauseId: ClauseId) => void;
}

/**
 * Minimap beside the Document (DESIGN "UI"): a tick per cited Clause, dashed
 * for Blocked Citations, grey for Unmapped Clauses, and a pinned cluster at the
 * top for Findings with no place in the Document. Decided ticks dim. Keyboard
 * users have the Rule status panel and queue, so ticks are mouse-only.
 */
export function Minimap({
  model,
  clauses,
  findings,
  scrollRef,
  focusedRuleId,
  onFocusFinding,
  onRevealClause,
}: MinimapProps) {
  const positions = useClausePositions(scrollRef, model);
  const labels = useMemo(() => new Map(clauses.map((clause) => [clause.id, clause.label])), [clauses]);
  const statuses = useMemo(() => new Map(findings.map((f) => [f.ruleId, STATUS_LABELS[f.status]])), [findings]);

  return (
    <Box
      component="nav"
      aria-label={MINIMAP_UI_TEXT.LABEL}
      sx={{ width: MINIMAP.WIDTH_PX, flexShrink: 0, display: { xs: "none", sm: "flex" }, flexDirection: "column" }}
    >
      {model.pinned.length > 0 && (
        <Box
          title={MINIMAP_UI_TEXT.NOT_IN_DOCUMENT}
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            pb: `${MINIMAP.PINNED_GAP_PX}px`,
            mb: `${MINIMAP.PINNED_GAP_PX}px`,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {model.pinned.map((mark) => (
            <PinnedTick
              key={mark.ruleId}
              mark={mark}
              focused={mark.ruleId === focusedRuleId}
              title={`${ruleTitle(mark.ruleId)}: ${statuses.get(mark.ruleId) ?? ""} (${MINIMAP_UI_TEXT.NOT_IN_DOCUMENT})`}
              onClick={() => onFocusFinding(mark.ruleId)}
            />
          ))}
        </Box>
      )}
      <Box sx={{ position: "relative", flex: 1, borderRadius: 1, bgcolor: "action.hover" }}>
        {model.ticks.map((tick) => {
          const top = positions.get(tick.clauseId);
          if (top === undefined) return null;
          const label = labels.get(tick.clauseId) ?? tick.clauseId;
          return (
            <DocumentTick
              key={tick.kind === "unmapped" ? `unmapped:${tick.clauseId}` : `${tick.kind}:${tick.ruleId}:${tick.clauseId}`}
              tick={tick}
              top={top}
              focused={tick.kind !== "unmapped" && tick.ruleId === focusedRuleId}
              title={
                tick.kind === "unmapped"
                  ? `${MINIMAP_UI_TEXT.UNMAPPED} ${label}`
                  : `${ruleTitle(tick.ruleId)} · ${label}${tick.kind === "blocked" ? ` (${MINIMAP_UI_TEXT.BLOCKED})` : ""}`
              }
              onClick={() => (tick.kind === "unmapped" ? onRevealClause(tick.clauseId) : onFocusFinding(tick.ruleId))}
            />
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Each ticked Clause's top as a fraction (0–1) of the container's scroll
 * height, re-measured whenever the container or its content resizes.
 */
function useClausePositions(scrollRef: RefObject<HTMLElement | null>, model: MinimapModel): ReadonlyMap<ClauseId, number> {
  const [positions, setPositions] = useState<ReadonlyMap<ClauseId, number>>(() => new Map());
  const idsKey = useMemo(() => measuredClauseIds(model).join(" "), [model]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const ids = idsKey === "" ? [] : idsKey.split(" ");
    const measure = () => {
      const height = container.scrollHeight;
      if (height === 0) return;
      const origin = container.getBoundingClientRect().top - container.scrollTop;
      const next = new Map<ClauseId, number>();
      for (const id of ids) {
        const element = container.ownerDocument.getElementById(clauseDomId(id));
        if (element) next.set(id, Math.min(1, Math.max(0, (element.getBoundingClientRect().top - origin) / height)));
      }
      setPositions(next);
    };
    // Observing fires once immediately, so this also takes the first measurement.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollRef, idsKey]);

  return positions;
}

const buttonReset = { p: 0, m: 0, border: 0, cursor: "pointer", display: "block" } as const;

function DocumentTick({
  tick,
  top,
  focused,
  title,
  onClick,
}: {
  tick: MinimapTick;
  top: number;
  focused: boolean;
  title: string;
  onClick: () => void;
}) {
  const theme = useTheme();
  const color = tick.kind === "unmapped" ? theme.palette.review.unmapped : theme.palette.review.action[tick.action];
  const dim = tick.kind !== "unmapped" && tick.decided && !focused;
  return (
    <Box
      component="button"
      type="button"
      tabIndex={-1}
      title={title}
      aria-label={title}
      data-tick-kind={tick.kind}
      onClick={onClick}
      sx={{
        ...buttonReset,
        position: "absolute",
        top: `${top * 100}%`,
        height: MINIMAP.TICK_HEIGHT_PX,
        // Unmapped ticks are half width so Finding ticks on the same Clause stay visible.
        left: tick.kind === "unmapped" ? "50%" : 0,
        right: 0,
        borderRadius: "1px",
        opacity: dim ? DECIDED_TICK_OPACITY : 1,
        ...(tick.kind === "blocked"
          ? { bgcolor: "background.paper", border: `1px dashed ${color}` }
          : { bgcolor: color }),
        ...(focused && { outline: `1px solid ${theme.palette.text.primary}`, outlineOffset: 1, zIndex: 1 }),
        "&:hover": { outline: `1px solid ${theme.palette.text.secondary}`, outlineOffset: 1, zIndex: 2 },
      }}
    />
  );
}

function PinnedTick({
  mark,
  focused,
  title,
  onClick,
}: {
  mark: PinnedMark;
  focused: boolean;
  title: string;
  onClick: () => void;
}) {
  const theme = useTheme();
  return (
    <Box
      component="button"
      type="button"
      tabIndex={-1}
      title={title}
      aria-label={title}
      onClick={onClick}
      sx={{
        ...buttonReset,
        width: "100%",
        height: MINIMAP.TICK_HEIGHT_PX,
        borderRadius: "1px",
        bgcolor: theme.palette.review.action[mark.action],
        opacity: mark.decided && !focused ? DECIDED_TICK_OPACITY : 1,
        ...(focused && { outline: `1px solid ${theme.palette.text.primary}`, outlineOffset: 1 }),
        "&:hover": { outline: `1px solid ${theme.palette.text.secondary}`, outlineOffset: 1 },
      }}
    />
  );
}
