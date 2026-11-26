"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { KEYBOARD_SHORTCUTS, QUEUE_UI_TEXT, SHORTCUT_HINTS } from "@/common/constants";
import type { Clause } from "@/features/document/types";
import type { Finding } from "@/features/review/finding";
import { DocumentViewer } from "./DocumentViewer";
import { FindingList } from "./FindingList";
import { useReviewQueue } from "./useReviewQueue";

export interface ReviewWorkspaceProps {
  text: string;
  clauses: readonly Clause[];
  findings: readonly Finding[];
}

/**
 * Two-pane review: the Document on the left, the Review Queue on the right.
 * Purely prop-driven so a streaming source can feed it Findings as they arrive.
 */
export function ReviewWorkspace({ text, clauses, findings }: ReviewWorkspaceProps) {
  const { ordered, state, focus, setDraft, cancel, submit } = useReviewQueue(findings, clauses);
  const decided = ordered.filter((finding) => state.decisions[finding.ruleId]).length;

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
          focusedRuleId={state.focusedRuleId}
          onFocusFinding={focus}
        />
      </Paper>
      <Box component="aside" sx={{ overflowY: "auto", minHeight: 0, pr: 0.5 }}>
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
        <ShortcutHint />
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
