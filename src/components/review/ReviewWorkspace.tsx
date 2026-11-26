"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { RuleId } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import { DocumentViewer } from "./DocumentViewer";
import { FindingList } from "./FindingList";

export interface ReviewWorkspaceProps {
  text: string;
  clauses: readonly Clause[];
  findings: readonly Finding[];
}

/**
 * Two-pane review: the Document on the left, Finding cards on the right.
 * Purely prop-driven so a streaming source can feed it Findings as they arrive.
 */
export function ReviewWorkspace({ text, clauses, findings }: ReviewWorkspaceProps) {
  const [focusedRuleId, setFocusedRuleId] = useState<RuleId | null>(null);

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
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 4 }, overflowY: "auto", minHeight: 0 }}>
        <DocumentViewer
          text={text}
          clauses={clauses}
          findings={findings}
          focusedRuleId={focusedRuleId}
          onFocusFinding={setFocusedRuleId}
        />
      </Paper>
      <Box component="aside" sx={{ overflowY: "auto", minHeight: 0, pr: 0.5 }}>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          Findings
        </Typography>
        <FindingList
          findings={findings}
          clauses={clauses}
          text={text}
          focusedRuleId={focusedRuleId}
          onFocusFinding={setFocusedRuleId}
        />
      </Box>
    </Box>
  );
}
