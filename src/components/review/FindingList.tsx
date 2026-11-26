"use client";

import { useEffect, useRef } from "react";
import Stack from "@mui/material/Stack";
import type { RuleId } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import type { QueueState } from "@/features/review/queue";
import { redlineDiff } from "@/features/viewer/card";
import { findingDomId } from "@/features/viewer/segments";
import { DecisionEditor } from "./DecisionEditor";
import { FindingCard } from "./FindingCard";

export interface FindingListProps {
  /** Already in queue order. */
  findings: readonly Finding[];
  clauses: readonly Clause[];
  text: string;
  focusedRuleId?: RuleId | null;
  onFocusFinding?: (ruleId: RuleId) => void;
  decisions?: QueueState["decisions"];
  mode?: QueueState["mode"];
  onDraft?: (draft: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
}

const noop = () => {};

/** Finding cards in the given order, with the inline Decision editor on the card it belongs to. */
export function FindingList({
  findings,
  clauses,
  text,
  focusedRuleId = null,
  onFocusFinding,
  decisions = {},
  mode = { kind: "browse" },
  onDraft = noop,
  onSubmit = noop,
  onCancel = noop,
}: FindingListProps) {
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
          decision={decisions[finding.ruleId]}
        >
          {mode.kind !== "browse" && mode.ruleId === finding.ruleId && (
            <DecisionEditor
              mode={mode}
              diff={mode.kind === "edit" ? redlineDiff(finding, clauses, text, mode.draft) : null}
              onDraft={onDraft}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          )}
        </FindingCard>
      ))}
    </Stack>
  );
}
