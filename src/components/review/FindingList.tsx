"use client";

import { useEffect, useRef } from "react";
import Stack from "@mui/material/Stack";
import type { RuleId } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import { findingDomId } from "@/features/viewer/segments";
import { FindingCard } from "./FindingCard";

export interface FindingListProps {
  findings: readonly Finding[];
  clauses: readonly Clause[];
  text: string;
  focusedRuleId?: RuleId | null;
  onFocusFinding?: (ruleId: RuleId) => void;
}

/** Finding cards in the given order. Queue ordering and Decisions live in `feat/keyboard-queue`. */
export function FindingList({ findings, clauses, text, focusedRuleId = null, onFocusFinding }: FindingListProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusedRuleId) return;
    listRef.current?.ownerDocument
      .getElementById(findingDomId(focusedRuleId))
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedRuleId]);

  return (
    <Stack ref={listRef} spacing={1.5} component="section" aria-label="Findings">
      {findings.map((finding) => (
        <FindingCard
          key={finding.ruleId}
          finding={finding}
          clauses={clauses}
          text={text}
          focused={finding.ruleId === focusedRuleId}
          onFocus={onFocusFinding ? () => onFocusFinding(finding.ruleId) : undefined}
        />
      ))}
    </Stack>
  );
}
